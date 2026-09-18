// Azure Speech 키는 koreacentral issueToken으로 검증한 뒤 암호문으로만 저장한다.
// 통합 실행은 scripts/check-case-access.mjs가 만든 일회용 localhost DB만 사용한다.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { decryptPii } from '../src/pii.ts';
import { enabled, req } from './voice-fixture.ts';

const KEY = `speech-test-${randomUUID()}`;
const ISSUE_TOKEN = 'https://koreacentral.api.cognitive.microsoft.com/sts/v1.0/issueToken';

const stubSpeech = (accept: (key: string | null) => boolean) => {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url !== ISSUE_TOKEN) return real(input, init);
    const key = new Headers(init?.headers).get('Ocp-Apim-Subscription-Key');
    calls.push({ url, key });
    return new Response(accept(key) ? 'token' : 'invalid subscription key', {
      status: accept(key) ? 200 : 401,
    });
  });
  return calls;
};

describe.skipIf(!enabled)('stt key', () => {
  const envKey = process.env.AZURE_SPEECH_KEY;

  afterEach(async () => {
    vi.restoreAllMocks();
    await sql`update organization set enc_speech_key = null where id = 1`;
    if (envKey === undefined) delete process.env.AZURE_SPEECH_KEY;
    else process.env.AZURE_SPEECH_KEY = envKey;
  });

  it('rejects invalid keys without storage, stores accepted keys encrypted, never exposes them, and clears to env fallback', async () => {
    const prefix = randomUUID();
    const [admin, worker] = (
      await sql<Array<{ id: number }>>`insert into users (email, name, role) values
        (${prefix + '-admin'}, 'STT 관리자', 'admin'), (${prefix + '-worker'}, 'STT 실무자', 'worker') returning id`
    ).map((row) => row.id);
    const calls = stubSpeech((key) => key === KEY);

    expect((await req('/settings/stt-key', worker, 'PUT', { key: KEY })).status).toBe(403);
    expect(calls).toHaveLength(0);

    const bad = await req('/settings/stt-key', admin, 'PUT', { key: 'wrong-region-key' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('wrong-region-key');
    expect(calls).toEqual([{ url: ISSUE_TOKEN, key: 'wrong-region-key' }]);
    const [afterBad] = await sql<Array<{ enc_speech_key: string | null }>>`
      select enc_speech_key from organization where id = 1`;
    expect(afterBad.enc_speech_key).toBeNull();

    const good = await req('/settings/stt-key', admin, 'PUT', { key: KEY });
    expect(good.status).toBe(200);
    expect(await good.text()).not.toContain(KEY);
    const [stored] = await sql<Array<{ enc_speech_key: string | null }>>`
      select enc_speech_key from organization where id = 1`;
    expect(stored.enc_speech_key).not.toBeNull();
    expect(stored.enc_speech_key).not.toContain(KEY);
    expect(decryptPii(stored.enc_speech_key)).toBe(KEY);

    const connections = await req('/settings/connections', admin);
    const connectionText = await connections.text();
    expect(connectionText).not.toContain(KEY);
    expect(JSON.parse(connectionText).stt).toEqual({
      connected: true,
      provider: 'azure',
      region: 'koreacentral',
      source: 'db',
    });

    const audits = await sql<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'stt.key.set' and actor_id = ${admin} order by id`;
    expect(audits.map((row) => row.fields)).toEqual([['provider=azure']]);
    expect(JSON.stringify(audits)).not.toContain(KEY);

    expect((await req('/settings/stt-key', admin, 'PUT', { key: null })).status).toBe(200);
    process.env.AZURE_SPEECH_KEY = 'env-speech-key';
    expect((await (await req('/settings/connections', admin)).json()).stt).toEqual({
      connected: true,
      provider: 'azure',
      region: 'koreacentral',
      source: 'env',
    });
    delete process.env.AZURE_SPEECH_KEY;
    expect((await (await req('/settings/connections', admin)).json()).stt).toEqual({
      connected: false,
      provider: 'azure',
      region: 'koreacentral',
      source: null,
    });
    const [removed] = await sql<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'stt.key.set' and actor_id = ${admin} order by id desc limit 1`;
    expect(removed.fields).toEqual(['removed=1']);
  });
});
