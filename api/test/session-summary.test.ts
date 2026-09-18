// 02 회차별 요약 검증기 단위 테스트. DB 없이 합성 수기 문장으로 돌린다.
import { describe, expect, it } from 'vitest';
import { spansOf, type LlmAnalysis, type SourceSpan } from '../src/domain/record-analysis.ts';
import { renderOrder, validateSessionSummary } from '../src/domain/session-summary.ts';

const MEMO = '서류를 작성하기로 함.\n작성을 마침.\n다음에 확인하기로 함.';
const CARD = '주민센터에 신청을 완료함.';

const DOC_TEXT: Record<string, string> = { memo: MEMO, 'card:7': CARD };
const spans: SourceSpan[] = [...spansOf('w', 'memo', MEMO), ...spansOf('w', 'card:7', CARD)];
const texts = (id: string): string => {
  const s = spans.find((x) => x.id === id);
  return s ? DOC_TEXT[s.doc].slice(s.start, s.end) : '';
};

const base = (): LlmAnalysis => ({
  record: {
    topics: [{ id: '01', title: '서류 작성', paragraph_ids: ['1-1'] }],
    paragraphs: [{ id: '1-1', title: '서류 작성', spans: ['w:memo:0', 'w:memo:1', 'w:memo:2', 'w:card:7:0'] }],
    annotations: [],
  },
  summary: {
    core: [{ text: '서류를 작성하기로 하고 작성을 마침', spans: ['w:memo:0', 'w:memo:1'], goal: 'session' }],
    changes: { promise_result: [], newly_revealed: [], new_possibility: [] },
    follow_up: [],
    completed: [],
  },
  links: [],
  discrepancies: [],
  keywords: [],
  tasks: [],
  questions: [],
});

const reasons = (a: LlmAnalysis) => validateSessionSummary(a, spans, texts).map((p) => p.reason);

describe('이번 상담의 핵심', () => {
  it('1~2줄만 허용한다', () => {
    expect(validateSessionSummary(base(), spans, texts)).toEqual([]);

    const none = base();
    none.summary.core = [];
    expect(reasons(none)).toContain('core_count');

    const many = base();
    many.summary.core = [
      { text: '서류 작성', spans: ['w:memo:0'], goal: null },
      { text: '작성 마침', spans: ['w:memo:1'], goal: null },
      { text: '다음 확인', spans: ['w:memo:2'], goal: null },
    ];
    expect(reasons(many)).toContain('core_count');
  });

  it('근거 span 이 비거나 전사면 안 되고, 목표는 overall|session|null 이다', () => {
    const a = base();
    a.summary.core = [{ text: '서류 작성', spans: [], goal: null }];
    expect(reasons(a)).toContain('empty_spans');

    const b = base();
    b.summary.core = [{ text: '서류 작성', spans: ['w:memo:0'], goal: 'weekly' as never }];
    expect(reasons(b)).toContain('bad_goal');
  });
});

describe('약속 이행 여부 — T08·T09·T13', () => {
  const item = () => ({
    promise: '서류를 작성하기로 함',
    result: '작성을 마침',
    promise_spans: ['w:memo:0'],
    result_spans: ['w:memo:1'],
    changes: [],
    goal: null,
  });

  it('T08·T13: 약속만 있고 결과가 없으면 이 항목은 설 수 없다', () => {
    const a = base();
    a.summary.changes.promise_result = [{ ...item(), result_spans: [] }];
    expect(reasons(a)).toContain('empty_spans');
  });

  it('T09: 같은 회차에 약속과 결과가 둘 다 있으면 선다', () => {
    const a = base();
    a.summary.changes.promise_result = [item()];
    expect(validateSessionSummary(a, spans, texts)).toEqual([]);
  });

  it('변화점은 01 의 change 주석이 있을 때만, ∴ 는 변화점이 있을 때만 쓴다', () => {
    const a = base();
    a.summary.changes.promise_result = [{ ...item(), changes: [{ before: '하기로 함', after: '마침' }] }];
    expect(reasons(a)).toContain('changes_without_annotation');

    const b = base();
    b.record.annotations = [{ span: 'w:memo:1', status: 'change', before: ['w:memo:0'], after: ['w:memo:1'] }];
    b.summary.changes.promise_result = [{ ...item(), changes: [{ before: '하기로 함', after: '마침' }] }];
    expect(validateSessionSummary(b, spans, texts)).toEqual([]);

    const c = base();
    c.summary.changes.promise_result = [{ ...item(), conclusion: '작성을 마침' }];
    expect(reasons(c)).toContain('conclusion_without_changes');
  });
});

