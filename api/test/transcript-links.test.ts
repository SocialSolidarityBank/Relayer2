// 04 전사 연결·불일치 검증기 단위 테스트. DB 없이 합성 수기·전사 문장으로 돌린다.
import { describe, expect, it } from 'vitest';
import { spansOf, type LlmAnalysis, type SourceSpan } from '../src/domain/record-analysis.ts';
import {
  isDiscrepant,
  statusForTranscriptSpan,
  validateTranscriptLinks,
} from '../src/domain/transcript-links.ts';

const MEMO = '월세 35만 원을 냄.\n서류를 작성하기로 함.';
const TRANSCRIPT = '월세 30만 원을 냈다고 말함.\n서류를 작성했다고 말함.';

const DOC_TEXT: Record<string, string> = { memo: MEMO, '44': TRANSCRIPT };
const spans: SourceSpan[] = [...spansOf('w', 'memo', MEMO), ...spansOf('t', '44', TRANSCRIPT)];
const texts = (id: string): string => {
  const s = spans.find((x) => x.id === id);
  return s ? DOC_TEXT[s.doc].slice(s.start, s.end) : '';
};

const ALL_TRUE = { same_subject: true, same_attribute: true, same_time: true, incompatible: true };

const base = (): LlmAnalysis => ({
  record: {
    topics: [{ id: '01', title: '월세 서류', paragraph_ids: ['1-1'] }],
    paragraphs: [{ id: '1-1', title: '월세 서류', spans: ['w:memo:0', 'w:memo:1'] }],
    annotations: [],
  },
  summary: {
    core: [],
    changes: { promise_result: [], newly_revealed: [], new_possibility: [] },
    follow_up: [],
    completed: [],
  },
  links: [
    { transcript_span: 't:44:0', written_spans: ['w:memo:0'], match: 'match' },
    { transcript_span: 't:44:1', written_spans: ['w:memo:1'], match: 'uncertain' },
  ],
  discrepancies: [],
  keywords: [],
  tasks: [],
  questions: [],
});

const reasons = (a: LlmAnalysis) => validateTranscriptLinks(a, spans, texts).map((p) => p.reason);

describe('전사 연결', () => {
  it('전사↔수기 연결은 문제가 없다', () => {
    expect(validateTranscriptLinks(base(), spans, texts)).toEqual([]);
  });

  it('연결의 수기 자리가 비거나 전사 span 이면 안 된다', () => {
    const a = base();
    a.links = [{ transcript_span: 't:44:0', written_spans: [], match: 'match' }];
    expect(reasons(a)).toContain('empty_spans');

    const b = base();
    b.links = [{ transcript_span: 't:44:0', written_spans: ['t:44:1'], match: 'match' }];
    expect(reasons(b)).toContain('not_written');
  });

  it('한 전사 문장은 한 링크뿐이다', () => {
    const a = base();
    a.links.push({ transcript_span: 't:44:0', written_spans: ['w:memo:1'], match: 'uncertain' });
    expect(reasons(a)).toContain('transcript_span_reused');
  });
});

describe('기록 불일치 — T20·T21·T22', () => {
  const discrepancy = () => ({
    transcript_span: 't:44:0',
    written_spans: ['w:memo:0'],
    paragraph_id: '1-1',
    difference: '30만 원 ↔ 35만 원',
    conditions: { ...ALL_TRUE },
  });

  it('T20: 4조건이 모두 true 인 연결 위의 불일치는 선다', () => {
    const a = base();
    a.discrepancies = [discrepancy()];
    expect(validateTranscriptLinks(a, spans, texts)).toEqual([]);
    expect(isDiscrepant(a, 't:44:0')).toBe(true);
    expect(isDiscrepant(a, 't:44:1')).toBe(false);
  });

  it('T21·T22: 조건이 하나라도 false 면 불일치가 아니다 — 누락·어휘 차이·다른 사람·다른 달', () => {
    for (const key of ['same_subject', 'same_attribute', 'same_time', 'incompatible'] as const) {
      const a = base();
      a.discrepancies = [{ ...discrepancy(), conditions: { ...ALL_TRUE, [key]: false } }];
      expect(reasons(a)).toContain('conditions_not_all_true');
    }
  });

  it('연결 없는 전사 문장에 불일치를 붙이지 않는다 — 억지 연결 금지', () => {
    const a = base();
    a.discrepancies = [{ ...discrepancy(), transcript_span: 't:44:9' }];
    expect(reasons(a)).toContain('discrepancy_without_link');
  });

  it('paragraph_id 는 수기 span 을 담은 단락이어야 한다', () => {
    const a = base();
    a.discrepancies = [{ ...discrepancy(), paragraph_id: '9-9' }];
    expect(reasons(a)).toContain('paragraph_mismatch');
  });

  it('차이점은 비어 있지 않고 양쪽 원문의 어휘를 쓴다', () => {
    const a = base();
    a.discrepancies = [{ ...discrepancy(), difference: '  ' }];
    expect(reasons(a)).toContain('empty_difference');

    const b = base();
    b.discrepancies = [{ ...discrepancy(), difference: '시도한 금액이 다름' }];
    expect(reasons(b)).toContain('forbidden_word');
  });
});

describe('전사 상태 상속 — T19·T27', () => {
  it('전사 문장의 색은 연결된 수기 span 의 01 상태를 상속한다', () => {
    const a = base();
    a.record.annotations = [{ span: 'w:memo:0', status: 'completed' }];
    expect(statusForTranscriptSpan(a, 't:44:0')).toBe('completed');
    expect(statusForTranscriptSpan(a, 't:44:1')).toBeNull();
  });

  it('T19: 연결 없는 전사 문장은 상태가 없다 — 전사만으로 색을 만들지 않는다', () => {
    const a = base();
    a.links = [];
    expect(statusForTranscriptSpan(a, 't:44:0')).toBeNull();
  });

  it('T27: 요약 전용 예외는 전사에 파랑을 전파하지 않는다', () => {
    const a = base();
    // 전후 없이 요약에만 실린 항목 — 01 주석이 없으므로 전사 상태도 없다.
    a.summary.changes.newly_revealed = [
      { mode: 'confirmed', lines: ['확인된 내용: 서류를 작성하기로 함'], spans: ['w:memo:1'], summary_only_exception: true, goal: null },
    ];
    expect(statusForTranscriptSpan(a, 't:44:1')).toBeNull();
  });
});
