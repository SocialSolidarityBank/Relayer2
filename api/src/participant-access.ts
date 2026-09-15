// 당사자 열람(P2). 당사자는 로그인하지 않는다 — 실무자가 준 **링크 + 코드**로 연다(GLOSSARY §3).
//
// 자물쇠가 둘인 이유: 링크는 주소에 실려 대화방·메일에 남는다. 그것만으로 열리면 안 된다.
// 보이는 것은 **기본정보(이름·연락처·이메일)와 자기 일정까지**다. 상담 내용은 보이지 않는다.
import { randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { decryptPii } from './pii.ts';

const DEFAULT_DAYS = 14;

export type IssuedAccess = { token: string; code: string; expires_at: string };

/**
 * 링크와 코드를 새로 낸다. 같은 당사자의 이전 링크는 잠근다 —
 * 살아 있는 링크가 여럿이면 누구에게 무엇을 줬는지 알 수 없다.
 */
export async function issueAccess(
  participantId: number,
  actorId: number,
  days = DEFAULT_DAYS,
): Promise<IssuedAccess> {
  const token = randomBytes(24).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  await sql.begin(async (tx) => {
    await tx`
      update participant_access set revoked_at = now()
      where participant_id = ${participantId} and revoked_at is null`;
    await tx`
      insert into participant_access (participant_id, token, code_hash, expires_at, created_by)
      values (${participantId}, ${token}, ${await hash(code)}, ${expiresAt}, ${actorId})`;
  });

  return { token, code, expires_at: expiresAt };
}

export async function revokeAccess(participantId: number): Promise<void> {
  await sql`
    update participant_access set revoked_at = now()
    where participant_id = ${participantId} and revoked_at is null`;
}

export type AccessState = {
  active: boolean;
  expires_at: string | null;
  attempts_left: number | null;
  last_opened_at: string | null;
};

export async function accessState(participantId: number): Promise<AccessState> {
  const [row] = await sql<
    Array<{ expires_at: string; attempts_left: number; last_opened_at: string | null }>
  >`
    select expires_at, attempts_left, last_opened_at from participant_access
    where participant_id = ${participantId} and revoked_at is null
      and expires_at > now() and attempts_left > 0
    order by id desc limit 1`;
  return {
    active: Boolean(row),
    expires_at: row?.expires_at ?? null,
    attempts_left: row?.attempts_left ?? null,
    last_opened_at: row?.last_opened_at ?? null,
  };
}

export type ParticipantView = {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** 앞으로의 일정만. 지난 상담 기록은 보이지 않는다. */
  schedule: Array<{ scheduled_at: string; method: string | null; place: string | null; program_name: string }>;
};

export type OpenResult =
  | { ok: true; view: ParticipantView }
  | { ok: false; reason: 'not_found' | 'expired' | 'locked' | 'wrong_code'; attempts_left?: number };

/**
 * 링크와 코드로 연다. 틀리면 남은 횟수를 깎고, 0 이 되면 잠긴다.
 * 어느 쪽이 틀렸는지(링크인지 코드인지)는 알려 주지 않는다.
 */
export async function openAccess(token: string, code: string): Promise<OpenResult> {
  const [row] = await sql<
    Array<{
      id: number;
      participant_id: number;
      code_hash: string;
      expires_at: string;
      attempts_left: number;
      revoked_at: string | null;
    }>
  >`select id, participant_id, code_hash, expires_at, attempts_left, revoked_at
    from participant_access where token = ${token}`;

  if (!row || row.revoked_at) return { ok: false, reason: 'not_found' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };
  if (row.attempts_left <= 0) return { ok: false, reason: 'locked' };

  if (!(await verify(row.code_hash, code))) {
    const [left] = await sql<Array<{ attempts_left: number }>>`
      update participant_access set attempts_left = attempts_left - 1
      where id = ${row.id} returning attempts_left`;
    return { ok: false, reason: 'wrong_code', attempts_left: left.attempts_left };
  }

  await sql`
    update participant_access set last_opened_at = now(), attempts_left = 5
    where id = ${row.id}`;

  const [vault] = await sql<Array<{ enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select enc_name, enc_phone, enc_email from participant_pii where participant_id = ${row.participant_id}`;

  const schedule = await sql<
    Array<{ scheduled_at: string; method: string | null; place: string | null; program_name: string }>
  >`
    select s.scheduled_at, s.method, s.place, c.program_name
    from sessions s join support_cases c on c.id = s.case_id
    where c.participant_id = ${row.participant_id}
      and s.status = 'planned' and s.scheduled_at >= now()
    order by s.scheduled_at`;

  // 당사자 본인이 자기 것을 본 것도 열람이다. 남긴다.
  await audit({
    actorId: 0,
    action: 'participant.view',
    participantId: row.participant_id,
    fields: ['name', 'phone', 'email', 'schedule'],
  });

  return {
    ok: true,
    view: {
      name: decryptPii(vault?.enc_name ?? null),
      phone: decryptPii(vault?.enc_phone ?? null),
      email: decryptPii(vault?.enc_email ?? null),
      schedule,
    },
  };
}
