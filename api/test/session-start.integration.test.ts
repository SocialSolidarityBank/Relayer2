// 시작이 곧 회차(2026-09-16 Q). 수기 없이도 기록 회차이고, 회차별 요약이 상태를 안다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enabled, fixture, req, silentWav, upload } from './voice-fixture.ts';

beforeEach(() => vi.stubEnv('VOICE_ENABLED', '1'));
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!enabled)('session start', () => {
  it('creates a done session without memo that counts and surfaces written=false with voice state', async () => {
    const { worker, case_id } = await fixture();
    const started = await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { method: 'phone' });
    expect(started.status).toBe(201);
    const { session_id, seq } = await started.json();
    expect(seq).toBe(1);

    // 아직 아무것도 안 적었지만 회차다.
    const record = await (await req(`/sessions/${session_id}`, worker)).json();
    expect(record.status).toBe('done');
    expect(record.memo ?? null).toBeNull();

    const detail = await (await req(`/cases/${case_id}/detail`, worker)).json();
    const mine = detail.sessions.find((s: { id: number }) => s.id === session_id);
    expect(mine.written).toBe(false);
    expect(mine.voice).toEqual({ recordings: 0, transcript: 'none' });
    expect(typeof mine.line).toBe('string');

    // 15초 다시보기도 빈 상담 내용에서 조립된다.
    const briefing = await req(`/cases/${case_id}/briefing`, worker);
    expect(briefing.status).toBe(200);
    expect((await briefing.json()).last_session_summary.session_seq).toBe(1);

    // 녹음이 붙으면 상태가 따라온다. 다시 시작하면 409 — 이미 회차다.
    const rec = await (await upload(session_id, worker, silentWav())).json();
    expect(rec.session_id).toBe(session_id);
    const again = await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { session_id });
    expect(again.status).toBe(409);
    const after = await (await req(`/cases/${case_id}/detail`, worker)).json();
    expect(after.sessions.find((s: { id: number }) => s.id === session_id).voice.recordings).toBe(1);

    // 나중에 수기를 채우면 같은 회차가 written 이 된다.
    expect((await req(`/sessions/${session_id}`, worker, 'PATCH', { memo: '연체 3건.' })).status).toBe(200);
    const filled = await (await req(`/cases/${case_id}/detail`, worker)).json();
    expect(filled.sessions.find((s: { id: number }) => s.id === session_id).written).toBe(true);
  });

  it('turns a planned session into the started one and refuses another case\'s id', async () => {
    const { worker, case_id } = await fixture();
    const other = await fixture();
    const planned = await (await req(`/cases/${case_id}/sessions`, worker, 'POST', {
      scheduled_at: '2026-09-20T01:00:00Z', method: 'phone',
    })).json();
    const started = await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { session_id: planned.session_id });
    expect(started.status).toBe(201);
    expect((await started.json()).session_id).toBe(planned.session_id);
    const record = await (await req(`/sessions/${planned.session_id}`, worker)).json();
    expect(record.status).toBe('done');

    const foreign = await (await req(`/cases/${other.case_id}/sessions`, other.worker, 'POST', {
      scheduled_at: '2026-09-21T01:00:00Z', method: 'phone',
    })).json();
    expect((await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { session_id: foreign.session_id })).status).toBe(404);
  });

  it('keeps memo when a later save omits it and clears it when sent empty', async () => {
    const { worker, case_id } = await fixture();
    const { session_id } = await (await req(`/cases/${case_id}/sessions/start`, worker, 'POST', {})).json();
    await req(`/sessions/${session_id}`, worker, 'PATCH', { memo: '처음 적음.' });
    await req(`/sessions/${session_id}`, worker, 'PATCH', { method: 'phone' });
    expect((await (await req(`/sessions/${session_id}`, worker)).json()).memo).toBe('처음 적음.');
    await req(`/sessions/${session_id}`, worker, 'PATCH', { memo: '  ' });
    const detail = await (await req(`/cases/${case_id}/detail`, worker)).json();
    expect(detail.sessions.find((s: { id: number }) => s.id === session_id).written).toBe(false);
  });
});
