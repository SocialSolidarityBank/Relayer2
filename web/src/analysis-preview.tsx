// 개발용 미리보기 — v6 분석 화면 부품(01 구조화 · 02 요약 · 04 전사 · 대조 패널)을
// 합성 fixture 로 한 자리에 그린다. 라우트에 올리지 않는다(WebScreens/E2E 가 마운트).
// fixture 는 화면 부품 검증용이라 서버의 splitSentences 대신 줄 단위로 자른다.
import { useState } from 'react';
import type {
  AnalysisView,
  Backlink,
  Discrepancy,
  EvidenceLink,
  Keyword,
  SessionSummary,
  SourceDocument,
  SourceSpan,
  StructuredRecord,
} from './api.ts';
import { StructuredRecordView, paragraphOfSpan } from './structured-record.tsx';
import { SessionSummaryView } from './session-summary.tsx';
import { TranscriptView } from './transcript-view.tsx';
import { ContrastPanel, type ContrastPanelProps } from './analysis-panel.tsx';

const MEMO_LINES = [
  '당사자는 지난주에 주민센터를 방문했다고 말했다.',
  '처음에는 서류가 3건이라고 했으나 다시 세어 보니 4건이었다.',
  '상담 말미에 매주 화요일 산책하기로 했다.',
  '원문에 </script> 같은 문자가 있어도 텍스트로만 그린다.',
];
const CARD_LINES = ['주민센터 방문 결과를 다음 회차에 확인한다.', '산책 약속을 지켰는지 물어본다.'];
const TRANSCRIPT_LINES = [
  '지난주에 주민센터에 다녀왔어요.',
  '서류가 다섯 건이었던 것 같아요.',
  '화요일마다 걷기로 했습니다.',
];

const doc = (id: string, kind: SourceDocument['kind'], label: string, lines: string[], order: number): SourceDocument => ({
  id,
  kind,
  label,
  text: lines.join('\n'),
  hash: 'preview',
  order,
});

// spanDoc: 전사는 문서 id(`transcript:44`)가 아니라 전사 id(`44`)가 doc 자리에 온다 — `t:44:0`.
const lineSpans = (prefix: 'w' | 't', d: SourceDocument, spanDoc?: string, offsets?: Array<number | null>): SourceSpan[] => {
  const lines = d.text.split('\n');
  const spans: SourceSpan[] = [];
  let from = 0;
  lines.forEach((line, n) => {
    const start = d.text.indexOf(line, from);
    spans.push({
      id: `${prefix}:${spanDoc ?? d.id}:${n}`,
      doc: d.id,
      start,
      end: start + line.length,
      order: n,
      offset_ms: offsets ? offsets[n] : undefined,
    });
    from = start + line.length;
  });
  return spans;
};

export const previewDocuments: SourceDocument[] = [
  doc('memo', 'memo', '오늘 상담 내용', MEMO_LINES, 0),
  doc('card:12', 'card:promise', '수행할 과제', CARD_LINES, 1),
  doc('transcript:44', 'transcript', '녹음 전사', TRANSCRIPT_LINES, 2),
];

export const previewSpans: SourceSpan[] = [
  ...lineSpans('w', previewDocuments[0]),
  ...lineSpans('w', previewDocuments[1]),
  ...lineSpans('t', previewDocuments[2], '44', [0, 61_000, null]),
];

export const previewRecord: StructuredRecord = {
  topics: [{ id: '01', title: '주민센터 방문과 산책 약속', paragraph_ids: ['1-1', '1-2'] }],
  paragraphs: [
    { id: '1-1', title: '주민센터 방문', spans: ['w:memo:0', 'w:memo:1', 'w:card:12:0'] },
    { id: '1-2', title: '산책 약속', spans: ['w:memo:2', 'w:memo:3', 'w:card:12:1'] },
  ],
  annotations: [
    { span: 'w:memo:1', status: 'change', before: ['w:memo:1'], after: ['w:memo:1'] },
    { span: 'w:card:12:0', status: 'follow_up' },
    { span: 'w:memo:2', status: 'completed' },
  ],
};

export const previewSummary: SessionSummary = {
  core: [{ text: '주민센터 방문을 확인하고 산책 약속을 세운 회차', spans: ['w:memo:0'], goal: 'overall' }],
  changes: {
    promise_result: [
      {
        promise: '주민센터 방문 결과를 다음 회차에 확인한다',
        result: '지난주에 주민센터를 방문했다고 말했다',
        promise_spans: ['w:card:12:0'],
        result_spans: ['w:memo:0'],
        changes: [{ before: '방문 전', after: '방문함', meaning: '약속 이행' }],
        conclusion: '약속을 지켰다',
        goal: 'session',
      },
    ],
    newly_revealed: [
      {
        dialogue: { participant: '서류가 다섯 건이었던 것 같아요' },
        mode: 'confirmed',
        lines: ['서류 건수를 다시 확인해야 한다'],
        spans: ['w:memo:1'],
        summary_only_exception: false,
        goal: null,
      },
    ],
    new_possibility: [
      {
        dialogue: { worker: '화요일마다 걷기로 했습니다' },
        lines: ['매주 화요일 산책이 새 일과가 될 수 있다'],
        change_spans: ['w:memo:2'],
        plan_spans: ['w:card:12:1'],
        goal: 'session',
      },
    ],
  },
  follow_up: [{ text: '서류 건수 확인', spans: ['w:memo:1'], goal: null }],
  completed: [{ text: '주민센터 방문', spans: ['w:memo:0'], goal: 'overall' }],
};

