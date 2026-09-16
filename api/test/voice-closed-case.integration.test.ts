// 종결 사례(2026-09-16 Q). 새 녹음·전사·시작은 409, 이미 있는 것의 재생·열람은 그대로.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { encryptText } from '../src/pii.ts';
import { enabled, fixture, req, silentWav, upload } from './voice-fixture.ts';

beforeEach(() => {
  vi.stubEnv('VOICE_ENABLED', '1');
  vi.stubEnv('AZURE_SPEECH_KEY', 'test-key');
  vi.stubEnv('AZURE_SPEECH_REGION', 'koreacentral');
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!enabled)('closed case voice boundary', () => {
  it('rejects new recordings, transcription and start with 409 but keeps playback and transcript reads', async () => {
    const { worker, case_id } = await fixture([
      'personal_data_collection_use', 'sensitive_information_processing',
      'counseling_recording', 'voice_original_retention_period',
    ]);
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    const rec = await (await upload(session_id, worker, silentWav())).json();
    await sql`insert into transcripts (recording_id, session_id, status, text, mask_hits, engine, created_by)
      values (${rec.id}, ${session_id}, 'draft', ${encryptText('말함.')}, '{}', 'test-fixture', ${worker})`;

    expect((await req(`/cases/${case_id}/close`, worker, 'POST', { close_reason: '목표 달성' })).status).toBe(200);

    expect((await upload(session_id, worker, silentWav(4000))).status).toBe(409);
    expect((await req(`/recordings/${rec.id}/transcript`, worker, 'POST', {})).status).toBe(409);
    expect((await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).status).toBe(409);

    expect((await req(`/recordings/${rec.id}/audio`, worker)).status).toBe(200);
    expect((await (await req(`/sessions/${session_id}/transcript`, worker)).json()).text).toBe('말함.');
    const [row] = await sql<Array<{ transcribe_state: string }>>`select transcribe_state from recordings where id = ${rec.id}`;
    // 종결 전 상태가 그대로다 — 거절된 전사 요청이 상태를 건드리지 않는다.
    expect(row.transcribe_state).toBe('skipped');
  });
});
