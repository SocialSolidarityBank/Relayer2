// 첫 가입(2026-09-17 Q). **seed 없는 새 DB** 에서만 뜻이 있는 시험이라 DB 와 서버를 따로 띄운다.
// 문은 마감 표식·활성 관리자 수로 열리고, 첫 관리자가 생기는 순간 영구히 닫힌다. 경쟁 요청 둘이 관리자 둘을 만들면 이 시험이 잡는다.
// 가입은 계정만 만들고, 기관 워크스페이스(이름)는 로그인 뒤 PUT /settings/org 로 만든다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enabled } from './voice-fixture.ts';
import { scratchDb, startServer, type Scratch } from './scratch-db.ts';

let scratch: Scratch;
let base: string;
let stop: () => void;

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const signup = (body: Record<string, unknown>) => post('/auth/signup', body);
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

describe.skipIf(!enabled)('first signup gate', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate();
    ({ base, stop } = await startServer(scratch.url, { RELAYER_SLUG: 'yeondae' }));
  }, 60_000);
  afterAll(async () => {
    stop?.();
    await scratch?.drop();
  });

  it('opens once, seats exactly one admin under contention, closes for good, then the admin creates the workspace and finishes the wizard', async () => {
    // 새 DB: 문이 열려 있고 워크스페이스는 아직 없다(주소 이름만 배포 설정에서 온다).
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({ open: true, workspace: null });

    // 형식이 틀리면 보낸 쪽 잘못 — 계정을 만들지 않는다.
    expect((await signup({ email: 'a', password: 'pass1', name: '관리자' })).status).toBe(400);

    // 같은 순간 두 사람이 문을 두드린다. 한 명만 들어온다.
    const [first, second] = await Promise.all([
      signup({ email: 'admin1', password: 'pass1', name: '첫 관리자' }),
      signup({ email: 'admin2', password: 'pass2', name: '둘째' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 403]);
    const winner = first.status === 200 ? first : second;
    const cookie = cookieOf(winner);
    expect(cookie).toMatch(/^relayer_session=/);

    const admins = await scratch.db<Array<{ email: string }>>`
      select email from users where role = 'admin' and deactivated_at is null`;
    expect(admins).toHaveLength(1);
    const [org] = await scratch.db<Array<{ name: string; onboarded_at: Date | null; bootstrap_closed_at: Date | null }>>`
      select name, onboarded_at, bootstrap_closed_at from organization where id = 1`;
    expect(org.name).toBe('');
    expect(org.onboarded_at).toBeNull();
    expect(org.bootstrap_closed_at).not.toBeNull();

    // 문은 닫혔다. 다시 두드려도 계정이 늘지 않는다.
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({ open: false, workspace: null });
    expect((await signup({ email: 'admin3', password: 'pass3', name: '늦은 사람' })).status).toBe(403);

    // **영구 마감** — 관리자가 사고로 0명이 돼도 문은 안 열린다.
    await scratch.db`update users set deactivated_at = now() where role = 'admin'`;
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({ open: false, workspace: null });
    expect((await signup({ email: 'admin4', password: 'pass4', name: '틈새' })).status).toBe(403);
    await scratch.db`update users set deactivated_at = null where role = 'admin'`;
    const [{ n }] = await scratch.db<Array<{ n: number }>>`select count(*)::int as n from users`;
    expect(n).toBe(1);

    // 가입 쿠키로 바로 들어온다. 워크스페이스도 마법사도 아직이다.
    const me = await (await fetch(`${base}/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ role: 'admin', onboarded: false, workspace: null });

    // 마법사 1단계 — 기관 워크스페이스 만들기 = 기관 이름을 적는다. 주소는 읽기 전용(배포 설정) — 보내도 무시된다.
    const created = await fetch(`${base}/settings/org`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '연대은행 상담센터', slug: 'hacked' }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ name: '연대은행 상담센터', slug: 'yeondae', public_address: 'yeondae', onboarded: false });
    const [{ slug: storedSlug }] = await scratch.db<Array<{ slug: string | null }>>`select slug from organization where id = 1`;
    expect(storedSlug).toBeNull();
    const after = await (await fetch(`${base}/me`, { headers: { cookie } })).json();
    expect(after.workspace).toEqual({ name: '연대은행 상담센터', slug: 'yeondae', public_address: 'yeondae' });
    // 로그인 앞에서도 어느 기관인지는 보인다 — 닫힌 문 앞의 사람을 로그인으로 보내기 위해.
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({
      open: false,
      workspace: { name: '연대은행 상담센터', slug: 'yeondae', public_address: 'yeondae' },
    });

    // 마법사 완료.
    expect((await post('/settings/onboarding/complete', {}, cookie)).status).toBe(200);
    expect((await (await fetch(`${base}/me`, { headers: { cookie } })).json()).onboarded).toBe(true);

    // 감사: 첫 가입과 워크스페이스 만들기 둘 다 org.bootstrap, 값은 없다.
    const audits = await scratch.db<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'org.bootstrap' order by id`;
    expect(audits.map((a) => a.fields)).toEqual([
      ['first_admin', `user=${me.id}`],
      ['name', 'reg_no', 'address', 'phone'],
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/pass1|pass2|연대은행/);
  }, 60_000);
});
