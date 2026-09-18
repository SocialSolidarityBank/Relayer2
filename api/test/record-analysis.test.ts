// 01 구조화된 상담 기록 검증기 단위 테스트. DB 없이 합성 수기·전사 문장으로 돌린다.
import { describe, expect, it } from 'vitest';
import {
  checkReferences,
  spansOf,
  type LlmAnalysis,
  type SourceSpan,
} from '../src/domain/record-analysis.ts';
import {
  paragraphOfSpan,
  statusOfSpan,
  validateStructuredRecord,
} from '../src/domain/structured-record.ts';

const MEMO = '서류를 작성하기로 함.\n작성을 마침.\n다음에 확인하기로 함.';
const CARD = '주민센터에 신청함.';
const TRANSCRIPT = '서류를 작성했다고 말함.';

const DOC_TEXT: Record<string, string> = { memo: MEMO, 'card:7': CARD, '44': TRANSCRIPT };
const spans: SourceSpan[] = [
  ...spansOf('w', 'memo', MEMO),
  ...spansOf('w', 'card:7', CARD),
  ...spansOf('t', '44', TRANSCRIPT),
];
const texts = (id: string): string => {
  const s = spans.find((x) => x.id === id);
  return s ? DOC_TEXT[s.doc].slice(s.start, s.end) : '';
};

const emptySummary = () => ({
  core: [],
  changes: { promise_result: [], newly_revealed: [], new_possibility: [] },
  follow_up: [],
  completed: [],
});

/** 수기 span 전부를 시간순으로 담은 정상 구조. */
const base = (): LlmAnalysis => ({
  record: {
    topics: [{ id: '01', title: '서류 작성', paragraph_ids: ['1-1', '1-2'] }],
    paragraphs: [
      { id: '1-1', title: '서류 작성', spans: ['w:memo:0', 'w:memo:1', 'w:memo:2'] },
      { id: '1-2', title: '주민센터 신청', spans: ['w:card:7:0'] },
    ],
    annotations: [],
  },
  summary: emptySummary(),
  links: [],
  discrepancies: [],
  keywords: [],
  tasks: [],
  questions: [],
});

const reasons = (a: LlmAnalysis) => validateStructuredRecord(a, spans, texts).map((p) => p.reason);

describe('단락 분할 — 원문 무손실·시간순', () => {
  it('수기 span 전부를 순서대로 담으면 문제가 없다', () => {
    expect(validateStructuredRecord(base(), spans, texts)).toEqual([]);
  });

  it('T24: 같은 문장이 두 번 나와도 각각 고유 span 이라 둘 다 배치할 수 있다', () => {
    const text = '같은 말을 함.\n같은 말을 함.';
    const s = spansOf('w', 'memo', text);
    expect(s.map((x) => x.id)).toEqual(['w:memo:0', 'w:memo:1']);
    const a = base();
    a.record.topics = [{ id: '01', title: '같은 말', paragraph_ids: ['1-1'] }];
    a.record.paragraphs = [{ id: '1-1', title: '같은 말', spans: ['w:memo:0', 'w:memo:1'] }];
    const t = (id: string) => {
      const span = s.find((x) => x.id === id)!;
      return text.slice(span.start, span.end);
    };
    expect(validateStructuredRecord(a, s, t)).toEqual([]);
  });

  it('뒤 문장을 앞으로 옮기면 order_violation', () => {
    const a = base();
    a.record.paragraphs = [
      { id: '1-1', title: '서류 작성', spans: ['w:memo:1', 'w:memo:0', 'w:memo:2'] },
      { id: '1-2', title: '주민센터 신청', spans: ['w:card:7:0'] },
    ];
    expect(reasons(a)).toContain('order_violation');
  });

  it('어느 단락에도 없는 span 은 span_missing', () => {
    const a = base();
    a.record.paragraphs = [{ id: '1-1', title: '서류 작성', spans: ['w:memo:0', 'w:memo:1', 'w:memo:2'] }];
    a.record.topics = [{ id: '01', title: '서류 작성', paragraph_ids: ['1-1'] }];
    expect(reasons(a)).toContain('span_missing');
  });

  it('한 span 을 두 단락이 나눠 가지면 span_repeated', () => {
    const a = base();
    a.record.paragraphs = [
      { id: '1-1', title: '서류 작성', spans: ['w:memo:0', 'w:memo:1'] },
      { id: '1-2', title: '주민센터 신청', spans: ['w:memo:1', 'w:memo:2', 'w:card:7:0'] },
    ];
    expect(reasons(a)).toContain('span_repeated');
  });
});

