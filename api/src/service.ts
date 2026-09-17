// DB 접근은 여기 하나로 모은다. 쓰기는 전부 트랜잭션 하나 안에서 끝낸다.
import {
  activeDomains,
  CONSENT_COPY,
  CONSENT_DOMAINS,
  copyHash,
  foldConsent,
  COPY_VERSION,
  type ConsentDecision,
  type ConsentDomain,
  type ConsentEventRow,
  type ConsentStatus,
} from './consent.ts';
import { sql } from './db.ts';
import {
  decryptJson,
  decryptPii,
  decryptText,
  encryptJson,
  encryptPii,
  encryptText,
  KEY_VERSION,
} from './pii.ts';
import { buildBriefing, type Briefing } from './domain/briefing.ts';
import { buildMismatches, type MismatchView } from './domain/mismatch-view.ts';
import { openCards, resolveOutcomes, type OutcomeSubmission } from './domain/cards.ts';
import { carryOverOnRecord } from './domain/goals.ts';
import { buildSessionLine } from './domain/session-line.ts';
import type { Assignee, Card, CardOutcome, FactChange, Session, SupportCase } from './domain/types.ts';
import { assertCaseOpen, assertProgramActive, NotFound, ProgramRetired } from './access.ts';

const ANIMALS = [
  'swallow', 'otter', 'heron', 'badger', 'marten', 'crane', 'gecko', 'finch', 'ibex', 'lynx',
];

export type NewCardInput = {
  kind: Card['kind'];
  text: string;
  section: Card['source_section'];
  area?: Card['area'];
  risk_type?: string | null;
  quote?: string | null;
};

/**
 * 다음 가명. **세지 않고 뽑는다**(2026-09-16 버그 수정).
 *
 * 전에는 `count(*) + 1` 이었다. 당사자를 지우면 그 수가 줄어 이미 쓴 가명이 다시 나오고,
 * 유일 제약에 걸려 등록이 500 으로 죽었다. 세는 것과 번호 매기는 것은 다른 일이다 —
 * 시퀀스는 뒤로 가지 않는다.
 */
async function nextPseudonym(tx: typeof sql): Promise<string> {
  const [{ n }] = await tx<{ n: string }[]>`select nextval('participant_seq')::text as n`;
  const seq = Number(n);
  return `${ANIMALS[seq % ANIMALS.length]}-${String(seq).padStart(3, '0')}`;
}

export async function createCase(input: {
  name: string;
  phone?: string;
  email?: string;
  birth?: string;
  address?: string;
  program_id: number;
  sessions_planned?: number;
  /** 등록 화면에서 받은 동의. 영역마다 동의·거부를 그 자리에서 사건으로 남긴다(P1). */
  consents?: Array<{ domain: ConsentDomain; decision: ConsentDecision }>;
  actorId: number;
}): Promise<{ case_id: number; participant_id: number; pseudonym: string }> {
  return await sql.begin(async (tx) => {
    // 사업은 살아 있는 것만 고른다. 종료된 사업에 새 사례를 여는 것은 잠긴 쓰기다.
    const [program] = await tx<Array<{ retired_at: string | null }>>`
      select retired_at from programs where id = ${input.program_id}`;
    if (!program) throw new NotFound('사업을 찾지 못했어요.');
    if (program.retired_at) throw new ProgramRetired('종료된 사업이에요. 다시 열어야 새 당사자를 등록할 수 있어요.');
    const pseudonym = await nextPseudonym(tx as unknown as typeof sql);
    const [participant] = await tx<{ id: number }[]>`
      insert into participants (pseudonym) values (${pseudonym}) returning id`;
    await tx`insert into participant_pii (participant_id, enc_name, enc_phone, enc_email, enc_birth, enc_address, key_version)
      values (${participant.id}, ${encryptPii(input.name)}, ${encryptPii(input.phone)},
              ${encryptPii(input.email)}, ${encryptPii(input.birth)}, ${encryptPii(input.address)}, ${KEY_VERSION})`;
    const [c] = await tx<{ id: number }[]>`
      insert into support_cases (participant_id, program_id, sessions_planned)
      values (${participant.id}, ${input.program_id}, ${input.sessions_planned ?? null})
      returning id`;
    // 등록한 사람이 첫 담당이다(2026-09-16 Q). 맡은 사람만 사례를 여는 규칙이라
    // 배정 없이 만들면 만든 사람조차 못 여는 사례가 생긴다.
    await tx`insert into case_assignments (case_id, user_id, assigned_by)
      values (${c.id}, ${input.actorId}, ${input.actorId})`;
    for (const consent of input.consents ?? []) {
      await tx`
        insert into consent_events
          (participant_id, case_id, domain, decision, purpose, copy_version, copy_hash, effective_at, recorded_by)
        values (${participant.id}, ${c.id}, ${consent.domain}, ${consent.decision},
                ${CONSENT_COPY[consent.domain].purpose}, ${COPY_VERSION}, ${copyHash(consent.domain)},
                ${new Date().toISOString()}, ${input.actorId})`;
    }
    return { case_id: c.id, participant_id: participant.id, pseudonym };
  });
}

export type IntakeView = {
  session_id: number | null;
  /** 실제로 상담한 일시·방식·장소. detail.preferred_counsel_method(선호 방식)와는 다른 값이다. */
  held_at: string | null;
  method: string | null;
  place: string | null;
  memo: string | null;
  detail: Record<string, unknown>;
  overall_goal: string | null;
  /** 이미 다른 회차에서 결과가 찍힌 카드. 고칠 때 지우지 않는다. */
  cards: Array<{ kind: string; text: string; locked: boolean }>;
};

