// 자동 전사(2026-09-16 Q). 업로드는 즉시 끝나고 전사는 뒤에서 돈다. 결과는 녹음 행의 상태다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { encryptPii } from '../src/pii.ts';
import { autoTranscribeLoad, failStaleTranscriptions, SPEECH_MAX_BYTES } from '../src/stt.ts';
import { azureFetch, enabled, fixture, req, silentWav, upload, waitTranscribeState } from './voice-fixture.ts';

beforeEach(() => {
  vi.stubEnv('VOICE_ENABLED', '1');
  vi.stubEnv('AZURE_SPEECH_KEY', 'test-key');
  vi.stubEnv('AZURE_SPEECH_REGION', 'koreacentral');
});
afterEach(async () => {
  await sql`update organization set enc_speech_key = null, voice_enabled = null where id = 1`;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.skipIf(!enabled)('auto transcription', () => {
  it('returns before transcription, then lands a draft and marks the recording done', async () => {
    vi.stubGlobal('fetch', azureFetch('연체 4건입니다.'));
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();

    const saved = await upload(session_id, worker, silentWav());
    expect(saved.status).toBe(201);
    const recording = await saved.json();
    // 응답 시점에는 아직 전사 중이다 — 기다리지 않았다는 증거.
    expect(recording.transcribe_state).toBe('pending');

    expect(await waitTranscribeState(recording.id)).toBe('done');
    const transcript = await (await req(`/sessions/${session_id}/transcript`, worker)).json();
    expect(transcript.status).toBe('draft');
    expect(transcript.text).toBe('연체 4건입니다.');
    const detail = await (await req(`/cases/${case_id}/detail`, worker)).json();
    expect(detail.sessions.find((s: { id: number }) => s.id === session_id).voice).toEqual({
      recordings: 1,
      transcript: 'draft',
    });
  });

  it('uses the decrypted DB Speech key ahead of the env fallback', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'env-speech-key');
    await sql`update organization set enc_speech_key = ${encryptPii('db-speech-key')} where id = 1`;
    let sentKey: string | null = null;
    vi.stubGlobal('fetch', (async (_input: string | URL | Request, init?: RequestInit) => {
      sentKey = new Headers(init?.headers).get('Ocp-Apim-Subscription-Key');
      return new Response(
        JSON.stringify({ combinedPhrases: [{ text: 'DB 키로 전사함.' }], phrases: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();

    const recording = await (await upload(session_id, worker, silentWav(3600))).json();

    expect(await waitTranscribeState(recording.id)).toBe('done');
    expect(sentKey).toBe('db-speech-key');
  });

  it('stores the recording as skipped when no Speech key exists', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', undefined);
    await sql`update organization set enc_speech_key = null where id = 1`;
    let called = 0;
    vi.stubGlobal('fetch', (async () => {
      called += 1;
      return new Response('{}');
    }) as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();

    const recording = await (await upload(session_id, worker, silentWav(3800))).json();

    expect(recording.transcribe_state).toBe('skipped');
    expect(recording.transcribe_note).toContain('전사 제공자 설정 없음');
    expect(called).toBe(0);
  });

  it('marks a pending recording failed when its Speech key is removed before execution', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', undefined);
    await sql`update organization set enc_speech_key = null where id = 1`;
    let called = 0;
    vi.stubGlobal('fetch', (async () => {
      called += 1;
      return new Response('{}');
    }) as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(4400))).json();
    expect(recording.transcribe_state).toBe('skipped');

    await sql`update organization set enc_speech_key = ${encryptPii('soon-removed-key')} where id = 1`;
    await sql`update recordings set transcribe_state = 'pending', transcribe_note = null where id = ${recording.id}`;
    await sql`update organization set enc_speech_key = null where id = 1`;

    expect((await req(`/recordings/${recording.id}/transcript`, worker, 'POST', {})).status).toBe(503);
    const [row] = await sql<Array<{ transcribe_state: string; transcribe_note: string | null }>>`
      select transcribe_state, transcribe_note from recordings where id = ${recording.id}`;
    expect(row.transcribe_state).toBe('failed');
    expect(row.transcribe_note).toContain('전사 제공자 설정 없음');
    expect(called).toBe(0);
  });

  it('never sends more than the concurrency cap to the provider at once, and still finishes every upload', async () => {
    // 제공자 응답을 손으로 풀어 준다 — 시계가 아니라 대기열 상태로 겹침을 잰다.
    const held: Array<() => void> = [];
    vi.stubGlobal('fetch', (() =>
      new Promise<Response>((resolve) => {
        held.push(() =>
          resolve(new Response(JSON.stringify({ combinedPhrases: [{ text: '말함.' }], phrases: [] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          })),
        );
      })) as unknown as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push((await (await upload(session_id, worker, silentWav(6000 + i * 2))).json()).id);
    expect(autoTranscribeLoad()).toEqual({ in_flight: 2, waiting: 4 });

    // 하나씩 풀 때마다 제공자에 나가 있는 요청은 상한을 넘지 않는다.
    let released = 0;
    while (released < 6) {
      expect(held.length - released).toBeLessThanOrEqual(2);
      held[released]();
      released += 1;
      // 다음 대기자가 제공자에 닿을 때까지는 상태 폴링으로 기다린다(고정 sleep 아님).
      await waitTranscribeState(ids[released - 1]);
    }
    for (const id of ids) expect(await waitTranscribeState(id)).toBe('done');
    expect(autoTranscribeLoad()).toEqual({ in_flight: 0, waiting: 0 });
  });

  it('retries 429 with Retry-After and lands the draft once the provider recovers', async () => {
    // 2026-09-17 실측: Korea Central 이 단건 요청에 "Resource Exhausted" 429 를 냈다.
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      if (calls < 3) return new Response('{"code":"TooManyRequests"}', { status: 429, headers: { 'retry-after': '0' } });
      return new Response(JSON.stringify({ combinedPhrases: [{ text: '월세 2개월 밀렸다고 말함.' }], phrases: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(4000))).json();
    expect(await waitTranscribeState(recording.id)).toBe('done');
    expect(calls).toBe(3);
  });

  it('marks failed when retries run out or the error is not retryable, and a manual retry can finish it', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('{"code":"TooManyRequests"}', { status: 429, headers: { 'retry-after': '0' } });
    }) as unknown as typeof fetch);
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(4800))).json();
    expect(await waitTranscribeState(recording.id)).toBe('failed');
    expect(calls).toBe(6); // 첫 시도 + 5번
    const [row] = await sql<Array<{ transcribe_note: string | null }>>`
      select transcribe_note from recordings where id = ${recording.id}`;
    expect(row.transcribe_note).toContain('429');

    // 400 은 다시 보내도 같다 — 한 번만 부른다.
    calls = 0;
    vi.stubGlobal('fetch', (async () => { calls += 1; return new Response('bad', { status: 400 }); }) as unknown as typeof fetch);
    expect((await req(`/recordings/${recording.id}/transcript`, worker, 'POST', {})).status).toBe(503);
    expect(calls).toBe(1);

    vi.stubGlobal('fetch', azureFetch('월세 2개월 밀렸다고 말함.'));
    expect((await req(`/recordings/${recording.id}/transcript`, worker, 'POST', {})).status).toBe(200);
    expect(await waitTranscribeState(recording.id)).toBe('done');
  });

  it('skips without external STT consent and records why', async () => {
    let called = 0;
    vi.stubGlobal('fetch', (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch);
    const { worker, case_id } = await fixture([
      'personal_data_collection_use', 'sensitive_information_processing',
      'counseling_recording', 'voice_original_retention_period',
    ]);
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(4800))).json();
    expect(recording.transcribe_state).toBe('skipped');
    expect(recording.transcribe_note).toContain('동의');
    expect(called).toBe(0);
    const detail = await (await req(`/cases/${case_id}/detail`, worker)).json();
    expect(detail.sessions.find((s: { id: number }) => s.id === session_id).voice.transcript).toBe('skipped');
  });

  it('turns stale pending rows into failed at boot', async () => {
    vi.stubGlobal('fetch', azureFetch('말함.'));
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(5600))).json();
    await waitTranscribeState(recording.id);
    // 프로세스가 죽은 상태를 흉내 낸다: 행만 pending 으로 되돌린다.
    await sql`update recordings set transcribe_state = 'pending' where id = ${recording.id}`;
    expect(await failStaleTranscriptions()).toBeGreaterThanOrEqual(1);
    const [row] = await sql<Array<{ transcribe_state: string }>>`
      select transcribe_state from recordings where id = ${recording.id}`;
    expect(row.transcribe_state).toBe('failed');
  });

  it('accepts a recording between 50MiB and 200MiB', async () => {
    vi.stubGlobal('fetch', azureFetch('긴 상담.'));
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const big = silentWav(51 * 1024 * 1024);
    expect(big.byteLength).toBeGreaterThan(50 * 1024 * 1024);
    expect(big.byteLength).toBeLessThanOrEqual(SPEECH_MAX_BYTES);
    const saved = await upload(session_id, worker, big);
    expect(saved.status).toBe(201);
    const recording = await saved.json();
    expect(recording.bytes).toBe(big.byteLength);
    await waitTranscribeState(recording.id);
  });
});
