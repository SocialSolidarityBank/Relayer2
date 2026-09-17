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
import { encryptPii } from './pii.ts';
import { assertProgramActive } from './access.ts';
import type { Assignee } from './domain/types.ts';

/**
 * 관리자 수를 바꾸는 트랜잭션은 모두 이 잠금을 먼저 잡는다(가입·초대 수락·역할 변경·탈퇴).
 * 한 행이라 직렬화가 곧 "마지막 관리자" 판정의 정확성이다.
 */
const lockOrg = (tx: typeof sql) => tx`select id from organization where id = 1 for update`;

const activeAdmins = async (tx: typeof sql): Promise<number> => {
  const [{ count }] = await tx<Array<{ count: string }>>`
    select count(*) from users where role = 'admin' and deactivated_at is null`;
  return Number(count);
};

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
 * **마지막 관리자는 못 나간다.** 나가면 아무도 기관 설정을 고칠 수 없다.
 */
export async function deactivate(userId: number): Promise<{ ok: true } | { error: string }> {
  const result = await sql.begin(async (tx) => {
    await lockOrg(tx as unknown as typeof sql);
    const [me] = await tx<Array<{ role: string }>>`select role from users where id = ${userId}`;
    if (!me) return { error: '계정 없음' } as const;
    if (me.role === 'admin' && (await activeAdmins(tx as unknown as typeof sql)) <= 1) {
      return { error: '마지막 관리자, 다른 관리자 지정 후 탈퇴 가능' } as const;
    }
    const [{ count: mine }] = await tx<Array<{ count: string }>>`
      select count(*) from case_assignments a
      join support_cases c on c.id = a.case_id
      where a.user_id = ${userId} and c.status = 'open'`;
    if (Number(mine) > 0) {
      return { error: `맡고 있는 당사자 ${mine}명, 다른 실무자에게 이관 후 탈퇴 가능` } as const;
    }
    await tx`update users set deactivated_at = now() where id = ${userId}`;
    return { ok: true } as const;
  });
  if ('error' in result) return result;
  await audit({ actorId: userId, action: 'user.deactivate', fields: [`user=${userId}`] });
  return result;
}

// ── 기관 정보 ──────────────────────────────────────────────────────────────

/**
 * 주소 이름(slug). 관리자가 워크스페이스 만들기에서 적는다(2026-09-17 Q). 아직 안 적었으면 배포 설정(RELAYER_SLUG)이
 * 기본값이다. DB 하나만 보는 앱은 전체 배포에서의 중복도, DNS 가 붙었는지도 알 수 없다 — 값은 표시·기록용이고 연결은 배포 절차다.
 */
const deploymentSlug = (): string | null => process.env.RELAYER_SLUG?.trim() || null;

export type Org = { name: string; reg_no: string | null; address: string | null; phone: string | null };
export type OrgView = Org & { slug: string | null; onboarded: boolean };

export async function getOrg(): Promise<OrgView> {
  const [row] = await sql<Array<Org & { slug: string | null; onboarded_at: string | null }>>`
    select name, reg_no, address, phone, slug, onboarded_at from organization where id = 1`;
  if (!row) return { name: '', reg_no: null, address: null, phone: null, slug: deploymentSlug(), onboarded: false };
  const { onboarded_at, slug, ...org } = row;
  return { ...org, slug: slug ?? deploymentSlug(), onboarded: onboarded_at !== null };
}

/**
 * 기관 정보 저장. **기관 워크스페이스 만들기(마법사 0단계)도 이 길이다** — 이름이 비어 있던 행에 이름이 적히는 순간
 * 워크스페이스가 생긴다. 새 표·새 API 를 두지 않는다(단일 행 id=1).
 */