/** 저장해 둔 인테이크를 다시 연다. 아직 없으면 빈 것을 낸다. */
export async function getIntake(caseId: number): Promise<IntakeView | null> {
  const [supportCase] = await sql<SupportCase[]>`select * from support_cases where id = ${caseId}`;
  if (!supportCase) return null;
  const [session] = await sql<Array<{
    id: number;
    held_at: string | null;
    method: string | null;
    place: string | null;
    memo: string | null;
    detail: Record<string, unknown>;
  }>>`
    select id, held_at, method, place, memo, detail
    from sessions where case_id = ${caseId} and kind = 'intake'`;
  if (!session) {
    return {
      session_id: null,
      held_at: null,
      method: null,
      place: null,
      memo: null,
      detail: {},
      overall_goal: decryptText(supportCase.overall_goal),
      cards: [],
    };
  }
  const cards = await sql<Array<{ kind: string; text: string; locked: boolean }>>`
    select c.kind, c.text, exists (select 1 from card_outcomes o where o.card_id = c.id) as locked
    from cards c where c.source_session_id = ${session.id} order by c.id`;
  return {
    session_id: session.id,
    held_at: session.held_at,
    method: session.method,
    place: session.place,
    memo: decryptText(session.memo),
    detail: decryptJson(session.detail),
    overall_goal: decryptText(supportCase.overall_goal),
    cards: cards.map((c) => ({ ...c, text: decryptText(c.text) ?? '' })),
  };
}

/**
 * 인테이크 작성하기. 전체 상담 목표는 비워둘 수 있다.
 * 이미 쓴 인테이크가 있으면 **고쳐 쓴다** — 첫 회차는 하나뿐이라 새로 만들지 않는다.
 * 빠진 칸은 지우지 않고 두고, 들고 온 칸만 바꾼다 — 옛 화면의 답이나 화면에서 빠진
 * 항목(사실·판단 카드, 폐기된 질문)이 저장할 때마다 사라지면 안 된다.
 * 다른 회차에서 결과가 찍힌 카드(확인함·못 함 따위)는 지우지 않는다. 그 이력까지 사라진다.
 */
export async function saveIntake(
  caseId: number,
  input: {
    held_at?: string;
    method?: string;
    place?: string | null;
    memo?: string;
    overall_goal?: string | null;
    detail?: Record<string, unknown>;
    cards?: NewCardInput[];
  },
): Promise<{ session_id: number }> {
  // 상담 자유 글에는 건강·채무 같은 민감정보가 섞인다. 동의 없이 저장하지 않는다(P1).
  await assertProgramActive(caseId);
  await assertConsent(caseId, 'sensitive_information_processing');
  return await sql.begin(async (tx) => {
    // 첫 인테이크 저장은 회차를 만든다 — 일정 등록과 같은 이유로 사례 행을 먼저 잠근다.
    await tx`select id from support_cases where id = ${caseId} for update`;
    const [intake] = await tx<{
      id: number;
      held_at: string | null;
      method: string | null;
      place: string | null;
      memo: string | null;
      detail: Record<string, unknown>;
    }[]>`
      select id, held_at, method, place, memo, detail
      from sessions where case_id = ${caseId} and kind = 'intake'`;

    let sessionId: number;
    if (intake) {
      sessionId = intake.id;
      // 실제 상담 방식이 대면이 아니면 장소는 없다 — 이전에 남은 장소도 지운다.
      const method = input.method === undefined ? intake.method : input.method;
      const place =
        method === 'in_person' ? (input.place === undefined ? intake.place : input.place) : null;
      // detail 은 겹쳐 쓴다 — 화면에서 빠진 옛 질문의 답(폐기된 키)은 그대로 남긴다.
      // 들고 온 값이 있으면 풀어서 겹친 뒤 다시 암호화한다.
      const detail =
        input.detail === undefined
          ? intake.detail
          : encryptJson({ ...decryptJson(intake.detail), ...input.detail });
      await tx`
        update sessions set
          held_at = ${input.held_at ?? intake.held_at},
          method = ${method},
          place = ${place},
          memo = ${input.memo === undefined ? intake.memo : encryptText(input.memo)},
          detail = ${tx.json(detail)}
        where id = ${sessionId}`;
    } else {
      const [other] = await tx<{ id: number }[]>`
        select id from sessions where case_id = ${caseId} limit 1`;
      if (other) throw new Error('이미 다른 회차가 있어요. 인테이크는 첫 회차예요.');
      const [created] = await tx<{ id: number }[]>`
        insert into sessions (case_id, seq, kind, status, held_at, method, place, memo, detail)
        values (${caseId}, 1, 'intake', 'done', ${input.held_at ?? new Date().toISOString()},
                ${input.method ?? null},
                ${input.method === 'in_person' ? (input.place ?? null) : null},
                ${encryptText(input.memo)}, ${tx.json(encryptJson(input.detail))})
        returning id`;
      sessionId = created.id;
    }

    if (input.overall_goal !== undefined) {
      await setOverallGoal(tx as unknown as typeof sql, caseId, input.overall_goal);
    }

    // 카드 목록을 들고 왔을 때만 갈아 끼운다 — 안 들고 오면(옛 화면) 있는 그대로 둔다.
    if (input.cards !== undefined) {
      // 인테이크 화면이 고치는 것은 과제·질문뿐이다. 사실·판단 카드는 화면에 없으니
      // 지우지 않고 남긴다 — 결과가 찍힌 카드도 마찬가지다.
      const kept = await tx<Array<{ kind: string; text: string }>>`
        select c.kind, c.text from cards c
        where c.source_session_id = ${sessionId}
          and (c.kind in ('fact', 'judgment')
               or exists (select 1 from card_outcomes o where o.card_id = c.id))`;
      await tx`
        delete from cards c
        where c.source_session_id = ${sessionId}
          and c.kind in ('promise', 'question')
          and not exists (select 1 from card_outcomes o where o.card_id = c.id)`;
      // 남은 카드 본문은 암호문이다 — 들고 온 평문과 견주려면 먼저 풀어야 한다.
      const keep = new Set(kept.map((c) => `${c.kind}\u0000${decryptText(c.text) ?? ''}`));
      const fresh = input.cards.filter((c) => !keep.has(`${c.kind}\u0000${c.text}`));
      await insertCards(tx as unknown as typeof sql, caseId, sessionId, fresh);
    }
    return { session_id: sessionId };
  });
}

