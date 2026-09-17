// OpenAI 키 넣기(2026-09-17 Q). 검증에 실패한 키는 저장하지 않고, 유효한 키는 암호문으로만 남으며,
// 어떤 응답에도 값이 없다. OpenAI 호출은 fetch 스텁이다 — 시험이 밖으로 나가지 않는다.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { decryptPii } from '../src/pii.ts';
import { enabled, req } from './voice-fixture.ts';

const KEY = `sk-test-${randomUUID()}`;

/** OpenAI 모델 목록 호출만 가로챈다. 그 밖의 fetch 는 그대로 둔다. */
const stubOpenAi = (accept: (bearer: string | null) => boolean) => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.openai.com/')) return real(input, init);
    calls.push(url);
    const bearer = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? null;
    return new Response(accept(bearer) ? '{"data":[]}' : '{"error":"invalid_api_key"}', {
      status: accept(bearer) ? 200 : 401,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
};

describe.skipIf(!enabled)('ai key', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await sql`update organization set enc_openai_key = null where id = 1`;
  });

  it('rejects an invalid key without storing, stores a valid key encrypted, exposes only the source, and clears', async () => {
    const prefix = randomUUID();
    const [admin, worker] = (
      await sql<Array<{ id: number }>>`insert into users (email, name, role) values
        (${prefix + '-admin'}, '관리자', 'admin'), (${prefix + '-w'}, '실무자', 'worker') returning id`
    ).map((r) => r.id);
    const calls = stubOpenAi((bearer) => bearer === KEY);

    // 실무자는 403 이고 OpenAI 를 부르지도 않는다.
    expect((await req('/settings/ai-key', worker, 'PUT', { key: KEY })).status).toBe(403);
    expect(calls).toHaveLength(0);

    // 틀린 키 → 400, 저장 없음.
    const bad = await req('/settings/ai-key', admin, 'PUT', { key: 'sk-wrong' });
    expect(bad.status).toBe(400);
    expect(calls).toHaveLength(1);
    const [afterBad] = await sql<Array<{ enc_openai_key: string | null }>>`select enc_openai_key from organization where id = 1`;
    expect(afterBad.enc_openai_key).toBeNull();

    // 맞는 키 → 저장(암호문). 응답에 값은 없다.
    const good = await req('/settings/ai-key', admin, 'PUT', { key: KEY });
    expect(good.status).toBe(200);
    expect(await good.text()).not.toContain(KEY);
    const [stored] = await sql<Array<{ enc_openai_key: string | null }>>`select enc_openai_key from organization where id = 1`;
    expect(stored.enc_openai_key).not.toBeNull();
    expect(stored.enc_openai_key).not.toContain(KEY);
    expect(decryptPii(stored.enc_openai_key)).toBe(KEY);

    const connected = await req('/settings/connections', admin);
    const text = await connected.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).ai).toMatchObject({ connected: true, source: 'db', provider: 'openai' });

    // 감사에는 제공자 이름만.
    const audits = await sql<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'ai.key.set' and actor_id = ${admin} order by id`;
    expect(audits.map((a) => a.fields)).toEqual([['provider=openai']]);
    expect(JSON.stringify(audits)).not.toContain(KEY);

    // 지우기 → env 가 있으면 env, 없으면 null.
    expect((await req('/settings/ai-key', admin, 'PUT', { key: null })).status).toBe(200);
    const [cleared] = await sql<Array<{ enc_openai_key: string | null }>>`select enc_openai_key from organization where id = 1`;
    expect(cleared.enc_openai_key).toBeNull();
    const envBefore = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = 'sk-env';
      expect((await (await req('/settings/connections', admin)).json()).ai).toMatchObject({ connected: true, source: 'env' });
      delete process.env.OPENAI_API_KEY;
      expect((await (await req('/settings/connections', admin)).json()).ai).toMatchObject({ connected: false, source: null });
    } finally {
      if (envBefore === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = envBefore;
    }
    const removed = await sql<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'ai.key.set' and actor_id = ${admin} order by id desc limit 1`;
    expect(removed[0].fields).toEqual(['removed=1']);
  });
});