export const previewLinks: EvidenceLink[] = [
  { transcript_span: 't:44:0', written_spans: ['w:memo:0'], match: 'match' },
  { transcript_span: 't:44:1', written_spans: ['w:memo:1'], match: 'uncertain' },
];

export const previewDiscrepancies: Discrepancy[] = [
  {
    transcript_span: 't:44:1',
    written_spans: ['w:memo:1'],
    paragraph_id: '1-1',
    difference: '서류 건수 — 전사 다섯 건, 수기 4건',
    conditions: { same_subject: true, same_attribute: true, same_time: true, incompatible: true },
  },
];

export const previewKeywords: Keyword[] = [
  { text: '주민센터', source: 'deterministic', spans: ['w:memo:0'] },
  { text: '산책', source: 'llm', spans: ['w:memo:2'] },
];

export const previewBacklinks: Backlink[] = [
  { session_id: 11, seq: 3, span_id: 'w:memo:0', paragraph_id: '1-1', text: '주민센터 방문을 예약했다.' },
  { session_id: 9, seq: 1, span_id: 'w:memo:2', paragraph_id: null, text: '주민센터 위치를 물었다.' },
];

export const previewAnalysis: AnalysisView = {
  session_id: 11,
  analysis: null,
  documents: previewDocuments,
  spans: previewSpans,
  transcript: { id: 44, status: 'draft', recordings_without_transcript: 1 },
  stale: false,
};

const spanText = (documents: SourceDocument[], spans: SourceSpan[], id: string): string => {
  const s = spans.find((x) => x.id === id);
  const d = s && documents.find((x) => x.id === s.doc);
  return s && d ? d.text.slice(s.start, s.end) : '';
};

export function AnalysisPreview() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState(false);
  const [panel, setPanel] = useState<ContrastPanelProps>({ mode: 'empty' });

  const select = (spanId: string) => {
    setSelected(spanId);
    const discrepancy = previewDiscrepancies.find((d) => d.transcript_span === spanId);
    const link = previewLinks.find((l) => l.transcript_span === spanId);
    if (discrepancy) {
      setPanel({
        mode: 'discrepancy',
        difference: discrepancy.difference,
        transcriptText: spanText(previewDocuments, previewSpans, spanId),
        writtenText: discrepancy.written_spans.map((w) => spanText(previewDocuments, previewSpans, w)).join(' '),
        paragraph: paragraphOfSpan(previewRecord, discrepancy.written_spans[0] ?? ''),
      });
    } else if (link) {
      setPanel({
        mode: 'link',
        transcriptText: spanText(previewDocuments, previewSpans, spanId),
        writtenText: link.written_spans.map((w) => spanText(previewDocuments, previewSpans, w)).join(' '),
        paragraph: paragraphOfSpan(previewRecord, link.written_spans[0] ?? ''),
      });
    } else {
      setPanel({ mode: 'empty' });
    }
  };

  return (
    <div className="analysis-preview">
      <SessionSummaryView
        summary={previewSummary}
        keywords={previewKeywords}
        override={null}
        sessionSeq={3}
        onKeywordClick={(keyword) => setPanel({ mode: 'backlinks', keyword, backlinks: previewBacklinks })}
      />
      <div className="analysis-split">
        <div>
          <StructuredRecordView
            record={previewRecord}
            spans={previewSpans}
            documents={previewDocuments}
            annotationsVisible
            keywords={previewKeywords}
            selectedSpan={selected}
            onSpanClick={setSelected}
          />
          <TranscriptView
            spans={previewSpans}
            documents={previewDocuments}
            links={previewLinks}
            discrepancies={previewDiscrepancies}
            record={previewRecord}
            selectedSpan={selected}
            onSelect={select}
            filterDiscrepancies={filter}
            onToggleFilter={() => setFilter((f) => !f)}
            transcriptStatus="draft"
            recordingsWithoutTranscript={1}
          />
        </div>
        <ContrastPanel
          {...panel}
          onGoToParagraph={(pid) => {
            const first = previewRecord.paragraphs.find((p) => p.id === pid)?.spans[0];
            if (first) setSelected(first);
          }}
          onGoToBacklink={() => undefined}
        />
      </div>
    </div>
  );
}
