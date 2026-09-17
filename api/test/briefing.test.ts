// 조립 로직만 검사한다. DB·DOM 결합 없음.
import { describe, expect, it } from 'vitest';
import { buildBriefing } from '../src/domain/briefing.ts';
import { openCards, resolveOutcomes } from '../src/domain/cards.ts';
import { todayGoalFor } from '../src/domain/goals.ts';
import type { Card, CardOutcome, Session, SupportCase } from '../src/domain/types.ts';

const supportCase: SupportCase = {
  id: 1,
  participant_id: 1,
  program_id: 1,
  program_name: '함께온기금 울타리대출',
  status: 'open',
  overall_goal: null,
  overall_goal_source: null,
  sessions_planned: 6,
};

const session = (over: Partial<Session> & { id: number; seq: number }): Session => ({
  case_id: 1,
  kind: 'regular',
  status: 'done',
  scheduled_at: null,
  method: null,
  place: null,
  plan_memo: null,
  held_at: null,
  memo: null,
  detail: {},
  today_goal_text: null,
  today_goal_from_session_id: null,
  next_goal_text: null,
  next_goal_consumed_by_session_id: null,
  ...over,
});

const card = (over: Partial<Card> & { id: number; kind: Card['kind']; source_session_id: number }): Card => ({
  case_id: 1,
  text: '카드',
  area: null,
  topic_key: null,
  risk_type: null,
  quote: null,
  source_section: 'promise',
  source_type: 'manual',
  created_at: '',
  ...over,
});

describe('15초 다시보기', () => {
  const sessions = [
    session({ id: 10, seq: 1, kind: 'intake' }),
    session({ id: 11, seq: 2, next_goal_text: '서류 준비 상황 확인' }),
    session({ id: 12, seq: 3, status: 'planned' }),
  ];
  const cards = [
    card({ id: 1, kind: 'promise', text: '서류 떼어 오기', source_session_id: 11 }),
    card({ id: 2, kind: 'question', text: '가족 지원 여부', source_session_id: 11, source_section: 'question' }),
  ];

  it('사람이 적는 항목은 비면 빠지고 AI 항목은 상태와 함께 남는다', () => {
    const empty = buildBriefing({
      supportCase,
      pseudonym: 'swallow-001',
      name: null,
      sessions: [session({ id: 10, seq: 1, kind: 'intake' })],
      cards: [],
      outcomes: [],
    });
    expect(empty.goals).toBeNull();
    expect(empty.today_questions).toBeNull();
    expect(empty.open_tasks).toBeNull();
    expect(empty.risk_signals.status.reason).toBe('ai_disabled');
    expect(empty.last_session_summary.summary_state).toBe('none');
  });

  it('열린 과제와 질문이 출처 회차 번호와 함께 올라온다', () => {
    const b = buildBriefing({ supportCase, pseudonym: 'swallow-001', name: '김민희', sessions, cards, outcomes: [] });
    expect(b.open_tasks?.items[0]).toMatchObject({ text: '서류 떼어 오기', source_session_seq: 2 });
    expect(b.today_questions?.[0]).toMatchObject({ text: '가족 지원 여부', source_session_seq: 2 });
  });

  it('다음 상담 목표가 다음 회차의 오늘 상담 목표로 뜨고 조회로 소비되지 않는다', () => {
    const b = buildBriefing({ supportCase, pseudonym: 'swallow-001', name: null, sessions, cards, outcomes: [] });
    expect(b.goals?.today).toEqual({ text: '서류 준비 상황 확인', from_session_seq: 2 });
    expect(sessions[1].next_goal_consumed_by_session_id).toBeNull();
  });

  it('취소된 예약은 목표를 소비하지 않는다', () => {
    const onlyDone = sessions.filter((s) => s.status === 'done');
    const later = session({ id: 13, seq: 4, status: 'planned' });
    expect(todayGoalFor(later, [...onlyDone, later])?.text).toBe('서류 준비 상황 확인');
  });
});

describe('카드 결과', () => {
  const sessions = [session({ id: 11, seq: 1 }), session({ id: 12, seq: 2 })];
  const promise = card({ id: 1, kind: 'promise', source_session_id: 11 });

  it('결과를 안 누르면 unchecked 가 남고 카드는 열린 채로 다음 회차에 올라온다', () => {
    const rows = resolveOutcomes([promise], []);
    expect(rows).toEqual([{ card_id: 1, result: 'unchecked' }]);

    const outcomes: CardOutcome[] = [
      { id: 1, card_id: 1, session_id: 12, result: 'unchecked', follow: null, reason: null, note: null },
    ];
    expect(openCards([promise], outcomes, sessions)).toHaveLength(1);
  });

  it('못 함 + 그만둔다만 카드를 닫고, 계속한다는 열어 둔다', () => {
    const stop: CardOutcome[] = [
      { id: 1, card_id: 1, session_id: 12, result: 'not_done', follow: 'stop', reason: '본인 철회', note: null },
    ];
    const keep: CardOutcome[] = [
      { id: 1, card_id: 1, session_id: 12, result: 'not_done', follow: 'continue', reason: null, note: null },
    ];
    expect(openCards([promise], stop, sessions)).toHaveLength(0);
    expect(openCards([promise], keep, sessions)).toHaveLength(1);
  });
});
