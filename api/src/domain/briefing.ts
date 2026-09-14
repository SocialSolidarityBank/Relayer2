// 15초 다시보기 6구획. 저장물이 아니라 조립 결과다(SPEC §3).
// 규칙: 사람이 적는 항목(목표·오늘 물어볼 것·확인할 과제)은 비면 뺀다.
//       AI가 관여하는 항목(위험 신호·직전 회차 요약)은 비어도 남기고 상태를 쓴다.
import type { Card, CardOutcome, Session, SupportCase } from './types.ts';
import { indexSeq, latestOutcome, openCards, uncheckedCarriedOver } from './cards.ts';
import { todayGoalFor } from './goals.ts';
import { buildSessionLine } from './session-line.ts';

export type CheckStatus = {
  state: 'checked' | 'not_checked' | 'checking';
  reason: 'ai_disabled' | 'no_recording' | 'pending' | null;
  through_session_seq: number | null;
};

export type BriefingItem = {
  card_id: number;
  text: string;
  source_session_seq: number;
  last_result: string | null;
};

export type Briefing = {
  case_id: number;
  risk_signals: { items: BriefingItem[]; status: CheckStatus };
  participant_card: {
    pseudonym: string;
    name: string | null;
    program_name: string;
    session_seq: number | null;
    sessions_planned: number | null;
    scheduled_at: string | null;
    method: string | null;
  };
  goals: { overall: string | null; today: { text: string; from_session_seq: number | null } | null } | null;
  last_session_summary: {
    session_seq: number | null;
    line: string | null;
    summary_state: 'none';
    status: CheckStatus;
  };
  today_questions: BriefingItem[] | null;
  open_tasks: { items: BriefingItem[]; unchecked_carried_over: number } | null;
};

export type BriefingInput = {
  supportCase: SupportCase;
  pseudonym: string;
  /** 금고에서 복호화한 이름. 당사자 카드에만 쓴다. */
  name: string | null;
  sessions: Session[];
  cards: Card[];
  outcomes: CardOutcome[];
};

const AI_OFF: CheckStatus = { state: 'not_checked', reason: 'ai_disabled', through_session_seq: null };

export function buildBriefing(input: BriefingInput): Briefing {
  const { supportCase, sessions, cards, outcomes } = input;
  const seqBySession = indexSeq(sessions);
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => b.seq - a.seq);
  const upcoming = sessions
    .filter((s) => s.status === 'planned')
    .sort((a, b) => a.seq - b.seq)[0];
  const lastDone = done[0];

  const toItem = (card: Card): BriefingItem => ({
    card_id: card.id,
    text: card.text,
    source_session_seq: seqBySession[card.source_session_id] ?? 0,
    last_result: latestOutcome(card, outcomes, seqBySession)?.result ?? null,
  });

  const open = openCards(cards, outcomes, sessions).sort(
    (a, b) => (seqBySession[a.source_session_id] ?? 0) - (seqBySession[b.source_session_id] ?? 0),
  );
  const questions = open.filter((c) => c.kind === 'question').map(toItem);
  const tasks = open.filter((c) => c.kind === 'promise');

  // 위험 신호는 확정된 것만. 위험 관련 과제는 목록 위로 올린다.
  const risks = cards.filter((c) => c.kind === 'judgment' && c.risk_type).map(toItem);
  const riskTexts = new Set(risks.map((r) => r.text));
  const taskItems = [
    ...tasks.filter((c) => riskTexts.has(c.text)).map(toItem),
    ...tasks.filter((c) => !riskTexts.has(c.text)).map(toItem),
  ];

  const target = upcoming ?? lastDone;
  const today = target ? todayGoalFor(target, sessions) : null;
  const hasGoals = Boolean(supportCase.overall_goal) || Boolean(today);

  return {
    case_id: supportCase.id,
    risk_signals: { items: risks, status: AI_OFF },
    participant_card: {
      pseudonym: input.pseudonym,
      name: input.name,
      program_name: supportCase.program_name,
      session_seq: target?.seq ?? null,
      sessions_planned: supportCase.sessions_planned,
      scheduled_at: upcoming?.scheduled_at ?? null,
      method: upcoming?.method ?? null,
    },
    goals: hasGoals
      ? {
          overall: supportCase.overall_goal,
          today: today ? { text: today.text, from_session_seq: today.fromSessionSeq } : null,
        }
      : null,
    last_session_summary: {
      session_seq: lastDone?.seq ?? null,
      line: lastDone ? buildSessionLine(lastDone, cards) : null,
      summary_state: 'none',
      status: lastDone
        ? { state: 'not_checked', reason: 'ai_disabled', through_session_seq: lastDone.seq }
        : AI_OFF,
    },
    today_questions: questions.length > 0 ? questions : null,
    open_tasks:
      taskItems.length > 0
        ? { items: taskItems, unchecked_carried_over: uncheckedCarriedOver(tasks, outcomes, sessions) }
        : null,
  };
}