/** 상담 일정 등록. 예정 회차 1건. 메모는 카드가 아니다(요구 4). */
export async function planSession(
  caseId: number,
  input: {
    scheduled_at: string;
    method: string;
    place?: string | null;
    plan_memo?: string | null;
    is_closing?: boolean;
  },
): Promise<{ session_id: number; seq: number }> {
  await assertProgramActive(caseId);
  return await sql.begin(async (tx) => {
    // 사례 행을 먼저 잠근다(2026-09-16 검수). 안 잠그면 일정 등록을 빨리 두 번 눌렀을 때
    // 두 요청이 같은 `max(seq)+1` 을 읽고, 뒤엣것이 `unique (case_id, seq)` 에 걸려 500 이 난다.
    // 잠금은 그 사례 하나에만 걸리므로 다른 당사자의 등록은 기다리지 않는다.
    await tx`select id from support_cases where id = ${caseId} for update`;
    const [{ seq }] = await tx<{ seq: number }[]>`
      select coalesce(max(seq), 0) + 1 as seq from sessions where case_id = ${caseId}`;
    const [s] = await tx<{ id: number }[]>`
      insert into sessions (case_id, seq, kind, status, scheduled_at, method, place, plan_memo, is_closing)
      values (${caseId}, ${seq}, 'regular', 'planned', ${input.scheduled_at}, ${input.method},
              ${input.place ?? null}, ${encryptText(input.plan_memo)}, ${input.is_closing ?? false})
      returning id`;
    return { session_id: s.id, seq };
  });
}

/**
 * 상담 시작(2026-09-16 Q). 시작이 곧 회차다 — 수기든 녹음이든 시작한 순간 기록 회차가 생기고
 * 부족한 정보는 나중에 채운다. 예정 회차를 주면 그 회차가 기록됨이 되고, 없으면 새로 만든다.
 * 저장(recordSession)과 달리 카드·결과·목표 이어받기를 건드리지 않는다 — 그건 채울 때 한다.
 */
export async function startSession(
  caseId: number,
  input: { session_id?: number; method?: string; is_closing?: boolean; actorId?: number },
): Promise<{ session_id: number; seq: number }> {
  await assertCaseOpen(caseId);
  // 이미 잡힌 예정 회차는 사업이 종료돼도 기록한다. 새 회차만 잠긴다.
  if (input.session_id === undefined) await assertProgramActive(caseId);
  await assertConsent(caseId, 'sensitive_information_processing');
  return await sql.begin(async (tx) => {
    await tx`select id from support_cases where id = ${caseId} for update`;
    const now = new Date().toISOString();
    if (input.session_id !== undefined) {
      const [target] = await tx<Session[]>`
        select * from sessions where id = ${input.session_id} and case_id = ${caseId} for update`;
      if (!target) throw new NotFound('회차를 찾지 못했어요.');
      if (target.status === 'done') throw new SessionAlreadyStarted('이미 시작한 회차예요.');
      await tx`update sessions set status = 'done', held_at = ${now},
        method = ${input.method ?? target.method}, is_closing = ${input.is_closing ?? target.is_closing}
        where id = ${target.id}`;
      return { session_id: target.id, seq: target.seq };
    }
    const [{ seq }] = await tx<{ seq: number }[]>`
      select coalesce(max(seq), 0) + 1 as seq from sessions where case_id = ${caseId}`;
    const [s] = await tx<{ id: number }[]>`
      insert into sessions (case_id, seq, kind, status, held_at, method, is_closing)
      values (${caseId}, ${seq}, 'regular', 'done', ${now}, ${input.method ?? null}, ${input.is_closing ?? false})
      returning id`;
    return { session_id: s.id, seq };
  });
}

/** 이미 기록됨인 회차를 다시 시작하려 했다. 라우트는 409 로 답한다. */
export class SessionAlreadyStarted extends Error {}

/**
 * 상담 기록하기. 한 트랜잭션에서
 *  - 회차를 done 으로 저장하고
 *  - 직전 회차의 다음 상담 목표를 이어받고
 *  - 새 카드를 만들고
 *  - 제출된 결과를 쓰고, 제출되지 않은 열린 카드는 unchecked 로 남긴다.
 */
