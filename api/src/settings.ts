/**
 * 설정하기(2026-09-16 Q). 공통·관리자·실무자 세 묶음.
 *
 * 규율 둘.
 * - **로그인 아이디는 안 바뀐다.** 감사 기록이 사람을 아이디로 가리키는데 그것이 움직이면
 *   지난 기록이 누구를 말하는지 흐려진다. 이름·연락처·연락 이메일만 고친다.
 * - **관리자 일은 관리자만.** 라우트마다 역할을 확인한다. 화면에서 감추는 것은 안내이지 잠금이 아니다.
 */
import { randomBytes, createHash } from 'node:crypto';
import { sql } from './db.ts';
import { audit } from './audit.ts';
import { hashPassword } from './auth.ts';

export type Me = {
  id: number;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  contact_email: string | null;
};

export async function getProfile(userId: number): Promise<Me | null> {
  const [row] = await sql<Me[]>`
    select id, email, name, role, phone, contact_email from users where id = ${userId}`;
  return row ?? null;
}

export async function updateProfile(
  userId: number,
  patch: { name: string; phone: string | null; contact_email: string | null },
): Promise<Me | null> {
  await sql`
    update users set name = ${patch.name}, phone = ${patch.phone}, contact_email = ${patch.contact_email}
    where id = ${userId}`;
  await audit({ actorId: userId, action: 'user.profile.update', fields: ['name', 'phone', 'contact_email'] });
  return getProfile(userId);
}

/**
 * 탈퇴 — 행을 지우지 않고 `deactivated_at` 을 찍는다.
 *
 * 이 사람이 남긴 기록(상담 회차, 감사, 승인)은 사례의 것이지 계정의 것이 아니다.
 * 계정을 지우면 "누가 기록했나"가 통째로 빈칸이 된다. 로그인만 막는 것이 옳다.
 *
 * **마지막 관리자는 못 나간다.** 나가면 아무도 워크스페이스를 고칠 수 없다.
 */
export async function deactivate(userId: number): Promise<{ ok: true } | { error: string }> {
  const [me] = await sql<Array<{ role: string }>>`select role from users where id = ${userId}`;
  if (!me) return { error: '계정을 찾지 못했어요.' };
  if (me.role === 'admin') {
    const [{ count }] = await sql<Array<{ count: string }>>`
      select count(*) from users where role = 'admin' and deactivated_at is null`;
    if (Number(count) <= 1) {
      return { error: '마지막 관리자예요. 다른 사람을 관리자로 세운 뒤에 나갈 수 있어요.' };
    }
  }
  const [{ count: mine }] = await sql<Array<{ count: string }>>`
    select count(*) from support_cases where assigned_user_id = ${userId} and status = 'open'`;
  if (Number(mine) > 0) {
    return { error: `아직 맡고 있는 당사자가 ${mine}명 있어요. 다른 실무자에게 넘긴 뒤에 나갈 수 있어요.` };
  }
  await sql`update users set deactivated_at = now() where id = ${userId}`;
  await audit({ actorId: userId, action: 'user.deactivate', fields: [`user=${userId}`] });
  return { ok: true };
}

// ── 기관 정보 ──────────────────────────────────────────────────────────────

export type Org = { name: string; reg_no: string | null; address: string | null; phone: string | null };

export async function getOrg(): Promise<Org> {
  const [row] = await sql<Org[]>`select name, reg_no, address, phone from organization where id = 1`;
  return row ?? { name: '', reg_no: null, address: null, phone: null };
}

export async function updateOrg(actorId: number, patch: Org): Promise<Org> {
  await sql`
    update organization
    set name = ${patch.name}, reg_no = ${patch.reg_no}, address = ${patch.address},
        phone = ${patch.phone}, updated_at = now(), updated_by = ${actorId}
    where id = 1`;
  await audit({ actorId, action: 'org.update', fields: ['name', 'reg_no', 'address', 'phone'] });
  return getOrg();
}

// ── 사업 목록 ──────────────────────────────────────────────────────────────

export type Program = { id: number; name: string; retired_at: string | null; cases: number };

/** `all` 이 아니면 살아 있는 사업만. 당사자 등록 선택지가 이것을 쓴다. */
export async function listPrograms(all = false): Promise<Program[]> {
  return sql<Program[]>`
    select p.id, p.name, p.retired_at,
           (select count(*) from support_cases c where c.program_name = p.name)::int as cases
    from programs p
    where ${all ? sql`true` : sql`p.retired_at is null`}
    order by p.retired_at nulls first, p.name`;
}

