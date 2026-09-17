// 기관을 여는 첫 가입(2026-09-17 Q). **seed 없는 새 DB** 에서만 뜻이 있는 시험이라 DB 와 서버를 따로 띄운다.
// 문은 활성 관리자 수 하나로 열리고 닫힌다. 경쟁 요청 둘이 관리자 둘을 만들면 이 시험이 잡는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enabled } from './voice-fixture.ts';
import { scratchDb, startServer, type Scratch } from './scratch-db.ts';

let scratch: Scratch;
let base: string;
let stop: () => void;

const signup = (body: Record<string, unknown>) =>
  fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

describe.skipIf(!enabled)('first signup gate', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate();
    ({ base, stop } = await startServer(scratch.url));
  }, 60_000);
  afterAll(async () => {
    stop?.();
    await scratch?.drop();
  });

  it('opens only while no admin exists, seats exactly one admin under contention, and gates the wizard', async () => {
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({ open: true });

    // 형식이 틀린 슬러그는 보낸 쪽 잘못이다 — 문이 열려 있어도 계정을 만들지 않는다.
    const bad = await signup({ org_name: '연대은행', slug: 'Bad Slug', email: 'a1', password: 'pass1', name: '관리자' });
    expect(bad.status).toBe(400);

    // 같은 순간 두 사람이 문을 두드린다. 한 명만 들어온다.
    const [first, second] = await Promise.all([
      signup({ org_name: '연대은행', slug: 'yeondae', email: 'admin1', password: 'pass1', name: '첫 관리자' }),
      signup({ org_name: '다른 기관', slug: 'other', email: 'admin2', password: 'pass2', name: '둘째' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 403]);
    const winner = first.status === 200 ? first : second;
    expect(cookieOf(winner)).toMatch(/^relayer_session=/);

    const admins = await scratch.db<Array<{ email: string; name: string }>>`
      select email, name from users where role = 'admin' and deactivated_at is null`;
    expect(admins).toHaveLength(1);
    const [org] = await scratch.db<Array<{ name: string; slug: string; onboarded_at: string | null }>>`
      select name, slug, onboarded_at from organization where id = 1`;
    // 이긴 쪽의 기관 이름·슬러그가 남는다. 진 쪽은 아무것도 적지 못한다.
    expect(org.name).toBe(admins[0].email === 'admin1' ? '연대은행' : '다른 기관');
    expect(org.slug).toBe(admins[0].email === 'admin1' ? 'yeondae' : 'other');
    expect(org.onboarded_at).toBeNull();

    // 문은 닫혔다. 다시 두드려도 계정이 늘지 않는다.
    expect(await (await fetch(`${base}/auth/signup`)).json()).toEqual({ open: false });
    const late = await signup({ org_name: 'x', slug: 'x', email: 'admin3', password: 'pass3', name: '늦은 사람' });
    expect(late.status).toBe(403);
    const [{ n }] = await scratch.db<Array<{ n: number }>>`select count(*)::int as n from users`;
    expect(n).toBe(1);

    // 가입 쿠키로 바로 들어온다. 마법사를 마치기 전이라 onboarded:false.
    const cookie = cookieOf(winner);
    const me = await (await fetch(`${base}/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ role: 'admin', onboarded: false });
    const done = await fetch(`${base}/settings/onboarding/complete`, { method: 'POST', headers: { cookie } });
    expect(done.status).toBe(200);
    const after = await (await fetch(`${base}/me`, { headers: { cookie } })).json();
    expect(after.onboarded).toBe(true);

    // 감사에는 값이 아니라 항목 이름만 남는다.
    const audits = await scratch.db<Array<{ action: string; fields: string[] }>>`
      select action, fields from audit_log where action = 'org.bootstrap'`;
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].fields)).not.toMatch(/pass1|pass2|연대은행|다른 기관/);
  }, 60_000);
});