export async function updateOrg(actorId: number, patch: Org & { slug?: string | null }): Promise<OrgView> {
  const [before] = await sql<Array<{ name: string }>>`select name from organization where id = 1`;
  await sql`
    update organization
    set name = ${patch.name}, reg_no = ${patch.reg_no}, address = ${patch.address},
        phone = ${patch.phone}, slug = ${patch.slug === undefined ? sql`slug` : patch.slug},
        updated_at = now(), updated_by = ${actorId}
    where id = 1`;
  await audit({
    actorId,
    action: before?.name === '' ? 'org.bootstrap' : 'org.update',
    fields: ['name', 'reg_no', 'address', 'phone', ...(patch.slug === undefined ? [] : ['slug'])],
  });
  return getOrg();
}

export type Workspace = { name: string; slug: string | null };

/** 기관 워크스페이스 — 기관 이름이 적힌 순간 생긴다. 이름이 비어 있으면 아직 없다(null). 이름·주소 이름은 비밀이 아니다. */
export async function workspaceInfo(): Promise<Workspace | null> {
  const [row] = await sql<Array<{ name: string; slug: string | null }>>`select name, slug from organization where id = 1`;
  return row && row.name !== '' ? { name: row.name, slug: row.slug ?? deploymentSlug() } : null;
}

/**
 * 가입 문이 열려 있나 — 활성 관리자가 한 명도 없고 **아직 한 번도 닫힌 적이 없을 때만.**
 * 첫 관리자가 생기면 `bootstrap_closed_at` 이 찍혀 영구히 닫힌다(사고로 관리자가 0명이 돼도 안 열린다).
 */
export async function signupOpen(): Promise<boolean> {
  const [row] = await sql<Array<{ closed: boolean }>>`
    select (bootstrap_closed_at is not null) as closed from organization where id = 1`;
  if (!row || row.closed) return false;
  return (await activeAdmins(sql)) === 0;
}

/**
 * 첫 가입(2026-09-17 Q). 초대 규율의 **유일한 예외**다 — 그 뒤 합류는 초대 링크뿐이다.
 * 계정만 만든다. 기관 워크스페이스(이름)는 로그인 뒤 마법사 0단계(`PUT /settings/org`)에서 만든다 —
 * 계정과 기관 설정을 갈라 두어야 "누가 이 기관을 만드는가"와 "기관이 무엇인가"가 섞이지 않는다.
 *
 * 기관 행을 잠근 채 마감 표식과 활성 관리자 수를 보고, 둘 다 비어 있을 때만 관리자 계정을 만들고
 * **같은 트랜잭션에서 문을 영구히 닫는다.** 동시에 두 번 와도 잠금 뒤에 다시 본 쪽은 닫힌 문을 본다.
 * 해싱은 잠금 밖이다(초대 수락과 같은 모양).
 */
export async function bootstrapAdmin(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: number } | { error: string; status: 403 | 409 }> {
  const passwordHash = await hashPassword(input.password);
  let result: { userId: number } | { error: string; status: 403 | 409 };
  try {
    result = await sql.begin(async (tx) => {
      await lockOrg(tx as unknown as typeof sql);
      const [org] = await tx<Array<{ closed: boolean }>>`
        select (bootstrap_closed_at is not null) as closed from organization where id = 1`;
      if (!org || org.closed || (await activeAdmins(tx as unknown as typeof sql)) > 0) {
        return { error: '이 기관은 초대 링크로만 가입할 수 있어요. 관리자에게 초대 링크를 요청해 주세요.', status: 403 } as const;
      }
      const [user] = await tx<Array<{ id: number }>>`
        insert into users (email, password_hash, name, role)
        values (${input.email}, ${passwordHash}, ${input.name}, 'admin')
        returning id`;
      await tx`update organization set bootstrap_closed_at = now(), updated_at = now(), updated_by = ${user.id} where id = 1`;
      return { userId: user.id };
    });
  } catch {
    // 같은 아이디가 이미 있다(실무자·당사자 계정). 유일 제약이 막는다.
    return { error: '이미 쓰는 아이디예요.', status: 409 };
  }
  // 감사는 커밋 뒤에. audit_log.actor_id 가 users 를 가리키는 FK 라 트랜잭션 안에서 쓰면 다른 연결이 그 사람을 못 본다.
  if ('userId' in result) {
    await audit({ actorId: result.userId, action: 'org.bootstrap', fields: ['first_admin', `user=${result.userId}`] });
  }
  return result;
}

