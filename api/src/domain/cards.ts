// 카드 개폐와 회차 결과 규칙. 순수 함수만 둔다(SPEC §2-2).
import type { Card, CardOutcome, OutcomeResult, Session } from './types.ts';
import { TRACKED_KINDS } from './types.ts';

export type OutcomeSubmission = {
  card_id: number;
  result: Exclude<OutcomeResult, 'unchecked'>;
  follow?: 'continue' | 'stop' | null;
  reason?: string | null;
  note?: string | null;
};

/**
 * 회차 순서상 마지막 결과. 회차 seq 가 큰 쪽이 최신이고,
 * 같은 회차 안에 여러 행이 쌓였으면(고쳐 쓴 경우) **나중에 쓴 행**이 유효하다.
 */
export function latestOutcome(
  card: Card,
  outcomes: CardOutcome[],
  seqBySession: Record<number, number>,
): CardOutcome | undefined {
  let best: CardOutcome | undefined;
  let bestSeq = -1;
  let bestId = -1;
  for (const o of outcomes) {
    if (o.card_id !== card.id) continue;
    const seq = seqBySession[o.session_id] ?? -1;
    if (seq > bestSeq || (seq === bestSeq && o.id > bestId)) {
      bestSeq = seq;
      bestId = o.id;
      best = o;
    }
  }
  return best;
}

/**
 * 열림·닫힘은 저장하지 않고 최신 결과에서 파생한다.
 * unchecked 는 카드를 닫지 않는다 — "이번에 확인 안 함"은 변화 없음이 아니다.
 */
export function isOpen(card: Card, latest: CardOutcome | undefined): boolean {
  if (!TRACKED_KINDS[card.kind]) return false;
  if (!latest) return true;
  switch (latest.result) {
    case 'done':
    case 'confirmed':
      return false;
    case 'not_done':
      return latest.follow !== 'stop';
    default:
      return true;
  }
}

export function openCards(
  cards: Card[],
  outcomes: CardOutcome[],
  sessions: Session[],
): Card[] {
  const seqBySession = indexSeq(sessions);
  return cards.filter((c) => isOpen(c, latestOutcome(c, outcomes, seqBySession)));
}

export function indexSeq(sessions: Session[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const s of sessions) out[s.id] = s.seq;
  return out;
}

/**
 * 회차를 저장할 때 기록할 결과 전체.
 * 제출된 결과를 쓰고, 그 회차에 올라와 있던 열린 카드 중 제출되지 않은 것은 unchecked 로 남긴다.
 * 같은 트랜잭션에서 함께 써야 한다(SPEC §2-2).
 */
export function resolveOutcomes(
  openBefore: Card[],
  submitted: OutcomeSubmission[],
): Array<OutcomeSubmission | { card_id: number; result: 'unchecked' }> {
  const submittedIds = new Set(submitted.map((s) => s.card_id));
  const rows: Array<OutcomeSubmission | { card_id: number; result: 'unchecked' }> = [...submitted];
  for (const card of openBefore) {
    if (!submittedIds.has(card.id)) rows.push({ card_id: card.id, result: 'unchecked' });
  }
  return rows;
}

/** 지난 회차에서 unchecked 로 넘어온 건수. 15초 다시보기가 따로 보여 준다. */
export function uncheckedCarriedOver(
  cards: Card[],
  outcomes: CardOutcome[],
  sessions: Session[],
): number {
  const seqBySession = indexSeq(sessions);
  let n = 0;
  for (const card of cards) {
    const latest = latestOutcome(card, outcomes, seqBySession);
    if (latest?.result === 'unchecked') n += 1;
  }
  return n;
}