export async function recordSession(
  sessionId: number,
  input: {
    held_at?: string;
    /** 상담 내용. 비우거나 안 보내도 된다(2026-09-16 Q) — 안 보내면 있던 것을 지키고, 빈 글은 없음으로 둔다. */
    memo?: string;
    method?: string | null;
    place?: string | null;
    detail?: Record<string, unknown>;
    next_goal_text?: string | null;
    overall_goal?: string | null;
    cards?: NewCardInput[];
    outcomes?: OutcomeSubmission[];
    actorId?: number;
    is_closing?: boolean;
  },
): Promise<{ session_id: number; unchecked: number }> {
  const [owner] = await sql<Array<{ case_id: number; status: string }>>`
    select case_id, status from sessions where id = ${sessionId}`;
  if (owner) {
    // 이미 잡힌 예정 회차의 기록은 사업이 종료돼도 된다. 기록된 회차를 고쳐 쓰는 것은 잠긴다.
    if (owner.status !== 'planned') await assertProgramActive(owner.case_id);
    await assertConsent(owner.case_id, 'sensitive_information_processing');
  }
  return await sql.begin(async (tx) => {
    const [target] = await tx<Session[]>`select * from sessions where id = ${sessionId} for update`;
    if (!target) throw new Error('session not found');
    const sessions = await tx<Session[]>`select * from sessions where case_id = ${target.case_id}`;
    const cards = await tx<Card[]>`select * from cards where case_id = ${target.case_id}`;
    const outcomes = await tx<CardOutcome[]>`
      select o.* from card_outcomes o join cards c on c.id = o.card_id where c.case_id = ${target.case_id}`;
    // 요청이 들고 온 card_id 도 대상 사례 안에 있어야 한다. FK 만 믿으면 맡은 사례 A를
    // 저장하면서 남의 사례 B 카드에 결과를 붙이는 우회가 열린다.
    const caseCardIds = new Set(cards.map((card) => card.id));
    if ((input.outcomes ?? []).some((outcome) => !caseCardIds.has(outcome.card_id))) {
      throw new NotFound('카드를 찾지 못했어요.');
    }

    // 이미 저장한 회차를 고쳐 쓰는 경우, 이 회차가 남긴 결과는 빼고 "이 회차 전에 열려 있던 카드"를
    // 다시 센다. 그러지 않으면 지난번에 완료로 닫은 카드가 목록에서 빠져 미확인이 남지 않는다.
    const wasDone = target.status === 'done';
    const outcomesBefore = wasDone ? outcomes.filter((o) => o.session_id !== sessionId) : outcomes;

    // 고쳐 쓰기: 이 회차가 만든 카드 중 **결과가 붙지 않은 것**만 갈아 끼운다(인테이크와 같은 규칙).
    // 카드 목록을 들고 왔을 때만 지운다 — 안 들고 오면 있는 그대로 둔다.
    // 사실 카드는 기록 화면에 없으므로(달라진 것 칸 폐지) 지우지 않는다.
    // 인테이크라면 판단 카드도 화면에 없으므로 과제·질문만 고친다.
    if (wasDone && input.cards !== undefined) {
      await tx`
        delete from cards c
        where c.source_session_id = ${sessionId}
          and c.kind <> 'fact'
          and (${target.kind} <> 'intake' or c.kind <> 'judgment')
          and not exists (select 1 from card_outcomes o where o.card_id = c.id)`;
    }

    const carry = carryOverOnRecord(target, sessions);
    // 빠진 칸은 지우지 않고 둔다. 방식이 대면이 아니면 장소는 없다 — 남은 장소도 지운다.
    const method = input.method === undefined ? target.method : input.method;
    const place =
      method === 'in_person' ? (input.place === undefined ? target.place : input.place) : null;
    // detail 은 겹쳐 쓴다 — 안 들고 오면 있는 그대로, 들고 오면 풀어서 겹친 뒤 다시 암호화한다.
    // 겹치지 않으면 인테이크의 숨은 답이 기록 저장 한 번에 지워진다.
    const detail =
      input.detail === undefined
        ? target.detail
        : encryptJson({ ...decryptJson(target.detail), ...input.detail });
    await tx`update sessions set
        status = 'done',
        held_at = ${input.held_at ?? target.held_at ?? new Date().toISOString()},
        memo = ${input.memo === undefined ? target.memo : input.memo.trim() ? encryptText(input.memo) : null},
        method = ${method},
        place = ${place},
        detail = ${tx.json(detail)},
        next_goal_text = ${encryptText(input.next_goal_text)},
        created_by = coalesce(created_by, ${input.actorId ?? null}),
        is_closing = ${input.is_closing ?? false},
        today_goal_text = coalesce(today_goal_text, ${encryptText(carry?.text)}),
        today_goal_from_session_id = coalesce(today_goal_from_session_id, ${carry?.fromSessionId ?? null})
      where id = ${sessionId}`;
    if (carry) {
      await tx`update sessions set next_goal_consumed_by_session_id = ${sessionId}
        where id = ${carry.fromSessionId}`;
    }
    if (input.overall_goal !== undefined) {
      await setOverallGoal(tx as unknown as typeof sql, target.case_id, input.overall_goal);
    }

    const keptIds = new Set(
      (await tx<Array<{ id: number }>>`select id from cards where source_session_id = ${sessionId}`).map((c) => c.id),
    );
    const kept = cards.filter((c) => keptIds.has(c.id));
    // 남은 카드 본문은 암호문이다 — 들고 온 평문과 견주려면 먼저 풀어야 한다.
    const fresh = (input.cards ?? []).filter(
      (c) => !kept.some((k) => k.kind === c.kind && decryptText(k.text) === c.text),
    );
    await insertCards(tx as unknown as typeof sql, target.case_id, sessionId, fresh);

    const openBefore = openCards(
      cards.filter((c) => c.source_session_id !== sessionId || keptIds.has(c.id)),
      outcomesBefore,
      sessions,
    );
    const rows = resolveOutcomes(openBefore, input.outcomes ?? []);
    for (const row of rows) {
      const full = row as OutcomeSubmission & { result: string };
      await tx`insert into card_outcomes (card_id, session_id, result, follow, reason, note)
        values (${row.card_id}, ${sessionId}, ${row.result}, ${full.follow ?? null},
                ${encryptText(full.reason)}, ${encryptText(full.note)})`;
    }
    return { session_id: sessionId, unchecked: rows.filter((r) => r.result === 'unchecked').length };
  });
}

export type SessionRecord = {
  session_id: number;
  case_id: number;
  seq: number;
  status: string;
  kind: string;
  held_at: string | null;
  method: string | null;
  place: string | null;
  memo: string | null;
  next_goal_text: string | null;
  overall_goal: string | null;
  is_closing: boolean;
  /** 이 회차가 만든 카드. 결과가 붙은 것은 지울 수 없다. */
  cards: Array<{ kind: string; text: string; area: string | null; locked: boolean }>;
  /** 이 회차에 올라와 있던 카드와 이 회차가 매긴 결과(고쳐 쓸 때 그대로 다시 보여 준다). */
  open_cards: Array<{
    card_id: number;
    kind: string;
    text: string;
    source_session_seq: number | null;
    result: string | null;
    follow: string | null;
    reason: string | null;
  }>;
};