export async function addProgram(actorId: number, name: string): Promise<Program[]> {
  await sql`insert into programs (name) values (${name}) on conflict (name) do update set retired_at = null`;
  await audit({ actorId, action: 'program.add', fields: [`name=${name}`] });
  return listPrograms(true);
}

/**
 * 사업을 내린다 — 지우지 않는다. 이미 그 사업으로 열린 사례가 있고,
 * 이름이 사라지면 그 사례들이 무엇이었는지 설명할 말이 없어진다.
 * 내린 사업은 새 당사자 등록에서만 안 보인다.
 */
export async function retireProgram(actorId: number, id: number): Promise<Program[]> {
  await sql`update programs set retired_at = now() where id = ${id}`;
  await audit({ actorId, action: 'program.retire', fields: [`program=${id}`] });
  return listPrograms(true);
}

// ── 실무자 ────────────────────────────────────────────────────────────────

export type Worker = {
  id: number;
  name: string;
  email: string;
  role: string;
  deactivated_at: string | null;
  open_cases: number;
};

export async function listWorkers(): Promise<Worker[]> {
  return sql<Worker[]>`
    select u.id, u.name, u.email, u.role, u.deactivated_at,
           (select count(*) from support_cases c
             where c.assigned_user_id = u.id and c.status = 'open')::int as open_cases
    from users u
    where u.role in ('worker', 'admin')
    order by u.deactivated_at nulls first, u.name`;
}

export type WorkerCase = { id: number; pseudonym: string; program_name: string; status: string };

/** 한 실무자가 맡은 당사자들. 배정을 옮기기 전에 무엇이 따라 움직이는지 보여 준다. */
export async function workerCases(userId: number): Promise<WorkerCase[]> {
  return sql`
    select c.id, p.pseudonym, c.program_name, c.status
    from support_cases c join participants p on p.id = c.participant_id
    where c.assigned_user_id = ${userId}
    order by c.status, c.id desc`;
}

/** 배정 바꾸기. 관리자가 확정하면 즉시 효력이다(GLOSSARY 배정 규칙 — 실무자 수락 단계는 없다). */
export async function assign(actorId: number, caseId: number, userId: number | null): Promise<void> {
  await sql`update support_cases set assigned_user_id = ${userId} where id = ${caseId}`;
  await sql`
    update assignment_requests set decided_at = now(), decided_by = ${actorId}, decision = 'approved'
    where case_id = ${caseId} and decided_at is null and requested_by = ${userId}`;
  await audit({ actorId, action: 'case.assign', caseId, fields: [`assignee=${userId ?? 'none'}`] });
}

// ── 초대 ──────────────────────────────────────────────────────────────────

