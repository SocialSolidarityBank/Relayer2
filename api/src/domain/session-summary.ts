// 02 회차별 요약 검증. 순수 함수다 — DB·HTTP·LLM 없음.
//
//   핵심 1~2줄 — 목표 관련성 1순위는 모델 판단, 여기서는 개수·근거·어휘만 본다
//   변화 3하위 — 약속 이행(약속+결과 둘 다) · 새로 드러난 것(전후 or 요약 전용 예외) · 새로운 가능성(변화→후반 계획)
//   확인필요   — 이미 완료된 것을 다시 확인하라고 하지 않는다
//   완료·해결  — `하기로 함`·`예정` 은 완료가 아니다(T14)
//
// 참조 자체(없는 span, 수기 자리의 전사 span)는 checkReferences 몫 — 여기서는 요약 규칙만 본다.
import {
  CHANGE_SUBSECTION_LABEL,
  CHANGE_SUBSECTIONS,
  forbiddenWordsIn,
  isWrittenSpan,
  type Dialogue,
  type GoalLink,
  type LlmAnalysis,
  type SessionSummary,
  type SourceSpan,
} from './record-analysis.ts';
import { writtenPositions, type Problem } from './structured-record.ts';

// ponytail: 완료 판정은 보수적 휴리스틱이다. 의향 표현이 있고 완료 신호가 없으면 완료로 못 세운다.
//   경계 사례(완료·의향이 한 문장에 섞임, 목록에 없는 완료 동사)는 사람 승인에 맡긴다 —
//   어휘 목록을 늘리는 것보다 놓치는 쪽이 낫다. 오판이 잦으면 cue 목록을 보강할 것.
const INTENTION_MARKERS = ['하기로', '예정', '계획', '준비 중', '해보려', '싶'];
const COMPLETION_CUES = ['완료', '마침', '했', '받음', '신청함', '등록함', '접수함', '접수됨', '진료받', '참여함', '수행함', '제출함'];

const hasIntention = (text: string): boolean => INTENTION_MARKERS.some((m) => text.includes(m));
const hasCompletion = (text: string): boolean => COMPLETION_CUES.some((c) => text.includes(c));

const GOALS: ReadonlyArray<GoalLink> = ['overall', 'session', null];

