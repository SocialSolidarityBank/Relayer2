// 자동 전사(2026-09-16 Q). 업로드는 즉시 끝나고 전사는 뒤에서 돈다. 결과는 녹음 행의 상태다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { failStaleTranscriptions, SPEECH_MAX_BYTES } from '../src/stt.ts';
import { azureFetch, enabled, fixture, req, silentWav, upload, waitTranscribeState } from './voice-fixture.ts';

beforeEach(() => {
  vi.stubEnv('VOICE_ENABLED', '1');
  vi.stubEnv('AZURE_SPEECH_KEY', 'test-key');
  vi.stubEnv('AZURE_SPEECH_REGION', 'koreacentral');
});
afterEach(() => {
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

  it('marks failed on provider error and lets a manual retry finish it', async () => {
    vi.stubGlobal('fetch', azureFetch(null, 500));
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const recording = await (await upload(session_id, worker, silentWav(4000))).json();
    expect(await waitTranscribeState(recording.id)).toBe('failed');
    const [row] = await sql<Array<{ transcribe_note: string | null }>>`
      select transcribe_note from recordings where id = ${recording.id}`;
    expect(row.transcribe_note).toContain('500');

    vi.stubGlobal('fetch', azureFetch('월세 2개월 밀렸다고 말함.'));
    const retry = await req(`/recordings/${recording.id}/transcript`, worker, 'POST', {});
    expect(retry.status).toBe(200);
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
