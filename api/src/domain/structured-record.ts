// 01 구조화된 상담 기록 검증. 순수 함수다 — DB·HTTP·LLM 없음.
//
//   단락 분할 — 수기 span 전부를 문서 순서대로 빠짐없이 한 번씩 담는다(원문 무손실, 시간순)
//   제목      — 원문 어휘 조합이어야 한다. 치환 금지어는 참조 원문에 있을 때만 허용(T17)
//   상태 띠   — change 는 같은 회차 before·after span 둘 다 필요. 요약 전용 예외는 파랑 금지(T27)
//
// 참조 자체(없는 span, 수기 자리의 전사 span)는 checkReferences 가 잡는다 — 여기서는 구조 규칙만 본다.
import {
  forbiddenWordsIn,
  isWrittenSpan,
  type LlmAnalysis,
  type Paragraph,
  type SourceSpan,
  type Status,
  type StructuredRecord,
} from './record-analysis.ts';

export type Problem = { where: string; reason: string };

/**
 * 수기 span 의 문서 순서 위치(0부터). 문서 사이는 `spans` 에 doc 이 처음 나타난 순서,
 * 문서 안은 `order`. 전사 span 은 자리가 없다 — 사실 판정의 시간축은 수기뿐이다.
 */
export function writtenPositions(spans: ReadonlyArray<SourceSpan>): Map<string, number> {
  const docOrder = new Map<string, number>();
  const written = spans.filter((s) => isWrittenSpan(s.id));
  for (const s of written) if (!docOrder.has(s.doc)) docOrder.set(s.doc, docOrder.size);
  const sorted = [...written].sort(
    (a, b) => (docOrder.get(a.doc) ?? 0) - (docOrder.get(b.doc) ?? 0) || a.order - b.order,
  );
  return new Map(sorted.map((s, i) => [s.id, i]));
}

const joinText = (ids: ReadonlyArray<string>, known: ReadonlySet<string>, texts: (id: string) => string): string =>
  ids.filter((id) => known.has(id)).map(texts).join('\n');

/** 제목은 참조 원문의 어휘 조합이어야 한다 — 금지어 불가, 두 글자 이상 토큰 하나는 원문에 그대로 있어야 한다. */
function titleProblems(where: string, title: string, referenced: string): Problem[] {
  if (title.trim() === '') return [{ where, reason: 'empty_title' }];
  const problems: Problem[] = [];
  if (forbiddenWordsIn(title, referenced).length > 0) problems.push({ where, reason: 'forbidden_word' });
  const tokens = title.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0 || !tokens.some((t) => referenced.includes(t))) {
    problems.push({ where, reason: 'title_not_from_source' });
  }
  return problems;
}