describe('주제 묶음', () => {
  it('단락이 두 주제에 걸치면 paragraph_multi_topic, 어느 주제에도 없으면 paragraph_unassigned', () => {
    const a = base();
    a.record.topics = [
      { id: '01', title: '서류 작성', paragraph_ids: ['1-1', '1-2'] },
      { id: '02', title: '서류 확인', paragraph_ids: ['1-2'] },
    ];
    expect(reasons(a)).toContain('paragraph_multi_topic');

    const b = base();
    b.record.topics = [{ id: '01', title: '서류 작성', paragraph_ids: ['1-1'] }];
    expect(reasons(b)).toContain('paragraph_unassigned');
  });

  it('주제 id 중복과 없는 단락 참조를 잡는다', () => {
    const a = base();
    a.record.topics = [
      { id: '01', title: '서류 작성', paragraph_ids: ['1-1'] },
      { id: '01', title: '서류 확인', paragraph_ids: ['1-2', '9-9'] },
    ];
    expect(reasons(a)).toEqual(expect.arrayContaining(['duplicate_topic_id', 'unknown_paragraph']));
  });
});

describe('제목 — 원문 어휘 조합', () => {
  it('빈 제목은 empty_title', () => {
    const a = base();
    a.record.paragraphs[0].title = '  ';
    expect(reasons(a)).toContain('empty_title');
  });

  it('T17: 원문에 없는 금지어를 제목에 쓰면 forbidden_word', () => {
    const a = base();
    a.record.paragraphs[0].title = '서류 시도';
    expect(reasons(a)).toContain('forbidden_word');
  });

  it('원문 어휘가 아닌 제목은 title_not_from_source', () => {
    const a = base();
    a.record.paragraphs[0].title = '우주 여행';
    expect(reasons(a)).toContain('title_not_from_source');
  });
});

describe('상태 띠', () => {
  it('change 는 before·after 가 둘 다 있고 before 가 앞에 와야 한다', () => {
    const ok = base();
    ok.record.annotations = [{ span: 'w:memo:1', status: 'change', before: ['w:memo:0'], after: ['w:memo:1'] }];
    expect(validateStructuredRecord(ok, spans, texts)).toEqual([]);

    const missing = base();
    missing.record.annotations = [{ span: 'w:memo:1', status: 'change' }];
    expect(reasons(missing)).toContain('change_needs_before_after');

    const reversed = base();
    reversed.record.annotations = [{ span: 'w:memo:0', status: 'change', before: ['w:memo:2'], after: ['w:memo:0'] }];
    expect(reasons(reversed)).toContain('change_order');
  });

  it('전사 span 에는 상태를 붙이지 않고, 한 span 에 주석은 하나다', () => {
    const a = base();
    a.record.annotations = [
      { span: 't:44:0', status: 'completed' },
      { span: 'w:memo:0', status: 'follow_up' },
      { span: 'w:memo:0', status: 'completed' },
    ];
    expect(reasons(a)).toEqual(expect.arrayContaining(['annotation_not_written', 'annotation_conflict']));
  });

  it('T27: 요약 전용 예외 항목의 span 에 change 주석이 붙으면 summary_only_change', () => {
    const a = base();
    a.record.annotations = [{ span: 'w:memo:2', status: 'change', before: ['w:memo:0'], after: ['w:memo:2'] }];
    a.summary.changes.newly_revealed = [
      { mode: 'confirmed', lines: ['확인된 내용: 다음에 확인하기로 함'], spans: ['w:memo:2'], summary_only_exception: true, goal: null },
    ];
    expect(reasons(a)).toContain('summary_only_change');
  });
});

describe('키워드·참조', () => {
  it('LLM 키워드는 참조 span 안에 그 문자열이 있어야 한다', () => {
    const a = base();
    a.keywords = [{ text: '멘토링', spans: ['w:memo:0'] }];
    expect(reasons(a)).toContain('keyword_not_in_source');

    const b = base();
    b.keywords = [{ text: '서류', spans: ['w:memo:0'] }];
    expect(validateStructuredRecord(b, spans, texts)).toEqual([]);
  });

  it('T23: 회차 밖 span 참조는 checkReferences 가 unknown_span 으로 잡는다', () => {
    const a = base();
    a.record.paragraphs[0].spans = ['w:memo:0', 'w:memo:99', 'w:memo:1', 'w:memo:2'];
    const problems = checkReferences(a, spans);
    expect(problems).toContainEqual({ where: 'paragraph 1-1', span: 'w:memo:99', reason: 'unknown_span' });
  });

  it('수기 자리의 전사 span 은 checkReferences 가 not_written 으로 잡는다', () => {
    const a = base();
    a.record.paragraphs[0].spans = ['w:memo:0', 't:44:0', 'w:memo:1', 'w:memo:2'];
    const problems = checkReferences(a, spans);
    expect(problems).toContainEqual({ where: 'paragraph 1-1', span: 't:44:0', reason: 'not_written' });
  });
});

describe('조회 헬퍼', () => {
  it('paragraphOfSpan 은 span 을 담은 단락을, statusOfSpan 은 01 상태를 돌려준다', () => {
    const a = base();
    a.record.annotations = [{ span: 'w:memo:1', status: 'completed' }];
    expect(paragraphOfSpan(a.record, 'w:memo:1')?.id).toBe('1-1');
    expect(paragraphOfSpan(a.record, 'w:memo:9')).toBeNull();
    expect(statusOfSpan(a.record, 'w:memo:1')).toBe('completed');
    expect(statusOfSpan(a.record, 'w:memo:0')).toBeNull();
  });
});