/** 저장해 둔 회차를 다시 연다. 고쳐 쓰기 화면의 재료다. */
export async function getSessionRecord(sessionId: number): Promise<SessionRecord | null> {
  const [found] = await sql<Session[]>`select case_id from sessions where id = ${sessionId}`;
  if (!found) return null;
  const loaded = await loadCase(found.case_id);
  if (!loaded) return null;
  const { supportCase, sessions, cards, outcomes } = loaded;
  // 자유 글은 loadCase 가 이미 평문으로 돌려놨다. 여기서 다시 select 하면 암호문을 화면에 보낸다.
  const target = sessions.find((s) => s.id === sessionId);
  if (!target) return null;

  const mine = outcomes.filter((o) => o.session_id === sessionId);
  const latestMine = (cardId: number) =>
    mine.filter((o) => o.card_id === cardId).sort((a, b) => a.id - b.id).at(-1);

  // 이 회차 전에 열려 있던 카드 = 고쳐 쓸 때 레일에 다시 세울 것.
  const before = openCards(cards, outcomes.filter((o) => o.session_id !== sessionId), sessions);
  const seqById = new Map(sessions.map((s) => [s.id, s.seq]));

  return {
    session_id: target.id,
    case_id: target.case_id,
    seq: target.seq,
    status: target.status,
    kind: target.kind,
    held_at: target.held_at,
    method: target.method,
    place: target.place,
    memo: target.memo,
    next_goal_text: target.next_goal_text,
    overall_goal: supportCase.overall_goal,
    is_closing: target.is_closing ?? false,
    cards: cards
      .filter((c) => c.source_session_id === sessionId)
      .map((c) => ({
        kind: c.kind,
        text: c.text,
        area: c.area,
        locked: outcomes.some((o) => o.card_id === c.id),
      })),
    open_cards: before.map((c) => {
      const got = latestMine(c.id);
      return {
        card_id: c.id,
        kind: c.kind,
        text: c.text,
        source_session_seq: seqById.get(c.source_session_id) ?? null,
        result: got?.result ?? null,
        follow: got?.follow ?? null,
        reason: got?.reason ?? null,
      };
    }),
  };
}

/** 전체 상담 목표 수정. 이전 문구를 이력으로 남긴다(append-only). */
async function setOverallGoal(tx: typeof sql, caseId: number, text: string | null): Promise<void> {
  const [current] = await tx<{ overall_goal: string | null }[]>`
    select overall_goal from support_cases where id = ${caseId}`;
  // 같은지 견주려면 평문끼리 견줘야 한다 — 암호문은 같은 글이라도 매번 다르다(IV 가 다르다).
  if (decryptText(current?.overall_goal ?? null) === text) return;
  await tx`update support_cases set
      overall_goal = ${encryptText(text)},
      overall_goal_source = ${text ? 'agreed' : null}
    where id = ${caseId}`;
  await tx`insert into goal_revisions (case_id, text) values (${caseId}, ${encryptText(text)})`;
}

async function insertCards(
  tx: typeof sql,
  caseId: number,
  sessionId: number,
  cards: NewCardInput[],
  sourceType: Card['source_type'] = 'manual',
): Promise<void> {
  for (const card of cards) {
    // 카드 본문은 사람이 쓴 문장이다. 평문으로 앉히지 않는다(P1).
    await tx`insert into cards (case_id, kind, text, area, risk_type, quote, source_session_id, source_section, source_type)
      values (${caseId}, ${card.kind}, ${encryptText(card.text)}, ${card.area ?? null}, ${card.risk_type ?? null},
              ${encryptText(card.quote)}, ${sessionId}, ${card.section}, ${sourceType})`;
  }
}

/**
 * 승인한 AI 과제·질문을 그 회차의 카드로 앉힌다(SPEC §15-4 "승인하면 그대로 카드가 된다").
 * 다시 승인하면 **결과가 안 찍힌 AI 카드만** 갈아 끼운다 — 이미 확인함·못 함이 붙은 카드는
 * 이력이라 지우지 않는다. 사람이 같은 문장을 이미 적어 뒀으면 또 만들지 않는다(인테이크와 같은 규칙).
 */
export async function replaceAiCards(
  tx: typeof sql,
  caseId: number,
  sessionId: number,
  cards: NewCardInput[],
): Promise<void> {
  await tx`
    delete from cards c
    where c.source_session_id = ${sessionId} and c.source_type = 'ai_approved'
      and not exists (select 1 from card_outcomes o where o.card_id = c.id)`;
  const existing = await tx<Array<{ kind: string; text: string }>>`
    select kind, text from cards where source_session_id = ${sessionId}`;
  const keep = new Set(existing.map((c) => `${c.kind}\u0000${decryptText(c.text) ?? ''}`));
  const fresh = cards.filter((c) => c.text.trim() && !keep.has(`${c.kind}\u0000${c.text}`));
  await insertCards(tx, caseId, sessionId, fresh, 'ai_approved');
}

export type ApprovedSummary = { summary: string; changes: string[]; fact_changes: FactChange[] };

/** 회차별 승인된 요약. 마지막 행이 새 초안이면 이전 승인본으로 조용히 되돌아가지 않는다(불일치 화면과 같은 규칙). */
async function approvedSummaries(sessionIds: number[]): Promise<Record<number, ApprovedSummary>> {
  if (sessionIds.length === 0) return {};
  const rows = await sql<Array<{ session_id: number; status: 'draft' | 'approved' } & ApprovedSummary>>`
    select distinct on (session_id) session_id, status, summary, changes, fact_changes
    from ai_drafts where session_id in ${sql(sessionIds)} order by session_id, id desc`;
  return Object.fromEntries(
    rows
      .filter((r) => r.status === 'approved')
      .map((r) => [r.session_id, { summary: r.summary, changes: r.changes, fact_changes: r.fact_changes }]),
  );
}

async function loadCase(caseId: number) {
  // 사업 이름은 사업 표에서 가져온다 — 이름을 바꾸면 지난 사례도 새 이름으로 보인다.
  const [supportCase] = await sql<SupportCase[]>`
    select c.*, p.name as program_name from support_cases c
    join programs p on p.id = c.program_id where c.id = ${caseId}`;
  if (!supportCase) return null;
  const [participant] = await sql<{ pseudonym: string }[]>`
    select pseudonym from participants where id = ${supportCase.participant_id}`;
  const [vault] = await sql<{ enc_name: string | null }[]>`
    select enc_name from participant_pii where participant_id = ${supportCase.participant_id}`;
  const sessions = await sql<Session[]>`select * from sessions where case_id = ${caseId} order by seq`;
  const cards = await sql<Card[]>`select * from cards where case_id = ${caseId} order by id`;
  const outcomes = await sql<CardOutcome[]>`
    select o.* from card_outcomes o join cards c on c.id = o.card_id where c.case_id = ${caseId}`;
  // 자유 글은 여기 한 곳에서 평문으로 되돌린다. 아래 도메인 함수와 화면은 평문만 본다.
  return {
    supportCase: { ...supportCase, overall_goal: decryptText(supportCase.overall_goal) },
    pseudonym: participant.pseudonym,
    vault,
    sessions: sessions.map((s) => ({
      ...s,
      memo: decryptText(s.memo),
      plan_memo: decryptText(s.plan_memo),
      today_goal_text: decryptText(s.today_goal_text),
      next_goal_text: decryptText(s.next_goal_text),
      detail: decryptJson(s.detail),
    })),
    cards: cards.map((c) => ({ ...c, text: decryptText(c.text) ?? '', quote: decryptText(c.quote) })),
    outcomes: outcomes.map((o) => ({
      ...o,
      reason: decryptText(o.reason),
      note: decryptText(o.note),
    })),
  };
}

