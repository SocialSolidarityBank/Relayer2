// 04 전사 뷰 — 전사 문장 전문 + 수기와의 연결·불일치 표시.
// 전사는 사실의 근거가 아니다(T19): 상태 띠는 링크된 수기 span 의 01 상태를 상속할 뿐이고,
// 링크 없는 전사 문장에는 어떤 색도 붙지 않는다.
import type { KeyboardEvent } from 'react';
import type {
  Discrepancy,
  EvidenceLink,
  SourceDocument,
  SourceSpan,
  StructuredRecord,
} from './api.ts';
import { isTranscriptSpan } from './api.ts';
import { Badge, Button, Empty } from './ui.tsx';
import { fmtMs } from './screens/session-audio.tsx';
import { statusOfSpan } from './structured-record.tsx';

const onKeyActivate = (id: string, onSelect?: (id: string) => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect?.(id);
  }
};

export function TranscriptView({
  spans,
  documents,
  links,
  discrepancies,
  record,
  selectedSpan,
  onSelect,
  filterDiscrepancies,
  onToggleFilter,
  transcriptStatus,
  recordingsWithoutTranscript,
}: {
  spans: SourceSpan[];
  documents: SourceDocument[];
  links: EvidenceLink[];
  discrepancies: Discrepancy[];
  /** 승인 분석의 01 구조. 없으면(분석 전) 상태 상속이 없다. */
  record: StructuredRecord | null;
  selectedSpan?: string | null;
  onSelect?: (spanId: string) => void;
  filterDiscrepancies: boolean;
  onToggleFilter?: () => void;
  transcriptStatus?: 'draft' | 'approved' | null;
  recordingsWithoutTranscript: number;
}) {
  const docById = new Map(documents.map((d) => [d.id, d]));
  const linkBySpan = new Map(links.map((l) => [l.transcript_span, l]));
  const discrepancyBySpan = new Map(discrepancies.map((d) => [d.transcript_span, d]));

  const transcriptSpans = spans
    .filter((s) => isTranscriptSpan(s.id))
    .sort((a, b) => {
      const da = docById.get(a.doc)?.order ?? 0;
      const db = docById.get(b.doc)?.order ?? 0;
      return da === db ? a.order - b.order : da - db;
    });

  const shown = filterDiscrepancies
    ? transcriptSpans.filter((s) => discrepancyBySpan.has(s.id))
    : transcriptSpans;

  return (
    <div className="transcript-view">
      <p className="seq-section-note">
        자동 전사라 틀린 곳 있음 {transcriptStatus === 'draft' && <Badge>확인 전</Badge>}
      </p>
      {recordingsWithoutTranscript > 0 && (
        <p className="seq-section-note">전사 없는 녹음 {recordingsWithoutTranscript}건</p>
      )}
      {transcriptSpans.length > 0 && (
        <Button variant="ghost" aria-pressed={filterDiscrepancies} onClick={onToggleFilter}>
          기록 불일치 모아보기
        </Button>
      )}
      {filterDiscrepancies && (
        <p className="seq-section-note">불일치 {shown.length}건만 표시</p>
      )}
      {transcriptSpans.length === 0 ? (
        <Empty>전사문 없음</Empty>
      ) : (
        <div className="transcript-rows">
          {shown.map((s) => {
            const doc = docById.get(s.doc);
            const link = linkBySpan.get(s.id);
            const discrepancy = discrepancyBySpan.get(s.id);
            // 띠는 링크된 수기 span 의 상태를 상속한다 — 전사만으로는 색을 만들지 않는다.
            const status = link?.written_spans.map((w) => statusOfSpan(record, w)).find(Boolean);
            return (
              <div
                key={s.id}
                className="transcript-row"
                data-span-id={s.id}
                data-status={status}
                data-discrepancy={discrepancy ? true : undefined}
                data-linked={link ? link.match : undefined}
                aria-current={selectedSpan === s.id ? true : undefined}
                role={onSelect ? 'button' : undefined}
                tabIndex={0}
                onClick={() => onSelect?.(s.id)}
                onKeyDown={onKeyActivate(s.id, onSelect)}
              >
                {/* 시각은 있는 값만 — 없으면 가짜 시각을 만들지 않고 `구간 미확인`(T05). */}
                <span className="transcript-time">
                  {s.offset_ms != null ? fmtMs(s.offset_ms) : '구간 미확인'}
                </span>
                <span className="transcript-text">{doc ? doc.text.slice(s.start, s.end) : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