/** 마법사 완료. 한 번 찍힌 시각은 다시 찍지 않는다. */
export async function completeOnboarding(actorId: number): Promise<void> {
  await sql`
    update organization set onboarded_at = coalesce(onboarded_at, now()), updated_at = now(), updated_by = ${actorId}
    where id = 1`;
}

export async function isOnboarded(): Promise<boolean> {
  const [row] = await sql<Array<{ onboarded_at: string | null }>>`select onboarded_at from organization where id = 1`;
  return row?.onboarded_at != null;
}

// ── AI 키 ──────────────────────────────────────────────────────────────────

/**
 * OpenAI 키를 검증하고 암호문으로 넣는다(2026-09-17 Q). 키 값은 어떤 응답·감사·로그에도 싣지 않는다.
 * 검증에 실패한 키는 저장하지 않는다 — 안 되는 열쇠를 넣어 두면 "연결됨"이 거짓이 된다.
 * `null` 이면 지운다. 그 뒤 호출은 환경 변수 키로 떨어진다(ai.ts).
 */
export async function setAiKey(actorId: number, key: string | null): Promise<{ ok: true } | { error: string }> {
  if (key !== null) {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
    }).catch(() => null);
    if (!res?.ok) return { error: 'OpenAI 가 이 키를 받지 않았어요. 키를 다시 확인해 주세요.' };
  }
  await sql`
    update organization set enc_openai_key = ${encryptPii(key)}, updated_at = now(), updated_by = ${actorId}
    where id = 1`;
  await audit({ actorId, action: 'ai.key.set', fields: [key === null ? 'removed=1' : 'provider=openai'] });
  return { ok: true };
}

// ── 사업 목록 ──────────────────────────────────────────────────────────────

export type Program = {
  id: number;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
  retired_at: string | null;
  /** 이 사업에 속한 사례 수(종결 포함). */
  cases: number;
  open_cases: number;
};

export type ProgramInput = {
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
};

/** `all` 이 아니면 살아 있는 사업만. 당사자 등록 선택지가 이것을 쓴다. */
export async function listPrograms(all = false): Promise<Program[]> {
  return sql<Program[]>`
    select p.id, p.name, p.starts_on::text, p.ends_on::text, p.description, p.retired_at,
           (select count(*) from support_cases c where c.program_id = p.id)::int as cases,
           (select count(*) from support_cases c where c.program_id = p.id and c.status = 'open')::int as open_cases
    from programs p
    where ${all ? sql`true` : sql`p.retired_at is null`}
    order by p.retired_at nulls first, p.id desc`;
}

const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

/**
 * 사업을 더한다. 이름이 겹치면 **되살리지 않고 409** 다(2026-09-17 Q) —
 * 종료된 사업과 같은 이름이면 다시 열기가 맞는 길이고, 그 안내는 화면이 한다.
 */
export async function addProgram(
  actorId: number,
  input: ProgramInput,
): Promise<{ program: Program } | { error: string }> {
  let id: number;
  try {
    [{ id }] = await sql<Array<{ id: number }>>`
      insert into programs (name, starts_on, ends_on, description)
      values (${input.name}, ${input.starts_on}, ${input.ends_on}, ${input.description})
      returning id`;
  } catch (e) {
    if (isUnique(e)) return { error: '같은 이름의 사업이 이미 있어요. 종료된 사업이면 다시 열기를 써 주세요.' };
    throw e;
  }
  await audit({ actorId, action: 'program.add', fields: [`program=${id}`] });
  return { program: (await listPrograms(true)).find((p) => p.id === id)! };
}