export type Invite = {
  id: number;
  role: string;
  note: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * 초대 링크를 만든다. **토큰은 이 순간 한 번만 보인다** — 표에는 해시만 남는다.
 * 7일 뒤 만료된다. 건네주지 못한 링크가 반년 뒤 살아 있으면 그것은 뒷문이다.
 */
export async function createInvite(
  actorId: number,
  role: 'worker' | 'admin',
  note: string | null,
): Promise<{ token: string; invite: Invite }> {
  const token = randomBytes(24).toString('base64url');
  const [invite] = await sql<Invite[]>`
    insert into invites (token_hash, role, note, created_by, expires_at)
    values (${hashToken(token)}, ${role}, ${note}, ${actorId}, now() + interval '7 days')
    returning id, role, note, created_at, expires_at, accepted_at, revoked_at`;
  await audit({ actorId, action: 'invite.create', fields: [`role=${role}`, `invite=${invite.id}`] });
  return { token, invite };
}

export async function listInvites(): Promise<Invite[]> {
  return sql<Invite[]>`
    select id, role, note, created_at, expires_at, accepted_at, revoked_at
    from invites order by created_at desc limit 50`;
}

export async function revokeInvite(actorId: number, id: number): Promise<Invite[]> {
  await sql`update invites set revoked_at = now() where id = ${id} and accepted_at is null`;
  await audit({ actorId, action: 'invite.revoke', fields: [`invite=${id}`] });
  return listInvites();
}

/** 초대장 확인 — 로그인 앞에서 부른다. 살아 있는지만 답하고 누가 만들었는지는 말하지 않는다. */
export async function peekInvite(token: string): Promise<{ role: string } | null> {
  const [row] = await sql<Array<{ role: string }>>`
    select role from invites
    where token_hash = ${hashToken(token)} and accepted_at is null and revoked_at is null and expires_at > now()`;
  return row ?? null;
}

/**
 * 초대장으로 들어오기. 계정을 만들고 그 자리에서 역할을 준다.
 *
 * 초대장 없이 가입하는 길은 없다 — 주소만 알면 누구나 워크스페이스에 들어오는 문은
 * 상담 기록을 다루는 제품에 있어서는 안 된다.
 */
export async function signUpWithInvite(input: {
  token: string;
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: number } | { error: string }> {
  const invite = await peekInvite(input.token);
  if (!invite) return { error: '쓸 수 없는 초대예요. 기한이 지났거나 이미 쓰였어요.' };

  const [dup] = await sql<Array<{ id: number }>>`select id from users where email = ${input.email}`;
  if (dup) return { error: '이미 쓰는 아이디예요.' };

  const [user] = await sql<Array<{ id: number }>>`
    insert into users (email, password_hash, name, role)
    values (${input.email}, ${await hashPassword(input.password)}, ${input.name}, ${invite.role})
    returning id`;
  await acceptInvite(input.token, user.id);
  return { userId: user.id };
}

export async function acceptInvite(token: string, userId: number): Promise<boolean> {
  const [row] = await sql<Array<{ id: number; role: string }>>`
    update invites set accepted_at = now(), accepted_by = ${userId}
    where token_hash = ${hashToken(token)} and accepted_at is null and revoked_at is null and expires_at > now()
    returning id, role`;
  if (!row) return false;
  await sql`update users set role = ${row.role} where id = ${userId}`;
  await audit({ actorId: userId, action: 'invite.accept', fields: [`invite=${row.id}`, `role=${row.role}`] });
  return true;
}

// ── 배정 요청(실무자) ──────────────────────────────────────────────────────

export type RequestRow = {
  id: number;
  case_id: number;
  pseudonym: string;
  program_name: string;
  requester: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  decision: string | null;
};

export async function listRequests(mineOnly: number | null): Promise<RequestRow[]> {
  return sql<RequestRow[]>`
    select r.id, r.case_id, p.pseudonym, c.program_name, u.name as requester,
           r.reason, r.created_at, r.decided_at, r.decision
    from assignment_requests r
    join support_cases c on c.id = r.case_id
    join participants p on p.id = c.participant_id
    join users u on u.id = r.requested_by
    where ${mineOnly === null ? sql`true` : sql`r.requested_by = ${mineOnly}`}
    order by r.decided_at nulls first, r.created_at desc
    limit 100`;
}

export async function requestAssignment(
  userId: number,
  caseId: number,
  reason: string | null,
): Promise<{ ok: true } | { error: string }> {
  const [c] = await sql<Array<{ assigned_user_id: number | null }>>`
    select assigned_user_id from support_cases where id = ${caseId}`;
  if (!c) return { error: '없는 사례예요.' };
  if (c.assigned_user_id === userId) return { error: '이미 맡고 있는 당사자예요.' };
  try {
    await sql`
      insert into assignment_requests (case_id, requested_by, reason)
      values (${caseId}, ${userId}, ${reason})`;
  } catch {
    return { error: '이 당사자는 이미 요청이 올라가 있어요.' };
  }
  await audit({ actorId: userId, action: 'assignment.request', caseId, fields: [] });
  return { ok: true };
}

export async function decideRequest(
  actorId: number,
  id: number,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const [row] = await sql<Array<{ case_id: number; requested_by: number }>>`
    update assignment_requests set decided_at = now(), decided_by = ${actorId}, decision = ${decision}
    where id = ${id} and decided_at is null
    returning case_id, requested_by`;
  if (!row) return;
  if (decision === 'approved') {
    await sql`update support_cases set assigned_user_id = ${row.requested_by} where id = ${row.case_id}`;
  }
  await audit({
    actorId,
    action: 'assignment.decide',
    caseId: row.case_id,
    fields: [`request=${id}`, decision],
  });
}
