// 04 전사 연결·불일치 검증. 순수 함수다 — DB·HTTP·LLM 없음.
//
//   연결   — 전사 문장 ↔ 수기 span. 억지 연결 금지, 한 전사 문장은 한 링크뿐
//   불일치 — 연결이 먼저 있어야 하고 4조건(동일 대상·속성·시기·양립 불가)이 모두 true 일 때만(T20~T22)
//   상태   — 전사의 색은 01 에서 확정된 수기 상태를 상속할 뿐, 전사만으로 만들지 않는다(T19·T27)
//
// 참조 자체(없는 span, 자리 바뀐 w:/t:)는 checkReferences 몫 — 여기서는 연결 규칙만 본다.
import {
  forbiddenWordsIn,
  isTranscriptSpan,
  isWrittenSpan,
  type LlmAnalysis,
  type SourceSpan,
  type Status,
} from './record-analysis.ts';
import { paragraphOfSpan, statusOfSpan, type Problem } from './structured-record.ts';

export function validateTranscriptLinks(
  a: LlmAnalysis,
  spans: ReadonlyArray<SourceSpan>,
  texts: (spanId: string) => string,
): Problem[] {
  const problems: Problem[] = [];
  const known = new Set(spans.map((s) => s.id));
  const refText = (ids: ReadonlyArray<string>): string =>
    ids.filter((id) => known.has(id)).map(texts).join('\n');

  // 연결. 전사 자리는 t:, 수기 자리는 w:, 둘 다 비어 있으면 안 된다.
  //   한 전사 문장이 여러 링크에 걸치면 어느 단락으로 갈지 모른다 — 하나만 허용한다.
  const linked = new Map<string, number>();
  a.links.forEach((l, i) => {
    const where = `link ${i}`;
    if (known.has(l.transcript_span) && !isTranscriptSpan(l.transcript_span)) {
      problems.push({ where, reason: 'not_transcript' });
    }
    if (l.written_spans.length === 0) problems.push({ where, reason: 'empty_spans' });
    for (const id of l.written_spans) {
      if (known.has(id) && !isWrittenSpan(id)) problems.push({ where, reason: 'not_written' });
    }
    if (linked.has(l.transcript_span)) problems.push({ where, reason: 'transcript_span_reused' });
    linked.set(l.transcript_span, i);
  });

  // 불일치. 같은 전사 span 의 연결이 먼저 있어야 하고(억지 연결 금지), 4조건이 모두 true 여야 한다.
  //   paragraph_id 는 written_spans 를 담은 단락이어야 하고, 차이점은 양쪽 원문의 어휘를 쓴다.
  a.discrepancies.forEach((d, i) => {
    const where = `discrepancy ${i}`;
    if (!linked.has(d.transcript_span)) problems.push({ where, reason: 'discrepancy_without_link' });
    if (d.written_spans.length === 0) problems.push({ where, reason: 'empty_spans' });
    const c = d.conditions;
    if (!(c.same_subject && c.same_attribute && c.same_time && c.incompatible)) {
      problems.push({ where, reason: 'conditions_not_all_true' });
    }
    const paraIds = new Set(
      d.written_spans.map((id) => paragraphOfSpan(a.record, id)?.id).filter((id): id is string => id !== undefined),
    );
    if (!paraIds.has(d.paragraph_id)) problems.push({ where, reason: 'paragraph_mismatch' });
    if (d.difference.trim() === '') {
      problems.push({ where, reason: 'empty_difference' });
    } else {
      const ref = `${texts(d.transcript_span)}\n${refText(d.written_spans)}`;
      if (forbiddenWordsIn(d.difference, ref).length > 0) problems.push({ where, reason: 'forbidden_word' });
    }
  });

  return problems;
}

/**
 * 전사 문장의 상태 띠. 연결된 수기 span 의 01 상태를 상속한다 — 전사만으로 색을 만들지 않는다(T19).
 * 요약 전용 예외는 01 주석이 아니므로 여기로 새어 나오지 않는다(T27). 연결 없거나 상태 없으면 null.
 */
export function statusForTranscriptSpan(a: LlmAnalysis, spanId: string): Status | null {
  const link = a.links.find((l) => l.transcript_span === spanId);
  if (!link) return null;
  for (const id of link.written_spans) {
    const status = statusOfSpan(a.record, id);
    if (status !== null) return status;
  }
  return null;
}

/** 이 전사 문장이 불일치로 판정됐는가 — `기록 불일치 모아보기` 필터와 배경 표시가 쓴다. */
export function isDiscrepant(a: LlmAnalysis, spanId: string): boolean {
  return a.discrepancies.some((d) => d.transcript_span === spanId);
}