export function validateStructuredRecord(
  a: LlmAnalysis,
  spans: ReadonlyArray<SourceSpan>,
  texts: (spanId: string) => string,
): Problem[] {
  const problems: Problem[] = [];
  const { record } = a;
  const pos = writtenPositions(spans);
  const known = new Set(spans.map((s) => s.id));

  // (a) 단락 분할. 단락을 배열 순서대로 펼치면 수기 span 전체가 문서 순서 그대로 한 번씩 나와야 한다.
  //     누락은 span_missing, 중복 배치는 span_repeated, 뒤 문장을 앞으로 옮기면 order_violation.
  const seen = new Set<string>();
  const paraIds = new Set<string>();
  let prev = -1;
  for (const p of record.paragraphs) {
    if (paraIds.has(p.id)) problems.push({ where: `paragraph ${p.id}`, reason: 'duplicate_paragraph_id' });
    paraIds.add(p.id);
    for (const id of p.spans) {
      if (!known.has(id) || !isWrittenSpan(id)) continue; // 참조 오류는 checkReferences 몫
      if (seen.has(id)) {
        problems.push({ where: `paragraph ${p.id}`, reason: 'span_repeated' });
        continue;
      }
      seen.add(id);
      const at = pos.get(id) ?? -1;
      if (at < prev) problems.push({ where: `paragraph ${p.id}`, reason: 'order_violation' });
      prev = Math.max(prev, at);
    }
  }
  for (const id of pos.keys()) {
    if (!seen.has(id)) problems.push({ where: 'paragraphs', reason: 'span_missing' });
  }

  // (b) 주제. id 는 유일하고, 각 단락은 정확히 한 주제에 속한다.
  const topicIds = new Set<string>();
  const topicOf = new Map<string, string>();
  for (const t of record.topics) {
    if (topicIds.has(t.id)) problems.push({ where: `topic ${t.id}`, reason: 'duplicate_topic_id' });
    topicIds.add(t.id);
    for (const pid of t.paragraph_ids) {
      if (!paraIds.has(pid)) {
        problems.push({ where: `topic ${t.id}`, reason: 'unknown_paragraph' });
        continue;
      }
      if (topicOf.has(pid)) problems.push({ where: `topic ${t.id}`, reason: 'paragraph_multi_topic' });
      else topicOf.set(pid, t.id);
    }
  }
  for (const p of record.paragraphs) {
    if (!topicOf.has(p.id)) problems.push({ where: `paragraph ${p.id}`, reason: 'paragraph_unassigned' });
  }

  // (c) 제목은 원문 어휘 조합. 단락 제목은 자기 span 들, 주제 제목은 묶인 단락 전체가 근거다.
  const paraText = new Map<string, string>();
  for (const p of record.paragraphs) {
    const ref = joinText(p.spans, known, texts);
    paraText.set(p.id, ref);
    problems.push(...titleProblems(`paragraph ${p.id} title`, p.title, ref));
  }
  for (const t of record.topics) {
    const ref = t.paragraph_ids.map((pid) => paraText.get(pid) ?? '').join('\n');
    problems.push(...titleProblems(`topic ${t.id} title`, t.title, ref));
  }

  // (d) 상태 띠. 한 span 에 주석은 하나뿐. change 는 같은 회차 수기 before·after 가 둘 다 있고
  //     before 가 after 보다 문서에서 앞에 와야 한다.
  const annotated = new Set<string>();
  record.annotations.forEach((x, i) => {
    const where = `annotation ${i}`;
    if (known.has(x.span) && !isWrittenSpan(x.span)) problems.push({ where, reason: 'annotation_not_written' });
    if (annotated.has(x.span)) problems.push({ where, reason: 'annotation_conflict' });
    annotated.add(x.span);
    if (x.status !== 'change') return;
    const before = x.before ?? [];
    const after = x.after ?? [];
    if (before.length === 0 || after.length === 0) {
      problems.push({ where, reason: 'change_needs_before_after' });
      return;
    }
    if ([...before, ...after].some((id) => known.has(id) && !isWrittenSpan(id))) {
      problems.push({ where, reason: 'annotation_not_written' });
    }
    const bs = before.map((id) => pos.get(id)).filter((n): n is number => n !== undefined);
    const as = after.map((id) => pos.get(id)).filter((n): n is number => n !== undefined);
    if (bs.length > 0 && as.length > 0 && Math.max(...bs) >= Math.min(...as)) {
      problems.push({ where, reason: 'change_order' });
    }
  });

  // (e) T27. 요약 전용 예외(전후 없이 요약에만 실린 것)는 01 의 파랑으로 전파하지 않는다.
  const changeSpans = new Set(record.annotations.filter((x) => x.status === 'change').map((x) => x.span));
  a.summary.changes.newly_revealed.forEach((item, i) => {
    if (!item.summary_only_exception) return;
    for (const id of item.spans) {
      if (changeSpans.has(id)) problems.push({ where: `newly_revealed ${i}`, reason: 'summary_only_change' });
    }
  });

  // 키워드. LLM 이 뽑은 어휘는 참조 span 안에 그 문자열이 있어야 산다.
  a.keywords.forEach((k, i) => {
    if (!joinText(k.spans, known, texts).includes(k.text)) {
      problems.push({ where: `keyword ${i}`, reason: 'keyword_not_in_source' });
    }
  });

  return problems;
}

/** span 을 담은 단락. web 구조화 뷰·전사 대조 패널의 `연결된 수기 단락` 이 쓴다. */
export function paragraphOfSpan(record: StructuredRecord, spanId: string): Paragraph | null {
  return record.paragraphs.find((p) => p.spans.includes(spanId)) ?? null;
}

/** span 의 01 상태. 주석 없으면 null — 색을 칠하지 않는 문장이 정상이다. */
export function statusOfSpan(record: StructuredRecord, spanId: string): Status | null {
  return record.annotations.find((x) => x.span === spanId)?.status ?? null;
}
