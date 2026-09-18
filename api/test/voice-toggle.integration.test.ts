// 녹음 토글은 Speech 키와 독립이며 DB 값이 env보다 우선한다.
// 이 파일은 자체 일회용 DB와 서버를 사용해 다른 음성 테스트의 기관 단일 행과 충돌하지 않는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueCookie } from '../src/auth.ts';
import { enabled } from './voice-fixture.ts';
import { scratchDb, startServer, type Scratch } from './scratch-db.ts';

const VOICE_DOMAINS = [
  'counseling_recording',
  'external_stt_processing',
  'voice_original_retention_period',
] as const;

let scratch: Scratch;
let base: string;
let stop: () => void;
let admin: number;
let worker: number;

const call = (path: string, actor: number, method = 'GET', body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { cookie: issueCookie(actor).split(';')[0], 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

describe.skipIf(!enabled)('voice toggle', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate();
    const envVoice = process.env.VOICE_ENABLED;
    delete process.env.VOICE_ENABLED;
    try {
      ({ base, stop } = await startServer(scratch.url, { AZURE_SPEECH_KEY: '' }));
    } finally {
      if (envVoice === undefined) delete process.env.VOICE_ENABLED;
      else process.env.VOICE_ENABLED = envVoice;
    }
    [admin, worker] = (
      await scratch.db<Array<{ id: number }>>`insert into users (email, name, role) values
        ('voice-admin', '녹음 관리자', 'admin'), ('voice-worker', '녹음 실무자', 'worker') returning id`
    ).map((row) => row.id);
  }, 60_000);

  afterAll(async () => {
    stop?.();
    await scratch?.drop();
  });

  it('persists an admin-only explicit toggle and reflects it in connections and active consent domains', async () => {
    expect((await call('/settings/voice', worker, 'PUT', { enabled: true })).status).toBe(403);
    expect((await call('/settings/voice', admin, 'PUT', { enabled: true })).status).toBe(200);

    const onConnections = await (await call('/settings/connections', admin)).json();
    expect(onConnections.voice).toEqual({ enabled: true, source: 'db' });
    const shown = await (await call('/consent-copy', admin)).json();
    expect(shown.map((copy: { domain: string }) => copy.domain)).toEqual(expect.arrayContaining([...VOICE_DOMAINS]));

    expect((await call('/settings/voice', admin, 'PUT', { enabled: false })).status).toBe(200);
    const hidden = await (await call('/consent-copy', admin)).json();
    for (const domain of VOICE_DOMAINS) {
      expect(hidden.map((copy: { domain: string }) => copy.domain)).not.toContain(domain);
    }

    const audits = await scratch.db<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'voice.toggle' and actor_id = ${admin} order by id`;
    expect(audits.map((row) => row.fields)).toEqual([['enabled=1'], ['enabled=0']]);
  });

  it('uses env only while the DB toggle is null', async () => {
    await scratch.db`update organization set voice_enabled = null where id = 1`;
    expect((await (await call('/settings/connections', admin)).json()).voice).toEqual({
      enabled: false,
      source: null,
    });

    stop();
    ({ base, stop } = await startServer(scratch.url, { VOICE_ENABLED: '1', AZURE_SPEECH_KEY: '' }));
    expect((await (await call('/settings/connections', admin)).json()).voice).toEqual({
      enabled: true,
      source: 'env',
    });

    await scratch.db`update organization set voice_enabled = false where id = 1`;
    expect((await (await call('/settings/connections', admin)).json()).voice).toEqual({
      enabled: false,
      source: 'db',
    });
  }, 60_000);
});
