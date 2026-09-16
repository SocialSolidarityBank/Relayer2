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
import type { Assignee } from './domain/types.ts';

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
    select count(*) from case_assignments a
    join support_cases c on c.id = a.case_id
    where a.user_id = ${userId} and c.status = 'open'`;
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
           (select count(*) from case_assignments a
             join support_cases c on c.id = a.case_id
             where a.user_id = u.id and c.status = 'open')::int as open_cases
    from users u
    where u.role in ('worker', 'admin')
    order by u.deactivated_at nulls first, u.name`;
}

export type WorkerCase = { id: number; pseudonym: string; program_name: string; status: string };

/** 한 실무자가 맡은 당사자들. 관리자도 이 목록 밖의 상담 자료는 열 수 없다. */
export async function workerCases(userId: number): Promise<WorkerCase[]> {
  return sql<WorkerCase[]>`
    select c.id, p.pseudonym, c.program_name, c.status
    from case_assignments a
    join support_cases c on c.id = a.case_id
    join participants p on p.id = c.participant_id
    where a.user_id = ${userId}
    order by c.status, c.id desc`;
}

export type AssignmentCase = {
  id: number;
  pseudonym: string;
  program_name: string;
  status: string;
  assignees: Assignee[];
};

/** 관리자 배정 화면. 가명·사업·상태·담당자만 — 상담 내용은 없다. */
export async function listAssignments(): Promise<AssignmentCase[]> {
  return sql<AssignmentCase[]>`
    select c.id, p.pseudonym, c.program_name, c.status,
           (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name), '[]'::jsonb)
              from case_assignments a join users u on u.id = a.user_id
             where a.case_id = c.id) as assignees
    from support_cases c join participants p on p.id = c.participant_id
    order by c.status, c.id desc`;
}

/**
 * 배정 **전체 집합** 바꾸기. 빈 배열은 모두 해제다.
 * 사례 행을 잡고 지우고 다시 넣는다 — 둘 사이를 다른 요청이 볼 수 없다.
 */
export async function assign(
  actorId: number,
  caseId: number,
  userIds: number[],
): Promise<{ ok: true } | { error: string }> {
  const ids = [...new Set(userIds)];
  const result = await sql.begin(async (tx) => {
    const [target] = await tx<Array<{ id: number }>>`
      select id from support_cases where id = ${caseId} for update`;
    if (!target) return { error: '없는 사례예요.' } as const;

    if (ids.length > 0) {
      const users = await tx<Array<{ id: number }>>`
        select id from users
        where id = any(${ids}) and role in ('worker', 'admin') and deactivated_at is null`;
      if (users.length !== ids.length) return { error: '활성 실무자만 배정할 수 있어요.' } as const;
    }

    await tx`delete from case_assignments where case_id = ${caseId}`;
    for (const userId of ids) {
      await tx`insert into case_assignments (case_id, user_id, assigned_by)
        values (${caseId}, ${userId}, ${actorId})`;
    }

    // 배정에서 빠진 사람이 발급한 링크도 함께 끊는다. 그 사람이 링크·코드를 기억하면
    // 로그인 없이 계속 기본정보와 일정을 열 수 있으므로, 직원 권한만 빼서는 제거가 아니다.
    // 남아 있는 담당자가 만든 링크는 건드리지 않는다.
    await tx`
      update participant_access pa set revoked_at = now()
      where pa.case_id = ${caseId} and pa.revoked_at is null
        and not exists (
          select 1 from case_assignments a
          where a.case_id = pa.case_id and a.user_id = pa.created_by
        )`;

    // 이 배정으로 이루어진 대기 요청은 그 자리에서 결정한다. 이후 배정에서 빼도
    // 옛 요청을 다시 승인해 몰래 되살릴 수 없게 decided_at 을 박는다.
    if (ids.length > 0) {
      await tx`
        update assignment_requests set decided_at = now(), decided_by = ${actorId}, decision = 'approved'
        where case_id = ${caseId} and decided_at is null and requested_by = any(${ids})`;
    }
    return { ok: true } as const;
  });
  if ('error' in result) return result;
  await audit({
    actorId,
    action: 'case.assign',
    caseId,
    fields: ids.map((id) => `assignee=${id}`),
  });
  return result;
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
  const [dup] = await sql<Array<{ id: number }>>`select id from users where email = ${input.email}`;
  if (dup) return { error: '이미 쓰는 아이디예요.' };

  // 해싱은 트랜잭션 밖에서. Argon2 는 수백 밀리초가 걸리고, 그동안 초대 행을 잡고 있으면
  // 같은 링크를 연 다른 사람이 그만큼 기다린다.
  const passwordHash = await hashPassword(input.password);

  /**
   * **초대를 먼저 잡고 계정을 만든다**(2026-09-16 검수).
   *
   * 전에는 초대가 살아 있는지 확인하고 계정을 만든 뒤 초대를 소비했다. 그 사이에 같은 링크를
   * 연 두 사람이 둘 다 "살아 있음"을 읽으면 **계정이 둘 생기고 둘 다 로그인됐다** —
   * 한 번 쓰는 링크가 두 사람을 들인 것이다.
   *
   * 이제 한 트랜잭션에서 초대 행을 `for update` 로 잡고, 소비에 성공한 요청만 계정을 만든다.
   */
  try {
    return await sql.begin(async (tx) => {
      const [invite] = await tx<Array<{ id: number; role: 'worker' | 'admin' }>>`
        select id, role from invites
        where token_hash = ${hashToken(input.token)}
          and accepted_at is null and revoked_at is null and expires_at > now()
        for update`;
      if (!invite) return { error: '쓸 수 없는 초대예요. 기한이 지났거나 이미 쓰였어요.' };

      const [user] = await tx<Array<{ id: number }>>`
        insert into users (email, password_hash, name, role)
        values (${input.email}, ${passwordHash}, ${input.name}, ${invite.role})
        returning id`;
      await tx`
        update invites set accepted_at = now(), accepted_by = ${user.id} where id = ${invite.id}`;
      await audit({
        actorId: user.id,
        action: 'invite.accept',
        fields: [`invite=${invite.id}`, `role=${invite.role}`],
      });
      return { userId: user.id };
    });
  } catch {
    // 같은 아이디를 동시에 만들면 유일 제약에 걸린다. 초대는 롤백되어 다시 쓸 수 있다.
    return { error: '이미 쓰는 아이디예요.' };
  }
}