/** 사업 고치기. id 는 고정이고 종료된 사업은 다시 열기 뒤에만 고친다. */
export async function updateProgram(
  actorId: number,
  id: number,
  patch: Partial<ProgramInput>,
): Promise<{ program: Program } | { error: string; status: 404 | 409 }> {
  const [current] = await sql<Array<{ retired_at: string | null }>>`select retired_at from programs where id = ${id}`;
  if (!current) return { error: '없는 사업이에요.', status: 404 };
  if (current.retired_at) return { error: '종료된 사업은 고칠 수 없어요. 먼저 다시 열어 주세요.', status: 409 };
  try {
    await sql`
      update programs set
        name = coalesce(${patch.name ?? null}, name),
        starts_on = ${patch.starts_on === undefined ? sql`starts_on` : patch.starts_on},
        ends_on = ${patch.ends_on === undefined ? sql`ends_on` : patch.ends_on},
        description = ${patch.description === undefined ? sql`description` : patch.description}
      where id = ${id}`;
  } catch (e) {
    if (isUnique(e)) return { error: '같은 이름의 사업이 이미 있어요.', status: 409 };
    throw e;
  }
  await audit({
    actorId,
    action: 'program.update',
    fields: [`program=${id}`, ...Object.keys(patch).filter((k) => patch[k as keyof ProgramInput] !== undefined)],
  });
  return { program: (await listPrograms(true)).find((p) => p.id === id)! };
}

export type RetireWarning = { open_cases: number; planned_sessions: number };

/**
 * 사업 종료 — 지우지 않고 `retired_at` 을 찍는다. 열린 사례·예정 회차가 남아 있으면
 * 건수를 돌려주고 멈춘다. `confirm` 이면 그대로 종료한다. 속한 사례는 정리(종결·회수·배정)만 된다.
 */
export async function retireProgram(
  actorId: number,
  id: number,
  confirm: boolean,
): Promise<{ ok: true } | { warning: RetireWarning } | { error: string }> {
  const [row] = await sql<Array<{ open_cases: number; planned_sessions: number }>>`
    select (select count(*) from support_cases c where c.program_id = p.id and c.status = 'open')::int as open_cases,
           (select count(*) from sessions s join support_cases c on c.id = s.case_id
             where c.program_id = p.id and c.status = 'open' and s.status = 'planned')::int as planned_sessions
    from programs p where p.id = ${id}`;
  if (!row) return { error: '없는 사업이에요.' };
  if (!confirm && (row.open_cases > 0 || row.planned_sessions > 0)) return { warning: row };
  await sql`update programs set retired_at = coalesce(retired_at, now()) where id = ${id}`;
  await audit({ actorId, action: 'program.retire', fields: [`program=${id}`] });
  return { ok: true };
}