export async function getCase(caseId: number) {
  const loaded = await loadCase(caseId);
  if (!loaded) return null;
  const { supportCase, pseudonym, sessions, cards, outcomes } = loaded;
  return {
    case: supportCase,
    pseudonym,
    sessions,
    open_cards: openCards(cards, outcomes, sessions),
  };
}

export type ConsentView = Array<{
  domain: ConsentDomain;
  label: string;
  copy: string;
  status: ConsentStatus;
  decided_at: string | null;
}>;

/** 사례의 동의 현재 상태. 저장된 값이 아니라 사건을 접어 낸다. */
export async function getConsents(caseId: number): Promise<ConsentView | null> {
  const [supportCase] = await sql<SupportCase[]>`select participant_id from support_cases where id = ${caseId}`;
  if (!supportCase) return null;
  const events = await sql<ConsentEventRow[]>`
    select id, domain, decision, copy_version, copy_hash, effective_at
    from consent_events
    where participant_id = ${supportCase.participant_id} and case_id = ${caseId}
    order by id`;
  // 기능이 꺼진 영역은 목록에 두지 않는다 — 받을 이유가 없는 동의를 화면에 띄우지 않는다.
  return activeDomains().map((domain) => {
    const mine = events.filter((e) => e.domain === domain);
    return {
      domain,
      label: CONSENT_COPY[domain].label,
      copy: CONSENT_COPY[domain].copy,
      status: foldConsent(domain, events),
      decided_at: mine.at(-1)?.effective_at ?? null,
    };
  });
}

/** 동의 사건을 쌓는다. 지우거나 고치지 않는다 — 철회도 새 사건이다. */
export async function recordConsent(
  caseId: number,
  input: { domain: ConsentDomain; decision: ConsentDecision; actorId?: number },
): Promise<ConsentView> {
  const [supportCase] = await sql<SupportCase[]>`select participant_id from support_cases where id = ${caseId}`;
  if (!supportCase) throw new Error('사례를 찾지 못했어요.');
  await sql`
    insert into consent_events
      (participant_id, case_id, domain, decision, purpose, copy_version, copy_hash, effective_at, recorded_by)
    values (${supportCase.participant_id}, ${caseId}, ${input.domain}, ${input.decision},
            ${CONSENT_COPY[input.domain].purpose}, ${COPY_VERSION}, ${copyHash(input.domain)},
            ${new Date().toISOString()}, ${input.actorId ?? null})`;
  return (await getConsents(caseId)) ?? [];
}

/** 동의 게이트. 이 영역이 `granted` 가 아니면 저장을 막는다(P1). */
export async function assertConsent(caseId: number, domain: ConsentDomain): Promise<void> {
  const consents = await getConsents(caseId);
  const found = consents?.find((c) => c.domain === domain);
  if (found?.status === 'granted') return;
  throw new ConsentRequired(
    `${CONSENT_COPY[domain].label} 동의가 없어요. 당사자 정보에서 동의를 받아야 저장할 수 있어요.`,
  );
}

export class ConsentRequired extends Error {}

export type CaseDetail = {
  case: SupportCase;
  pseudonym: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  sessions: Array<{
    id: number;
    seq: number;
    kind: string;
    status: string;
    held_at: string | null;
    scheduled_at: string | null;
    line: string;
    memo: string | null;
    /** 수기가 있는가. 녹음만 하고 아직 안 적은 회차는 false — 화면이 '수기 미작성'을 그린다. */
    written: boolean;
    /** 녹음·전사 상태. 여러 녹음이면 가장 최근 녹음 기준. */
    voice: { recordings: number; transcript: SessionTranscriptState };
    today_goal_text: string | null;
    /** 승인된 AI 정리. 없거나 마지막 행이 초안이면 null. */
    ai_summary: ApprovedSummary | null;
  }>;
  goal_revisions: Array<{ text: string | null; created_at: string }>;
  open_cards: Array<ReturnType<typeof openCards>[number] & { source_session_seq: number | null }>;
  closure: {
    closed_at: string;
    close_reason: string;
    unfinished_note: string | null;
    last_session_seq: number | null;
  } | null;
};

export type SessionTranscriptState = 'none' | 'pending' | 'draft' | 'approved' | 'failed' | 'skipped';

/**
 * 회차별 녹음 수와 전사 상태. 전사문이 있으면 그 상태(draft/approved)가 우선이고,
 * 없으면 가장 최근 녹음의 진행 상태(pending/failed/skipped)다. 녹음이 없으면 none.
 */
async function voiceStates(
  sessionIds: number[],
): Promise<Record<number, { recordings: number; transcript: SessionTranscriptState }>> {
  if (sessionIds.length === 0) return {};
  const rows = await sql<Array<{ session_id: number; recordings: number; latest_state: string | null; transcript_status: string | null }>>`
    select s.id as session_id,
           (select count(*)::int from recordings r where r.session_id = s.id and r.deleted_at is null) as recordings,
           (select r.transcribe_state from recordings r where r.session_id = s.id and r.deleted_at is null
              order by r.id desc limit 1) as latest_state,
           (select t.status from transcripts t where t.session_id = s.id order by t.id desc limit 1) as transcript_status
    from sessions s where s.id in ${sql(sessionIds)}`;
  const out: Record<number, { recordings: number; transcript: SessionTranscriptState }> = {};
  for (const r of rows) {
    const transcript: SessionTranscriptState =
      r.transcript_status === 'approved' || r.transcript_status === 'draft'
        ? r.transcript_status
        : r.latest_state === 'pending' || r.latest_state === 'failed' || r.latest_state === 'skipped'
          ? r.latest_state
          : 'none';
    out[r.session_id] = { recordings: r.recordings, transcript: r.recordings > 0 ? transcript : 'none' };
  }
  return out;
}

