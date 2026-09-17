// 실무자↔관리자 역할 바꾸기와 마지막 관리자 보호(2026-09-17 Q).
// "마지막 관리자"는 DB 전체의 수라 공유 시험 DB 에서는 다른 파일의 관리자가 섞인다 — 새 DB 와 서버를 따로 띄운다.
// 세션 캐시가 없으니 역할은 다음 요청부터 바로 적용된다 — 그 사실도 함께 본다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueCookie } from '../src/auth.ts';
import { enabled } from './voice-fixture.ts';
import { scratchDb, startServer, type Scratch } from './scratch-db.ts';

let scratch: Scratch;
let base: string;
let stop: () => void;

const call = (path: string, actor: number, method = 'GET', body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { cookie: issueCookie(actor).split(';')[0], 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

describe.skipIf(!enabled)('role change', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate();
    ({ base, stop } = await startServer(scratch.url));
  }, 60_000);
  afterAll(async () => {
    stop?.();
    await scratch?.drop();
  });

  it('promotes and demotes, protects the last active admin, and applies on the next request', async () => {
    const [admin, worker] = (
      await scratch.db<Array<{ id: number }>>`insert into users (email, name, role) values
        ('admin', '관리자', 'admin'), ('w', '실무자', 'worker') returning id`
    ).map((r) => r.id);

    // 실무자는 역할을 바꿀 수 없다. 관리자 전용 화면(배정 목록)도 닫혀 있다.
    expect((await call(`/settings/workers/${admin}/role`, worker, 'PUT', { role: 'worker' })).status).toBe(403);
    expect((await call('/settings/assignments', worker)).status).toBe(403);

    // 올린다 → 다음 요청부터 관리자다.
    expect((await call(`/settings/workers/${worker}/role`, admin, 'PUT', { role: 'admin' })).status).toBe(200);
    expect((await call('/settings/assignments', worker)).status).toBe(200);

    // 다시 내린다 → 바로 닫힌다.
    expect((await call(`/settings/workers/${worker}/role`, admin, 'PUT', { role: 'worker' })).status).toBe(200);
    expect((await call('/settings/assignments', worker)).status).toBe(403);

    // 마지막 활성 관리자는 내려가지도, 나가지도 못한다.
    const demote = await call(`/settings/workers/${admin}/role`, admin, 'PUT', { role: 'worker' });
    expect(demote.status).toBe(409);
    expect((await demote.json()).error).toContain('마지막 관리자');
    expect((await call('/settings/deactivate', admin, 'POST')).status).toBe(409);

    // 둘째 관리자를 세우면 자기 자신을 내릴 수 있다.
    expect((await call(`/settings/workers/${worker}/role`, admin, 'PUT', { role: 'admin' })).status).toBe(200);
    expect((await call(`/settings/workers/${admin}/role`, admin, 'PUT', { role: 'worker' })).status).toBe(200);
    expect((await call('/settings/assignments', admin)).status).toBe(403);

    // 그 뒤 남은 한 관리자(worker)는 또 마지막이다.
    expect((await call(`/settings/workers/${worker}/role`, worker, 'PUT', { role: 'worker' })).status).toBe(409);

    const audits = await scratch.db<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'user.role.update' order by id`;
    expect(audits.map((a) => a.fields)).toEqual([
      [`user=${worker}`, 'role=admin'],
      [`user=${worker}`, 'role=worker'],
      [`user=${worker}`, 'role=admin'],
      [`user=${admin}`, 'role=worker'],
    ]);
  }, 60_000);
});
