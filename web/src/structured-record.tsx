// 01 구조화된 상담 기록 뷰 — 접힘 없는 목차형(큰 주제 `01` → 세부 단락 `1-1` → 원문 문장).
// 원문은 `documents` 텍스트를 span 좌표로 잘라 **텍스트 노드**로만 그린다 — LLM 이 돌려준
// 문자열을 원문 자리에 쓰지 않고, dangerouslySetInnerHTML 도 쓰지 않는다(T01·T31).
// 상태 띠는 수기 span 에만 붙는다(전사는 transcript-view 가 링크로 상속한다).
import type { KeyboardEvent } from 'react';
import type { Keyword, Paragraph, SourceDocument, SourceSpan, StructuredRecord } from './api.ts';
import { Badge } from './ui.tsx';

/** span 에 붙은 01 상태. 주석이 없으면 undefined — 모든 문장에 색을 칠하지 않는다. */
export const statusOfSpan = (record: StructuredRecord | null, spanId: string) =>
  record?.annotations.find((a) => a.span === spanId)?.status;

/** span 이 속한 세부 단락. 백링크·대조 패널의 `연결된 수기 단락` 이동에 쓴다. */
export const paragraphOfSpan = (record: StructuredRecord | null, spanId: string): Paragraph | null =>
  record?.paragraphs.find((p) => p.spans.includes(spanId)) ?? null;

const onKeyActivate = (id: string, onSpanClick?: (id: string) => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSpanClick?.(id);
  }
};

export function StructuredRecordView({
  record,
  spans,
  documents,
  annotationsVisible,
  keywords,
  onSpanClick,
  selectedSpan,
}: {
  record: StructuredRecord;
  spans: SourceSpan[];
  documents: SourceDocument[];
  /** 검토 화면처럼 상태를 아직 숨길 때 false — 띠를 그리지 않는다. */
  annotationsVisible: boolean;
  keywords: Keyword[];
  onSpanClick?: (spanId: string) => void;
  selectedSpan?: string | null;
}) {
  const spanById = new Map(spans.map((s) => [s.id, s]));
  const docById = new Map(documents.map((d) => [d.id, d]));
  const paragraphById = new Map(record.paragraphs.map((p) => [p.id, p]));

  // 큰 주제 순서 = 첫 세부 단락의 첫 span 이 원문에서 놓인 자리(문서 order → 문장 order).
  // 뒤 문장을 앞으로 옮기지 않는다는 01 규칙의 화면 쪽 절반이다.
  const positionOf = (spanId: string | undefined): number => {
    const s = spanId ? spanById.get(spanId) : undefined;
    const d = s ? docById.get(s.doc) : undefined;
    return s && d ? d.order * 1_000_000 + s.order : Number.MAX_SAFE_INTEGER;
  };
  const topics = [...record.topics].sort((a, b) => {
    const pa = paragraphById.get(a.paragraph_ids[0] ?? '');
    const pb = paragraphById.get(b.paragraph_ids[0] ?? '');
    return positionOf(pa?.spans[0]) - positionOf(pb?.spans[0]);
  });

  return (
    <div className="structured-record">
      {keywords.length > 0 && (
        <div className="keyword-chips">
          {/* 결정적 키워드는 목표·카드에서 온 사람의 어휘(민트), LLM 추출은 라벤더(AI 산출). */}
          {keywords.map((k) => (
            <Badge key={k.text} tone={k.source === 'llm' ? 'lavender' : 'mint'}>
              {k.text}
            </Badge>
          ))}
        </div>
      )}
      {topics.map((topic) => (
        <section className="record-topic" key={topic.id}>
          <h3 className="record-topic-title">
            {topic.id} {topic.title}
          </h3>
          {topic.paragraph_ids.map((pid) => {
            const paragraph = paragraphById.get(pid);
            if (!paragraph) return null;
            // span 을 문서 경계로 끊어 묶는다 — 경계마다 문서 label 캡션을 달고,
            // 같은 문서 안에서는 span 사이 원문 공백을 그대로 둔다(무손실).
            const chunks: Array<{ doc: SourceDocument; spans: SourceSpan[] }> = [];
            for (const sid of paragraph.spans) {
              const s = spanById.get(sid);
              const d = s && docById.get(s.doc);
              if (!s || !d) continue;
              const last = chunks[chunks.length - 1];
              if (last && last.doc.id === d.id) last.spans.push(s);
              else chunks.push({ doc: d, spans: [s] });
            }
            return (
              <div className="record-paragraph" key={pid} data-paragraph-id={pid}>
                <h4 className="record-paragraph-title">
                  {pid} {paragraph.title}
                </h4>
                {chunks.map((chunk) => (
                  <div className="record-doc" key={chunk.doc.id}>
                    <p className="record-doc-label">{chunk.doc.label}</p>
                    <p className="record-text">
                      {chunk.spans.map((s, i) => {
                        const status = annotationsVisible ? statusOfSpan(record, s.id) : undefined;
                        return (
                          <span key={s.id}>
                            {i > 0 && chunk.doc.text.slice(chunk.spans[i - 1].end, s.start)}
                            <span
                              className="record-span"
                              data-span-id={s.id}
                              data-status={status}
                              aria-current={selectedSpan === s.id ? true : undefined}
                              role={onSpanClick ? 'button' : undefined}
                              tabIndex={0}
                              onClick={() => onSpanClick?.(s.id)}
                              onKeyDown={onKeyActivate(s.id, onSpanClick)}
                            >
                              {chunk.doc.text.slice(s.start, s.end)}
                            </span>
                          </span>
                        );
                      })}
                    </p>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