describe('상담 중 새로 드러난 것 — T10·T18', () => {
  it('T10: 전후 없는 새 정보는 confirmed + summary_only_exception 이다', () => {
    const a = base();
    a.summary.changes.newly_revealed = [
      { mode: 'confirmed', lines: ['확인된 내용: 다음에 확인하기로 함'], spans: ['w:memo:2'], summary_only_exception: true, goal: null },
    ];
    expect(validateSessionSummary(a, spans, texts)).toEqual([]);
  });

  it('mode=change 인데 01 change 주석이 없거나, confirmed 인데 예외 플래그가 없으면 안 된다', () => {
    const a = base();
    a.summary.changes.newly_revealed = [
      { mode: 'change', lines: ['변화점: 다음에 확인하기로 함'], spans: ['w:memo:2'], summary_only_exception: false, goal: null },
    ];
    expect(reasons(a)).toContain('newly_revealed_mode');

    const b = base();
    b.summary.changes.newly_revealed = [
      { mode: 'confirmed', lines: ['확인된 내용: 다음에 확인하기로 함'], spans: ['w:memo:2'], summary_only_exception: false, goal: null },
    ];
    expect(reasons(b)).toContain('newly_revealed_mode');
  });

  it('T18: 원문에 없는 대사는 만들 수 없다', () => {
    const a = base();
    a.summary.changes.newly_revealed = [
      {
        dialogue: { worker: '어떻게 하셨나요' },
        mode: 'confirmed',
        lines: ['확인된 내용: 작성을 마침'],
        spans: ['w:memo:1'],
        summary_only_exception: true,
        goal: null,
      },
    ];
    expect(reasons(a)).toContain('dialogue_not_verbatim');

    const b = base();
    b.summary.changes.newly_revealed = [
      {
        dialogue: { participant: '작성을 마침' },
        mode: 'confirmed',
        lines: ['확인된 내용: 작성을 마침'],
        spans: ['w:memo:1'],
        summary_only_exception: true,
        goal: null,
      },
    ];
    expect(validateSessionSummary(b, spans, texts)).toEqual([]);
  });
});

describe('이번 상담 후 새로운 가능성 — T11', () => {
  it('T11: 계획만 있고 01 변화 근거가 없으면 설 수 없다', () => {
    const a = base();
    a.summary.changes.new_possibility = [
      { lines: ['다음에 확인하기로 함'], change_spans: ['w:memo:1'], plan_spans: ['w:memo:2'], goal: null },
    ];
    expect(reasons(a)).toContain('new_possibility_needs_change');
  });

  it('변화 span 이 있고 계획이 그 후반이면 선다', () => {
    const a = base();
    a.record.annotations = [{ span: 'w:memo:1', status: 'change', before: ['w:memo:0'], after: ['w:memo:1'] }];
    a.summary.changes.new_possibility = [
      { lines: ['작성을 마침 → 다음에 확인하기로 함'], change_spans: ['w:memo:1'], plan_spans: ['w:memo:2'], goal: null },
    ];
    expect(validateSessionSummary(a, spans, texts)).toEqual([]);
  });

  it('계획이 변화보다 앞에 오면 안 된다', () => {
    const a = base();
    a.record.annotations = [{ span: 'w:memo:2', status: 'change', before: ['w:memo:0'], after: ['w:memo:2'] }];
    a.summary.changes.new_possibility = [
      { lines: ['다음에 확인하기로 함'], change_spans: ['w:memo:2'], plan_spans: ['w:memo:1'], goal: null },
    ];
    expect(reasons(a)).toContain('new_possibility_order');
  });
});

