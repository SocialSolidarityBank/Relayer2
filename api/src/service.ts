// DB 접근은 여기 하나로 모은다. 쓰기는 전부 트랜잭션 하나 안에서 끝낸다.
import { sql } from './db.ts';
import { decryptPii, encryptPii, KEY_VERSION } from './pii.ts';
import { buildBriefing, type Briefing } from './domain/briefing.ts';
import { openCards, resolveOutcomes, type OutcomeSubmission } from './domain/cards.ts';
import { carryOverOnRecord } from './domain/goals.ts';
import { buildSessionLine } from './domain/session-line.ts';
import type { Card, CardOutcome, Session, SupportCase } from './domain/types.ts';

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

async function nextPseudonym(tx: typeof sql): Promise<string> {
  const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from participants`;
  const n = Number(count) + 1;
  return `${ANIMALS[n % ANIMALS.length]}-${String(n).padStart(3, '0')}`;
}

export async function createCase(input: {
  name: string;
  phone?: string;
  email?: string;
  birth?: string;
  address?: string;
  program_name: string;
  sessions_planned?: number;
  assigned_user_id?: number;
}): Promise<{ case_id: number; participant_id: number; pseudonym: string }> {
  return await sql.begin(async (tx) => {
    const pseudonym = await nextPseudonym(tx as unknown as typeof sql);
    const [participant] = await tx<{ id: number }[]>`
      insert into participants (pseudonym) values (${pseudonym}) returning id`;
    await tx`insert into participant_pii (participant_id, enc_name, enc_phone, enc_email, enc_birth, enc_address, key_version)
      values (${participant.id}, ${encryptPii(input.name)}, ${encryptPii(input.phone)},
              ${encryptPii(input.email)}, ${encryptPii(input.birth)}, ${encryptPii(input.address)}, ${KEY_VERSION})`;
    const [c] = await tx<{ id: number }[]>`
      insert into support_cases (participant_id, program_name, sessions_planned, assigned_user_id)
      values (${participant.id}, ${input.program_name}, ${input.sessions_planned ?? null}, ${input.assigned_user_id ?? null})
      returning id`;
    return { case_id: c.id, participant_id: participant.id, pseudonym };
  });
}

/** 인테이크 작성하기. 전체 상담 목표는 비워둘 수 있다. */
export async function saveIntake(
  caseId: number,
  input: { held_at?: string; memo?: string; overall_goal?: string | null; detail?: Record<string, unknown>; cards?: NewCardInput[] },
): Promise<{ session_id: number }> {
  return await sql.begin(async (tx) => {
    const [existing] = await tx<{ id: number }[]>`
      select id from sessions where case_id = ${caseId} limit 1`;
    if (existing) throw new Error('이미 회차가 있어요. 인테이크는 첫 회차예요.');
    const [session] = await tx<{ id: number }[]>`
      insert into sessions (case_id, seq, kind, status, held_at, memo, detail)
      values (${caseId}, 1, 'intake', 'done', ${input.held_at ?? new Date().toISOString()},
              ${input.memo ?? null}, ${tx.json(input.detail ?? {})})
      returning id`;
    if (input.overall_goal !== undefined) {
      await setOverallGoal(tx as unknown as typeof sql, caseId, input.overall_goal);
    }
    await insertCards(tx as unknown as typeof sql, caseId, session.id, input.cards ?? []);
    return { session_id: session.id };
  });
}

/** 상담 일정 등록. 예정 회차 1건. 메모는 카드가 아니다(요구 4). */
export async function planSession(
  caseId: number,
  input: { scheduled_at: string; method: string; place?: string | null; plan_memo?: string | null },
): Promise<{ session_id: number; seq: number }> {
  return await sql.begin(async (tx) => {
    const [{ seq }] = await tx<{ seq: number }[]>`
      select coalesce(max(seq), 0) + 1 as seq from sessions where case_id = ${caseId}`;
    const [s] = await tx<{ id: number }[]>`
      insert into sessions (case_id, seq, kind, status, scheduled_at, method, place, plan_memo)
      values (${caseId}, ${seq}, 'regular', 'planned', ${input.scheduled_at}, ${input.method},
              ${input.place ?? null}, ${input.plan_memo ?? null})
      returning id`;
    return { session_id: s.id, seq };
  });
}

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
    memo: string;
    place?: string | null;
    detail?: Record<string, unknown>;
    next_goal_text?: string | null;
    overall_goal?: string | null;
    cards?: NewCardInput[];
    outcomes?: OutcomeSubmission[];
    actorId?: number;
  },
): Promise<{ session_id: number; unchecked: number }> {
  return await sql.begin(async (tx) => {
    const [target] = await tx<Session[]>`select * from sessions where id = ${sessionId} for update`;
    if (!target) throw new Error('session not found');
    const sessions = await tx<Session[]>`select * from sessions where case_id = ${target.case_id}`;
    const cards = await tx<Card[]>`select * from cards where case_id = ${target.case_id}`;
    const outcomes = await tx<CardOutcome[]>`
      select o.* from card_outcomes o join cards c on c.id = o.card_id where c.case_id = ${target.case_id}`;

    const carry = carryOverOnRecord(target, sessions);
    await tx`update sessions set
        status = 'done',
        held_at = ${input.held_at ?? new Date().toISOString()},
        memo = ${input.memo},
        place = ${input.place ?? target.place},
        detail = ${tx.json(input.detail ?? {})},
        next_goal_text = ${input.next_goal_text ?? null},
        created_by = coalesce(created_by, ${input.actorId ?? null}),
        today_goal_text = coalesce(today_goal_text, ${carry?.text ?? null}),
        today_goal_from_session_id = coalesce(today_goal_from_session_id, ${carry?.fromSessionId ?? null})
      where id = ${sessionId}`;
    if (carry) {
      await tx`update sessions set next_goal_consumed_by_session_id = ${sessionId}
        where id = ${carry.fromSessionId}`;
    }
    if (input.overall_goal !== undefined) {
      await setOverallGoal(tx as unknown as typeof sql, target.case_id, input.overall_goal);
    }

    await insertCards(tx as unknown as typeof sql, target.case_id, sessionId, input.cards ?? []);

    const rows = resolveOutcomes(openCards(cards, outcomes, sessions), input.outcomes ?? []);
    for (const row of rows) {
      const full = row as OutcomeSubmission & { result: string };
      await tx`insert into card_outcomes (card_id, session_id, result, follow, reason, note)
        values (${row.card_id}, ${sessionId}, ${row.result}, ${full.follow ?? null},
                ${full.reason ?? null}, ${full.note ?? null})`;
    }
    return { session_id: sessionId, unchecked: rows.filter((r) => r.result === 'unchecked').length };
  });
}

/** 전체 상담 목표 수정. 이전 문구를 이력으로 남긴다(append-only). */
async function setOverallGoal(tx: typeof sql, caseId: number, text: string | null): Promise<void> {
  const [current] = await tx<{ overall_goal: string | null }[]>`
    select overall_goal from support_cases where id = ${caseId}`;
  if (current?.overall_goal === text) return;
  await tx`update support_cases set
      overall_goal = ${text},
      overall_goal_source = ${text ? 'agreed' : null}
    where id = ${caseId}`;
  await tx`insert into goal_revisions (case_id, text) values (${caseId}, ${text})`;
}

async function insertCards(
  tx: typeof sql,
  caseId: number,
  sessionId: number,
  cards: NewCardInput[],
): Promise<void> {
  for (const card of cards) {
    await tx`insert into cards (case_id, kind, text, area, risk_type, quote, source_session_id, source_section)
      values (${caseId}, ${card.kind}, ${card.text}, ${card.area ?? null}, ${card.risk_type ?? null},
              ${card.quote ?? null}, ${sessionId}, ${card.section})`;
  }
}

async function loadCase(caseId: number) {
  const [supportCase] = await sql<SupportCase[]>`select * from support_cases where id = ${caseId}`;
  if (!supportCase) return null;
  const [participant] = await sql<{ pseudonym: string }[]>`
    select pseudonym from participants where id = ${supportCase.participant_id}`;
  const [vault] = await sql<{ enc_name: string | null }[]>`
    select enc_name from participant_pii where participant_id = ${supportCase.participant_id}`;
  const sessions = await sql<Session[]>`select * from sessions where case_id = ${caseId} order by seq`;
  const cards = await sql<Card[]>`select * from cards where case_id = ${caseId} order by id`;
  const outcomes = await sql<CardOutcome[]>`
    select o.* from card_outcomes o join cards c on c.id = o.card_id where c.case_id = ${caseId}`;
  return { supportCase, pseudonym: participant.pseudonym, vault, sessions, cards, outcomes };
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
    today_goal_text: string | null;
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

/** 당사자 정보 화면(탭 4)의 재료를 한 번에 낸다. 탭마다 따로 부르지 않는다. */
export async function getCaseDetail(caseId: number): Promise<CaseDetail | null> {
  const loaded = await loadCase(caseId);
  if (!loaded) return null;
  const { supportCase, pseudonym, sessions, cards, outcomes } = loaded;

  const [vault] = await sql<Array<{ enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select enc_name, enc_phone, enc_email from participant_pii
    where participant_id = ${supportCase.participant_id}`;

  const revisions = await sql<Array<{ text: string | null; created_at: string }>>`
    select text, created_at from goal_revisions where case_id = ${caseId} order by created_at`;

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
    sessions: sessions.map((s) => ({
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      status: s.status,
      held_at: s.held_at,
      scheduled_at: s.scheduled_at,
      line: buildSessionLine(s, cards),
      memo: s.memo,
      today_goal_text: s.today_goal_text,
    })),
    goal_revisions: revisions,
    open_cards: openCards(cards, outcomes, sessions).map((c) => ({
      ...c,
      source_session_seq: sessions.find((s) => s.id === c.source_session_id)?.seq ?? null,
    })),
    closure: closure
      ? {
          closed_at: closure.closed_at,
          close_reason: closure.close_reason,
          unfinished_note: closure.unfinished_note,
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
      values (${caseId}, ${last?.id ?? null}, ${input.close_reason},
              ${input.unfinished_note ?? null}, ${input.actorId ?? null})
      on conflict (case_id) do update set case_id = excluded.case_id
      returning closed_at`;
    await tx`update support_cases set status = 'closed' where id = ${caseId}`;
    return { case_id: caseId, closed_at: row.closed_at };
  });
}

export type ParticipantRow = {
  case_id: number;
  participant_id: number;
  pseudonym: string;
  name: string | null;
  program_name: string;
  status: 'open' | 'closed';
  last_session_seq: number | null;
  next_scheduled_at: string | null;
};

/**
 * 당사자 목록. 이름은 금고 암호문이라 **서버에서 이름으로 검색할 수 없다** —
 * 복호화해서 내려보내고 거르는 일은 화면이 한다. 기관 하나 규모라 이 대가를 받아들인다.
 */
export async function listParticipants(): Promise<ParticipantRow[]> {
  const rows = await sql<Array<Omit<ParticipantRow, 'name'> & { enc_name: string | null }>>`
    select c.id as case_id,
           p.id as participant_id,
           p.pseudonym,
           v.enc_name,
           c.program_name,
           c.status,
           (select max(seq) from sessions s where s.case_id = c.id and s.status = 'done') as last_session_seq,
           (select min(scheduled_at) from sessions s where s.case_id = c.id and s.status = 'planned') as next_scheduled_at
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    order by c.opened_at desc`;
  return rows.map(({ enc_name, ...row }) => ({ ...row, name: decryptPii(enc_name) }));
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

/** 다가오는 상담. 홈 화면의 재료다. 열린 과제·질문 수를 함께 센다(일정 화면의 `할 일` 띠). */
export async function listSchedules(from: string, to: string): Promise<ScheduleRow[]> {
  const rows = await sql<Array<Omit<ScheduleRow, 'name'> & { enc_name: string | null }>>`
    select s.id as session_id, s.case_id, s.seq, s.scheduled_at, s.method, s.place, s.plan_memo,
           p.pseudonym, v.enc_name, c.program_name
    from sessions s
    join support_cases c on c.id = s.case_id
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where s.status = 'planned' and s.scheduled_at between ${from} and ${to}
    order by s.scheduled_at`;
  const out: ScheduleRow[] = [];
  for (const { enc_name, ...row } of rows) {
    const loaded = await loadCase(row.case_id);
    const open = loaded ? openCards(loaded.cards, loaded.outcomes, loaded.sessions) : [];
    out.push({
      ...row,
      name: decryptPii(enc_name),
      open_tasks: open.filter((c) => c.kind === 'promise').length,
      open_questions: open.filter((c) => c.kind === 'question').length,
    });
  }
  return out;
}

export async function getBriefing(caseId: number): Promise<Briefing | null> {
  const loaded = await loadCase(caseId);
  if (!loaded) return null;
  return buildBriefing({
    supportCase: loaded.supportCase,
    pseudonym: loaded.pseudonym,
    name: decryptPii(loaded.vault?.enc_name ?? null),
    sessions: loaded.sessions,
    cards: loaded.cards,
    outcomes: loaded.outcomes,
  });
}