export function validateSessionSummary(
  a: LlmAnalysis,
  spans: ReadonlyArray<SourceSpan>,
  texts: (spanId: string) => string,
): Problem[] {
  const problems: Problem[] = [];
  const { summary, record } = a;
  const pos = writtenPositions(spans);
  const known = new Set(spans.map((s) => s.id));
  const statusOf = new Map(record.annotations.map((x) => [x.span, x.status]));
  const hasChangeOn = (ids: ReadonlyArray<string>): boolean => ids.some((id) => statusOf.get(id) === 'change');

  const refText = (ids: ReadonlyArray<string>): string =>
    ids.filter((id) => known.has(id)).map(texts).join('\n');

  // 공통: span 은 비어 있지 않고 수기여야 하며, 생성문은 참조 원문의 어휘를 쓴다(T17).
  const checkSpans = (where: string, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) problems.push({ where, reason: 'empty_spans' });
    for (const id of ids) {
      if (known.has(id) && !isWrittenSpan(id)) problems.push({ where, reason: 'not_written' });
    }
  };
  const checkGoal = (where: string, goal: GoalLink) => {
    if (!GOALS.includes(goal)) problems.push({ where, reason: 'bad_goal' });
  };
  const checkWords = (where: string, generated: ReadonlyArray<string>, referenced: string) => {
    for (const g of generated) {
      if (forbiddenWordsIn(g, referenced).length > 0) {
        problems.push({ where, reason: 'forbidden_word' });
        return;
      }
    }
  };
  // T18: 실무자·당사자 대사는 참조 원문에 그대로 들어 있는 직접 발화만.
  const checkDialogue = (where: string, dialogue: Dialogue | undefined, referenced: string) => {
    for (const q of [dialogue?.worker, dialogue?.participant]) {
      if (q !== undefined && !referenced.includes(q)) problems.push({ where, reason: 'dialogue_not_verbatim' });
    }
  };
  const checkItem = (where: string, item: { text: string; spans: string[]; goal: GoalLink }) => {
    checkSpans(where, item.spans);
    checkGoal(where, item.goal);
    checkWords(where, [item.text], refText(item.spans));
  };

  // 이번 상담의 핵심 — 1~2줄.
  if (summary.core.length < 1 || summary.core.length > 2) {
    problems.push({ where: 'core', reason: 'core_count' });
  }
  summary.core.forEach((item, i) => checkItem(`core ${i}`, item));

  // 약속 이행 여부 — 약속 span 과 결과 span 이 둘 다 있고 겹치지 않아야 한다(T09·T13).
  //   `변화점:` 은 01 에 실제 change 주석이 있을 때만, `∴` 는 변화점이 있을 때만 쓴다.
  summary.changes.promise_result.forEach((item, i) => {
    const where = `promise_result ${i}`;
    checkSpans(`${where} promise`, item.promise_spans);
    checkSpans(`${where} result`, item.result_spans);
    if (item.promise_spans.some((id) => item.result_spans.includes(id))) {
      problems.push({ where, reason: 'promise_result_overlap' });
    }
    const ref = `${refText(item.promise_spans)}\n${refText(item.result_spans)}`;
    checkWords(where, [item.promise, item.result], ref);
    if (item.changes.length > 0 && !hasChangeOn([...item.promise_spans, ...item.result_spans])) {
      problems.push({ where, reason: 'changes_without_annotation' });
    }
    if (item.conclusion !== undefined && item.changes.length === 0) {
      problems.push({ where, reason: 'conclusion_without_changes' });
    }
    checkGoal(where, item.goal);
  });

  // 상담 중 새로 드러난 것 — mode=change 는 01 의 change 주석이 근거다.
  //   전후가 없으면 `확인된 내용:` + summary_only_exception 으로만 산다(T10).
  summary.changes.newly_revealed.forEach((item, i) => {
    const where = `newly_revealed ${i}`;
    checkSpans(where, item.spans);
    const ref = refText(item.spans);
    if (item.mode === 'change') {
      if (!hasChangeOn(item.spans) || item.summary_only_exception) {
        problems.push({ where, reason: 'newly_revealed_mode' });
      }
    } else if (!item.summary_only_exception) {
      problems.push({ where, reason: 'newly_revealed_mode' });
    }
    checkDialogue(where, item.dialogue, ref);
    checkWords(where, item.lines, ref);
    checkGoal(where, item.goal);
  });

  // 이번 상담 후 새로운 가능성 — 01 에 확정된 변화 span 이 있고, 계획 span 이 그보다 후반이어야 한다(T11).
  summary.changes.new_possibility.forEach((item, i) => {
    const where = `new_possibility ${i}`;
    checkSpans(`${where} change`, item.change_spans);
    checkSpans(`${where} plan`, item.plan_spans);
    if (item.change_spans.length > 0 && !hasChangeOn(item.change_spans)) {
      problems.push({ where, reason: 'new_possibility_needs_change' });
    }
    const cs = item.change_spans.map((id) => pos.get(id)).filter((n): n is number => n !== undefined);
    const ps = item.plan_spans.map((id) => pos.get(id)).filter((n): n is number => n !== undefined);
    if (cs.length > 0 && ps.length > 0 && Math.min(...ps) <= Math.max(...cs)) {
      problems.push({ where, reason: 'new_possibility_order' });
    }
    const ref = `${refText(item.change_spans)}\n${refText(item.plan_spans)}`;
    checkDialogue(where, item.dialogue, ref);
    checkWords(where, item.lines, ref);
    checkGoal(where, item.goal);
  });

  // 확인필요 — 이미 완료된 것을 올리지 않는다. 의향 없이 완료 신호만 있는 문장은 완료·해결 자리다.
  const completedKeys = new Set(
    summary.completed.map((item) => [...item.spans].sort().join('')),
  );
  summary.follow_up.forEach((item, i) => {
    const where = `follow_up ${i}`;
    checkItem(where, item);
    if (completedKeys.has([...item.spans].sort().join(''))) {
      problems.push({ where, reason: 'follow_up_completed_dup' });
    }
    const ref = refText(item.spans);
    if (hasCompletion(ref) && !hasIntention(ref)) problems.push({ where, reason: 'follow_up_already_done' });
  });

  // 완료·해결 — 의향 표현만 있고 완료 신호가 없으면 완료가 아니다(T14).
  summary.completed.forEach((item, i) => {
    const where = `completed ${i}`;
    checkItem(where, item);
    const ref = refText(item.spans);
    if (hasIntention(ref) && !hasCompletion(ref)) problems.push({ where, reason: 'completed_intention_only' });
  });

  // 중복 처리 — 같은 span 묶음이 변화 3하위 중 두 곳에 걸치면 한 곳만 남긴다.
  const seenSubsections = new Map<string, string>();
  const subsectionSpans: Array<[string, ReadonlyArray<string>]> = [
    ...summary.changes.promise_result.map((x, i) => [`promise_result ${i}`, [...x.promise_spans, ...x.result_spans]] as [string, string[]]),
    ...summary.changes.newly_revealed.map((x, i) => [`newly_revealed ${i}`, x.spans] as [string, string[]]),
    ...summary.changes.new_possibility.map((x, i) => [`new_possibility ${i}`, [...x.change_spans, ...x.plan_spans]] as [string, string[]]),
  ];
  for (const [where, ids] of subsectionSpans) {
    if (ids.length === 0) continue;
    const key = [...ids].sort().join('');
    const first = seenSubsections.get(key);
    if (first !== undefined) problems.push({ where, reason: 'duplicate_subsection' });
    else seenSubsections.set(key, where);
  }

  return problems;
}

/**
 * `이번 회차에서 확인된 변화` 의 화면 소제목 순서. ①②③ 은 저장하지 않고
 * 내용 있는 하위 항목만 세어 렌더 시 1부터 연속으로 매긴다(T12).
 */
export function renderOrder(
  summary: SessionSummary,
): Array<{ key: (typeof CHANGE_SUBSECTIONS)[number]; label: string; number: number }> {
  return CHANGE_SUBSECTIONS.filter((key) => summary.changes[key].length > 0).map((key, i) => ({
    key,
    label: CHANGE_SUBSECTION_LABEL[key],
    number: i + 1,
  }));
}