/** 다시 열기. `retired_at` 만 되돌린다 — 종결된 사례는 그대로 종결이다. */
export async function reopenProgram(actorId: number, id: number): Promise<{ ok: true } | { error: string }> {
  const [row] = await sql<Array<{ id: number }>>`
    update programs set retired_at = null where id = ${id} returning id`;
  if (!row) return { error: '없는 사업이에요.' };
  await audit({ actorId, action: 'program.reopen', fields: [`program=${id}`] });
  return { ok: true };
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

/**
 * 실무자 목록. `programId` 를 주면 **그 사업의 열린 사례를 맡은 사람만** — 사업 담당은
 * 배정에서 파생되고 따로 적지 않는다(2026-09-17 Q). 명시 배정 표를 만들지 않는다.
 */
export async function listWorkers(programId: number | null = null): Promise<Worker[]> {
  return sql<Worker[]>`
    select u.id, u.name, u.email, u.role, u.deactivated_at,
           (select count(*) from case_assignments a
             join support_cases c on c.id = a.case_id
             where a.user_id = u.id and c.status = 'open')::int as open_cases
    from users u
    where u.role in ('worker', 'admin')
      and ${
        programId === null
          ? sql`true`
          : sql`exists (select 1 from case_assignments a join support_cases c on c.id = a.case_id
                        where a.user_id = u.id and c.status = 'open' and c.program_id = ${programId})`
      }
    order by u.deactivated_at nulls first, u.name`;
}

/**
 * 역할 바꾸기(2026-09-17 Q). 실무자↔관리자. 자기 자신을 내리는 것도 되지만
 * **마지막 활성 관리자는 못 내린다** — 탈퇴와 같은 잠금 아래에서 센다.
 */
export async function setRole(
  actorId: number,
  userId: number,
  role: 'worker' | 'admin',
): Promise<{ ok: true } | { error: string; status: 404 | 409 }> {
  const result = await sql.begin(async (tx) => {
    await lockOrg(tx as unknown as typeof sql);
    const [target] = await tx<Array<{ role: string; deactivated_at: string | null }>>`
      select role, deactivated_at from users where id = ${userId} and role in ('worker', 'admin')`;
    if (!target) return { error: '실무자를 찾지 못했어요.', status: 404 } as const;
    if (target.deactivated_at) return { error: '나간 계정의 역할은 바꿀 수 없어요.', status: 409 } as const;
    if (target.role === 'admin' && role === 'worker' && (await activeAdmins(tx as unknown as typeof sql)) <= 1) {
      return { error: '마지막 관리자예요. 다른 사람을 관리자로 세운 뒤에 내릴 수 있어요.', status: 409 } as const;
    }
    await tx`update users set role = ${role} where id = ${userId}`;
    return { ok: true } as const;
  });
  if ('error' in result) return result;
  await audit({ actorId, action: 'user.role.update', fields: [`user=${userId}`, `role=${role}`] });
  return result;
}

export type WorkerCase = { id: number; pseudonym: string; program_name: string; status: string };

/** 한 실무자가 맡은 당사자들. 관리자도 이 목록 밖의 상담 자료는 열 수 없다. */
export async function workerCases(userId: number): Promise<WorkerCase[]> {
  return sql<WorkerCase[]>`
    select c.id, p.pseudonym, pg.name as program_name, c.status
    from case_assignments a
    join support_cases c on c.id = a.case_id
    join programs pg on pg.id = c.program_id
    join participants p on p.id = c.participant_id
    where a.user_id = ${userId}
    order by c.status, c.id desc`;
}

export type AssignmentCase = {
  id: number;
  pseudonym: string;
  program_id: number;
  program_name: string;
  status: string;
  assignees: Assignee[];
};

/** 관리자 배정 화면. 가명·사업·상태·담당자만 — 상담 내용은 없다. */
export async function listAssignments(): Promise<AssignmentCase[]> {
  return sql<AssignmentCase[]>`
    select c.id, p.pseudonym, c.program_id, pg.name as program_name, c.status,
           (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name), '[]'::jsonb)
              from case_assignments a join users u on u.id = a.user_id
             where a.case_id = c.id) as assignees
    from support_cases c
    join programs pg on pg.id = c.program_id
    join participants p on p.id = c.participant_id
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
    if (!target) return { error: '사례 없음' } as const;

    if (ids.length > 0) {
      const users = await tx<Array<{ id: number }>>`
        select id from users
        where id = any(${ids}) and role in ('worker', 'admin') and deactivated_at is null`;
      if (users.length !== ids.length) return { error: '활성 실무자만 배정 가능' } as const;
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
export async function peekInvite(token: string): Promise<{ role: string; org_name: string } | null> {
  const [row] = await sql<Array<{ role: string; org_name: string }>>`
    select i.role, o.name as org_name from invites i
    cross join organization o
    where o.id = 1 and i.token_hash = ${hashToken(token)}
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`;
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
  if (dup) return { error: '사용 중인 아이디' };

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
  let result: { userId: number; inviteId: number; role: string } | { error: string };
  try {
    result = await sql.begin(async (tx) => {
      // 관리자 초대는 관리자 수를 바꾼다 — 가입·역할 변경·탈퇴와 같은 잠금을 잡는다.
      await lockOrg(tx as unknown as typeof sql);
      const [invite] = await tx<Array<{ id: number; role: 'worker' | 'admin' }>>`
        select id, role from invites
        where token_hash = ${hashToken(input.token)}
          and accepted_at is null and revoked_at is null and expires_at > now()
        for update`;
      if (!invite) return { error: '쓸 수 없는 초대, 기한 만료 또는 이미 사용됨' };

      const [user] = await tx<Array<{ id: number }>>`
        insert into users (email, password_hash, name, role)
        values (${input.email}, ${passwordHash}, ${input.name}, ${invite.role})
        returning id`;
      await tx`
        update invites set accepted_at = now(), accepted_by = ${user.id} where id = ${invite.id}`;
      return { userId: user.id, inviteId: invite.id, role: invite.role };
    });
  } catch {
    // 같은 아이디를 동시에 만들면 유일 제약에 걸린다. 초대는 롤백되어 다시 쓸 수 있다.
    return { error: '사용 중인 아이디' };
  }
  if ('error' in result) return result;
  // 감사는 커밋 뒤에(2026-09-17 수정). 트랜잭션 안에서 쓰면 actor_id FK 가 아직 없는 사람을 가리켜 조용히 버려졌다.
  await audit({
    actorId: result.userId,
    action: 'invite.accept',
    fields: [`invite=${result.inviteId}`, `role=${result.role}`],
  });
  return { userId: result.userId };
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
    select r.id, r.case_id, p.pseudonym, pg.name as program_name, r.requested_by as requester_id, u.name as requester,
           r.reason, r.created_at, r.decided_at, r.decision
    from assignment_requests r
    join support_cases c on c.id = r.case_id
    join programs pg on pg.id = c.program_id
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
  // 종료된 사업의 사례는 새 담당을 받지 않는다. 관리자 배정 변경(assign)은 정리라서 예외다.
  await assertProgramActive(caseId);
  try {
    const result = await sql.begin(async (tx) => {
      // 배정 교체와 같은 사례 잠금 아래에서 확인·요청한다. 확인 뒤 배정이 바뀌어
      // 이미 담당인 사람의 대기 요청이 남고, 제거 뒤 옛 요청으로 되살아나는 틈을 닫는다.
      const [c] = await tx<Array<{ id: number }>>`
        select id from support_cases where id = ${caseId} for update`;
      if (!c) return { error: '사례 없음' } as const;
      const [member] = await tx<Array<{ user_id: number }>>`
        select user_id from case_assignments where case_id = ${caseId} and user_id = ${userId}`;
      if (member) return { error: '이미 맡고 있는 당사자' } as const;
      await tx`
        insert into assignment_requests (case_id, requested_by, reason)
        values (${caseId}, ${userId}, ${reason})`;
      return { ok: true } as const;
    });
    if ('error' in result) return result;
  } catch {
    // 대기 요청 유일 제약은 (사례, 요청자)다. 다른 사람은 같은 사례에 따로 요청할 수 있다.
    return { error: '이미 올라온 요청 있음' };
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
    if (!preview) return { error: '이미 결정됐거나 없는 요청' } as const;

    // 배정 교체와 같은 순서(사례 → 요청)로 잠근다. 반대 순서면 둘이 서로 기다린다.
    await tx`select id from support_cases where id = ${preview.case_id} for update`;
    const [row] = await tx<Array<{ case_id: number; requested_by: number }>>`
      select case_id, requested_by from assignment_requests
      where id = ${id} and decided_at is null for update`;
    if (!row) return { error: '이미 결정됐거나 없는 요청' } as const;
    if (decision === 'approved') {
      const [active] = await tx<Array<{ id: number }>>`
        select id from users
        where id = ${row.requested_by}
          and role in ('worker', 'admin') and deactivated_at is null`;
      if (!active) return { error: '활성 실무자만 배정 가능' } as const;
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