describe('확인필요·완료·해결 — T14·T15', () => {
  it('T14: `신청할 예정` 은 완료가 아니고 `신청을 완료함` 은 완료다', () => {
    const s = spansOf('w', 'memo', '주민센터에 신청할 예정임.');
    const t = (id: string) => {
      const span = s.find((x) => x.id === id)!;
      return '주민센터에 신청할 예정임.'.slice(span.start, span.end);
    };
    const a = base();
    a.summary.completed = [{ text: '신청할 예정', spans: ['w:memo:0'], goal: null }];
    expect(validateSessionSummary(a, s, t).map((p) => p.reason)).toContain('completed_intention_only');

    const b = base();
    b.summary.completed = [{ text: '신청을 완료함', spans: ['w:card:7:0'], goal: null }];
    expect(validateSessionSummary(b, spans, texts)).toEqual([]);
  });

  it('T15: 중요하지만 변화·완료가 아닌 현재 상태는 확인필요로 둘 수 있다', () => {
    const s = spansOf('w', 'memo', '건강 상태가 중요한 관심사임.');
    const t = (id: string) => {
      const span = s.find((x) => x.id === id)!;
      return '건강 상태가 중요한 관심사임.'.slice(span.start, span.end);
    };
    const a = base();
    a.summary.follow_up = [{ text: '건강 상태 확인', spans: ['w:memo:0'], goal: null }];
    // 단순 중요 상태를 follow_up 으로 둔 것은 검증기가 막지 않는다 — 선별은 모델·사람 승인 몫.
    expect(validateSessionSummary(a, s, t)).toEqual([]);
  });

  it('이미 완료된 것을 확인필요로 올리지 않는다', () => {
    const a = base();
    a.summary.follow_up = [{ text: '신청을 완료함', spans: ['w:card:7:0'], goal: null }];
    expect(reasons(a)).toContain('follow_up_already_done');
  });

  it('같은 span 묶음이 완료와 확인필요에 동시에 있으면 안 된다', () => {
    const a = base();
    a.summary.completed = [{ text: '신청을 완료함', spans: ['w:card:7:0'], goal: null }];
    a.summary.follow_up = [{ text: '신청을 완료함', spans: ['w:card:7:0'], goal: null }];
    expect(reasons(a)).toContain('follow_up_completed_dup');
  });
});

describe('어휘 보존·중복 — T17', () => {
  it('T17: 원문이 `노력함` 인데 생성문이 `시도함` 이면 실패다', () => {
    const s = spansOf('w', 'memo', '매일 노력함.');
    const t = (id: string) => {
      const span = s.find((x) => x.id === id)!;
      return '매일 노력함.'.slice(span.start, span.end);
    };
    const a = base();
    a.summary.core = [{ text: '매일 시도함', spans: ['w:memo:0'], goal: null }];
    expect(validateSessionSummary(a, s, t).map((p) => p.reason)).toContain('forbidden_word');
  });

  it('같은 span 묶음이 변화 3하위의 두 곳에 걸치면 duplicate_subsection', () => {
    const a = base();
    a.summary.changes.promise_result = [
      { promise: '서류를 작성하기로 함', result: '작성을 마침', promise_spans: ['w:memo:0'], result_spans: ['w:memo:1'], changes: [], goal: null },
    ];
    a.summary.changes.newly_revealed = [
      { mode: 'confirmed', lines: ['확인된 내용: 서류 작성'], spans: ['w:memo:0', 'w:memo:1'], summary_only_exception: true, goal: null },
    ];
    expect(reasons(a)).toContain('duplicate_subsection');
  });
});

describe('하위 항목 번호 — T12', () => {
  const pr = {
    promise: '서류를 작성하기로 함',
    result: '작성을 마침',
    promise_spans: ['w:memo:0'],
    result_spans: ['w:memo:1'],
    changes: [],
    goal: null,
  };
  const nr = {
    mode: 'confirmed' as const,
    lines: ['확인된 내용: 다음에 확인하기로 함'],
    spans: ['w:memo:2'],
    summary_only_exception: true,
    goal: null,
  };
  const np = { lines: ['작성을 마침 → 다음에 확인하기로 함'], change_spans: ['w:memo:1'], plan_spans: ['w:memo:2'], goal: null };

  it('내용 있는 하위 항목만 ①부터 연속 번호를 매긴다 — 7가지 조합', () => {
    const combos: Array<[boolean, boolean, boolean, string[]]> = [
      [true, false, false, ['약속 이행 여부']],
      [false, true, false, ['상담 중 새로 드러난 것']],
      [false, false, true, ['이번 상담 후 새로운 가능성']],
      [true, true, false, ['약속 이행 여부', '상담 중 새로 드러난 것']],
      [true, false, true, ['약속 이행 여부', '이번 상담 후 새로운 가능성']],
      [false, true, true, ['상담 중 새로 드러난 것', '이번 상담 후 새로운 가능성']],
      [true, true, true, ['약속 이행 여부', '상담 중 새로 드러난 것', '이번 상담 후 새로운 가능성']],
    ];
    for (const [p, n, x, labels] of combos) {
      const a = base();
      if (p) a.summary.changes.promise_result = [pr];
      if (n) a.summary.changes.newly_revealed = [nr];
      if (x) a.summary.changes.new_possibility = [np];
      const order = renderOrder(a.summary);
      expect(order.map((o) => o.label)).toEqual(labels);
      expect(order.map((o) => o.number)).toEqual(labels.map((_, i) => i + 1));
    }
  });

  it('모두 비면 아무것도 내지 않는다', () => {
    expect(renderOrder(base().summary)).toEqual([]);
  });
});