// ── 배정 요청(실무자) ──────────────────────────────────────────────────────

export type RequestRow = {
  id: number;
  case_id: number;
  pseudonym: string;
  program_name: string;
  requester_id: number;
  requester: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  decision: string | null;
};

export async function listRequests(mineOnly: number | null): Promise<RequestRow[]> {
  return sql<RequestRow[]>`
    select r.id, r.case_id, p.pseudonym, c.program_name, r.requested_by as requester_id, u.name as requester,
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
  try {
    const result = await sql.begin(async (tx) => {
      // 배정 교체와 같은 사례 잠금 아래에서 확인·요청한다. 확인 뒤 배정이 바뀌어
      // 이미 담당인 사람의 대기 요청이 남고, 제거 뒤 옛 요청으로 되살아나는 틈을 닫는다.
      const [c] = await tx<Array<{ id: number }>>`
        select id from support_cases where id = ${caseId} for update`;
      if (!c) return { error: '없는 사례예요.' } as const;
      const [member] = await tx<Array<{ user_id: number }>>`
        select user_id from case_assignments where case_id = ${caseId} and user_id = ${userId}`;
      if (member) return { error: '이미 맡고 있는 당사자예요.' } as const;
      await tx`
        insert into assignment_requests (case_id, requested_by, reason)
        values (${caseId}, ${userId}, ${reason})`;
      return { ok: true } as const;
    });
    if ('error' in result) return result;
  } catch {
    // 대기 요청 유일 제약은 (사례, 요청자)다. 다른 사람은 같은 사례에 따로 요청할 수 있다.
    return { error: '이미 요청이 올라가 있어요.' };
  }
  await audit({ actorId: userId, action: 'assignment.request', caseId, fields: [] });
  return { ok: true };
}

/**
 * 승인하면 기존 담당을 바꾸지 않고 요청자를 **더한다**.
 * 요청·사례 행을 한 트랜잭션에서 잡아 같은 요청을 두 번 승인하거나,
 * 이미 결정된 옛 요청으로 제거된 사람을 되살리지 못하게 한다.
 */
export async function decideRequest(
  actorId: number,
  id: number,
  decision: 'approved' | 'rejected',
): Promise<{ ok: true } | { error: string }> {
  const result = await sql.begin(async (tx) => {
    const [preview] = await tx<Array<{ case_id: number }>>`
      select case_id from assignment_requests where id = ${id}`;
    if (!preview) return { error: '이미 결정했거나 없는 요청이에요.' } as const;

    // 배정 교체와 같은 순서(사례 → 요청)로 잠근다. 반대 순서면 둘이 서로 기다린다.
    await tx`select id from support_cases where id = ${preview.case_id} for update`;
    const [row] = await tx<Array<{ case_id: number; requested_by: number }>>`
      select case_id, requested_by from assignment_requests
      where id = ${id} and decided_at is null for update`;
    if (!row) return { error: '이미 결정했거나 없는 요청이에요.' } as const;
    if (decision === 'approved') {
      const [active] = await tx<Array<{ id: number }>>`
        select id from users
        where id = ${row.requested_by}
          and role in ('worker', 'admin') and deactivated_at is null`;
      if (!active) return { error: '활성 실무자만 배정할 수 있어요.' } as const;
      await tx`
        insert into case_assignments (case_id, user_id, assigned_by)
        values (${row.case_id}, ${row.requested_by}, ${actorId})
        on conflict (case_id, user_id) do nothing`;
    }
    await tx`
      update assignment_requests set decided_at = now(), decided_by = ${actorId}, decision = ${decision}
      where id = ${id}`;
    return { ok: true, caseId: row.case_id } as const;
  });
  if ('error' in result) return result;
  await audit({
    actorId,
    action: 'assignment.decide',
    caseId: result.caseId,
    fields: [`request=${id}`, decision],
  });
  return { ok: true };
}