/** 당사자 정보 화면(탭 4)의 재료를 한 번에 낸다. 탭마다 따로 부르지 않는다. */
export async function getCaseDetail(caseId: number): Promise<CaseDetail | null> {
  const loaded = await loadCase(caseId);
  if (!loaded) return null;
  const { supportCase, pseudonym, sessions, cards, outcomes } = loaded;
  const approved = await approvedSummaries(sessions.map((s) => s.id));
  const voice = await voiceStates(sessions.map((s) => s.id));

  const [vault] = await sql<Array<{ enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select enc_name, enc_phone, enc_email from participant_pii
    where participant_id = ${supportCase.participant_id}`;

  const revisionRows = await sql<Array<{ text: string | null; created_at: string }>>`
    select text, created_at from goal_revisions where case_id = ${caseId} order by created_at`;
  const revisions = revisionRows.map((r) => ({ ...r, text: decryptText(r.text) }));

  // 상담 종결은 회차가 아니다. 회차별 요약에서 마지막 상담과 나란히 별도 항목으로 보인다(SPEC §4-3).
  const [closure] = await sql<Array<{ closed_at: string; close_reason: string; unfinished_note: string | null; last_session_id: number | null }>>`
    select closed_at, close_reason, unfinished_note, last_session_id from case_closures where case_id = ${caseId}`;

  return {
    case: supportCase,
    pseudonym,
    participant: {
      name: decryptPii(vault?.enc_name ?? null),
      phone: decryptPii(vault?.enc_phone ?? null),
      email: decryptPii(vault?.enc_email ?? null),
    },
    sessions: sessions.map((s) => {
      // 금고에서 꺼내 보낸다. 안 꺼내면 화면에 암호문이 그대로 뜬다(2026-09-16 검수).
      const memo = decryptText(s.memo);
      return {
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        status: s.status,
        held_at: s.held_at,
        scheduled_at: s.scheduled_at,
        line: buildSessionLine(s, cards),
        memo,
        written: Boolean(memo?.trim()),
        voice: voice[s.id] ?? { recordings: 0, transcript: 'none' as const },
        today_goal_text: decryptText(s.today_goal_text),
        ai_summary: approved[s.id] ?? null,
      };
    }),
    goal_revisions: revisions,
    open_cards: openCards(cards, outcomes, sessions).map((c) => ({
      ...c,
      source_session_seq: sessions.find((s) => s.id === c.source_session_id)?.seq ?? null,
    })),
    closure: closure
      ? {
          closed_at: closure.closed_at,
          close_reason: decryptText(closure.close_reason) ?? '',
          unfinished_note: decryptText(closure.unfinished_note),
          last_session_seq: sessions.find((s) => s.id === closure.last_session_id)?.seq ?? null,
        }
      : null,
  };
}

/**
 * 상담 종결. 회차를 만들지 않는다 — `case_closures` 한 줄과 사례 상태만 바꾼다.
 * 미완료 과제와 목표를 자동으로 완료·중단 처리하지 않는다(SPEC §4-3).
 * 같은 사례를 두 번 닫아도 처음 기록을 그대로 돌려준다.
 */
export async function closeCase(
  caseId: number,
  input: { close_reason: string; unfinished_note?: string | null; actorId?: number },
): Promise<{ case_id: number; closed_at: string }> {
  return await sql.begin(async (tx) => {
    const [last] = await tx<Array<{ id: number }>>`
      select id from sessions where case_id = ${caseId} and status = 'done' order by seq desc limit 1`;
    const [row] = await tx<Array<{ closed_at: string }>>`
      insert into case_closures (case_id, last_session_id, close_reason, unfinished_note, created_by)
      values (${caseId}, ${last?.id ?? null}, ${encryptText(input.close_reason)},
              ${encryptText(input.unfinished_note)}, ${input.actorId ?? null})
      on conflict (case_id) do update set case_id = excluded.case_id
      returning closed_at`;
    await tx`update support_cases set status = 'closed' where id = ${caseId}`;
    return { case_id: caseId, closed_at: row.closed_at };
  });
}

export type ParticipantRow = {
  case_id: number;
  participant_id: number | null;
  pseudonym: string;
  name: string | null;
  program_id: number;
  program_name: string;
  status: 'open' | 'closed';
  /** 이 사례를 맡은 사람들. 없으면 아직 아무도 맡지 않은 사람이다. */
  assignees: Assignee[];
  /** 내가 이 사례를 맡았는가. false 면 이름·회차·일정은 비어 있다. */
  can_access: boolean;
  last_session_seq: number | null;
  next_scheduled_at: string | null;
};

/**
 * 당사자 목록. 이름은 금고 암호문이라 **서버에서 이름으로 검색할 수 없다** —
 * 복호화해서 내려보내고 거르는 일은 화면이 한다. 기관 하나 규모라 이 대가를 받아들인다.
 *
 * **맡지 않은 사례는 가명·사업·상태·담당 이름만 낸다.** 실명·회차·일정은 임상 정보다 —
 * 목록이 뒷문이 되지 않게 서버에서 지운다(2026-09-16 Q).
 */
export async function listParticipants(actorId: number): Promise<ParticipantRow[]> {
  const rows = await sql<
    Array<Omit<ParticipantRow, 'name' | 'assignees' | 'can_access'> & {
      enc_name: string | null;
      assignees: Assignee[] | null;
      can_access: boolean;
    }>
  >`
    select c.id as case_id,
           p.id as participant_id,
           p.pseudonym,
           v.enc_name,
           c.program_id,
           pg.name as program_name,
           c.status,
           (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name), '[]'::jsonb)
              from case_assignments a join users u on u.id = a.user_id
             where a.case_id = c.id) as assignees,
           exists (select 1 from case_assignments a
                    where a.case_id = c.id and a.user_id = ${actorId}) as can_access,
           (select max(seq) from sessions s where s.case_id = c.id and s.status = 'done') as last_session_seq,
           (select min(scheduled_at) from sessions s where s.case_id = c.id and s.status = 'planned') as next_scheduled_at
    from support_cases c
    join programs pg on pg.id = c.program_id
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    order by c.opened_at desc`;
  return rows.map(({ enc_name, can_access, last_session_seq, next_scheduled_at, ...row }) => ({
    ...row,
    participant_id: can_access ? row.participant_id : null,
    assignees: row.assignees ?? [],
    can_access,
    name: can_access ? decryptPii(enc_name) : null,
    last_session_seq: can_access ? last_session_seq : null,
    next_scheduled_at: can_access ? next_scheduled_at : null,
  }));
}

export type ScheduleRow = {
  session_id: number;
  case_id: number;
  seq: number;
  scheduled_at: string;
  method: string | null;
  place: string | null;
  plan_memo: string | null;
  pseudonym: string;
  name: string | null;
  program_name: string;
  open_tasks: number;
  open_questions: number;
};

/**
 * 다가오는 상담. 홈 화면의 재료다. 열린 과제·질문 수를 함께 센다(일정 화면의 `할 일` 띠).
 * **내가 맡은 사례만** 보인다 — 관리자도 예외가 없다(2026-09-16 Q).
 */
export async function listSchedules(actorId: number, from: string, to: string): Promise<ScheduleRow[]> {
  const rows = await sql<Array<Omit<ScheduleRow, 'name'> & { enc_name: string | null }>>`
    select s.id as session_id, s.case_id, s.seq, s.scheduled_at, s.method, s.place, s.plan_memo,
           p.pseudonym, v.enc_name, pg.name as program_name
    from sessions s
    join support_cases c on c.id = s.case_id
    join programs pg on pg.id = c.program_id
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    -- 닫힌 사례에 남은 예정 회차는 일정이 아니다(2026-09-17 Q). 취소 API 가 없으니 여기서 숨긴다.
    where s.status = 'planned' and c.status = 'open' and s.scheduled_at between ${from} and ${to}
      and exists (select 1 from case_assignments a
                   where a.case_id = c.id and a.user_id = ${actorId})
    order by s.scheduled_at`;

  const out: ScheduleRow[] = [];
  for (const { enc_name, ...row } of rows) {
    const loaded = await loadCase(row.case_id);
    const open = loaded ? openCards(loaded.cards, loaded.outcomes, loaded.sessions) : [];
    out.push({
      ...row,
      plan_memo: decryptText(row.plan_memo),
      name: decryptPii(enc_name),
      open_tasks: open.filter((c) => c.kind === 'promise').length,
      open_questions: open.filter((c) => c.kind === 'question').length,
    });
  }
  return out;
}

/**
 * 15초 다시보기. `seq` 를 주면 **그 회차까지 쌓인 것**만 낸다(2026-09-16 Q).
 *
 * 기록은 회차마다 쌓이므로 다시보기도 회차마다 다르다. 3회차 다시보기는 3회차까지의
 * 과제·질문·요약이고, 4회차에서 닫은 과제는 거기 없다 — 그때는 아직 열려 있었다.
 *
 * `seq` 가 없으면 지금이다 — 다음 상담을 준비하는 화면이고, 이것이 기본이다.
 */
export async function getBriefing(caseId: number, seq?: number): Promise<Briefing | null> {
  const loaded = await loadCase(caseId);
  if (!loaded) return null;
  const approved = await approvedSummaries(loaded.sessions.map((s) => s.id));

  if (seq === undefined) {
    return buildBriefing({
      supportCase: loaded.supportCase,
      pseudonym: loaded.pseudonym,
      name: decryptPii(loaded.vault?.enc_name ?? null),
      sessions: loaded.sessions,
      cards: loaded.cards,
      outcomes: loaded.outcomes,
      approved,
    });
  }

  // 그 회차까지만 남긴다. 회차를 모르는 자료는 버리지 않는다 — 있었다는 사실이 기록이다.
  const seqBySession = new Map(loaded.sessions.map((s) => [s.id, s.seq]));
  const upTo = (sessionId: number | null): boolean =>
    sessionId === null || (seqBySession.get(sessionId) ?? 0) <= seq;

  return buildBriefing({
    supportCase: loaded.supportCase,
    pseudonym: loaded.pseudonym,
    name: decryptPii(loaded.vault?.enc_name ?? null),
    sessions: loaded.sessions.filter((s) => s.seq <= seq),
    cards: loaded.cards.filter((c) => upTo(c.source_session_id)),
    outcomes: loaded.outcomes.filter((o) => upTo(o.session_id)),
    approved,
  });
}

/**
 * 회차의 불일치 둘(요구 23). 전사문과 수기 기록, 그리고 지난 회차와 이번 회차.
 * **판정하지 않는다** — 달라졌다는 사실만 낸다. 어느 쪽이 맞는지는 사람이 안다.
 */
export async function getMismatches(sessionId: number): Promise<MismatchView> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) return buildMismatches({ written: null, transcript: null, transcriptStatus: null, previous: null, current: { seq: 0 } });

  const [prev] = await sql<Array<{ seq: number; memo: string | null }>>`
    select seq, memo from sessions
    where case_id = ${session.case_id} and seq < ${session.seq} and memo is not null
    order by seq desc limit 1`;

  // 새 초안이 있으면 이전 승인본으로 조용히 되돌아가지 않는다.
  const [tr] = await sql<Array<{ text: string; status: 'draft' | 'approved'; deleted_at: string | null }>>`
    select t.text, t.status, r.deleted_at from transcripts t
    join recordings r on r.id = t.recording_id
    where t.session_id = ${sessionId} order by t.id desc limit 1`;

  return buildMismatches({
    written: decryptText(session.memo),
    transcript: tr && !tr.deleted_at ? decryptText(tr.text) : null,
    transcriptStatus: tr && !tr.deleted_at ? tr.status : null,
    previous: prev ? { seq: prev.seq, text: decryptText(prev.memo) ?? '' } : null,
    current: { seq: session.seq },
  });
}
