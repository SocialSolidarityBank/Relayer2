// 목표 세 층. 이어받기와 수정 규칙은 SPEC §4.
import type { Session } from './types.ts';

/** 아직 소비되지 않은 다음 상담 목표를 가진 가장 최근의 기록 완료 회차. */
export function pendingNextGoal(sessions: Session[]): Session | undefined {
  return sessions
    .filter((s) => s.status === 'done' && s.next_goal_text && !s.next_goal_consumed_by_session_id)
    .sort((a, b) => b.seq - a.seq)[0];
}

export type TodayGoal = { text: string; fromSessionSeq: number | null };

/**
 * 다가오는 회차의 오늘 상담 목표.
 * 이미 이어받았으면 그 값을, 아직이면 직전 회차의 다음 상담 목표를 미리 보여 준다.
 * 조회는 소비가 아니다 — 소비는 회차를 실제로 기록할 때만 일어난다.
 */
export function todayGoalFor(target: Session, sessions: Session[]): TodayGoal | null {
  if (target.today_goal_text) {
    const from = sessions.find((s) => s.id === target.today_goal_from_session_id);
    return { text: target.today_goal_text, fromSessionSeq: from?.seq ?? null };
  }
  const pending = pendingNextGoal(sessions.filter((s) => s.seq < target.seq));
  return pending?.next_goal_text ? { text: pending.next_goal_text, fromSessionSeq: pending.seq } : null;
}

/** 회차를 기록할 때 이어받을 목표. 없으면 목표 없음이며 옛 목표를 부활시키지 않는다. */
export function carryOverOnRecord(
  target: Session,
  sessions: Session[],
): { text: string; fromSessionId: number } | null {
  if (target.today_goal_text) return null;
  const pending = pendingNextGoal(sessions.filter((s) => s.seq < target.seq));
  return pending?.next_goal_text ? { text: pending.next_goal_text, fromSessionId: pending.id } : null;
}
