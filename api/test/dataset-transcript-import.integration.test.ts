import { describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { enabled, fixture, req, silentWav, upload } from './voice-fixture.ts';

describe.skipIf(!enabled)('curated dataset transcript import', () => {
  it('lets an assigned admin attach an approved masked transcript to an uploaded recording', async () => {
    const { worker, case_id } = await fixture();
    await sql`update users set role = 'admin' where id = ${worker}`;
    const started = await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { method: 'phone' });
    const { session_id } = (await started.json()) as { session_id: number };
    const recording = (await (await upload(session_id, worker, silentWav())).json()) as { id: number };
    const [{ pseudonym }] = await sql<Array<{ pseudonym: string }>>`
      select p.pseudonym from support_cases c join participants p on p.id = c.participant_id where c.id = ${case_id}`;

    const imported = await req(`/sessions/${session_id}/transcript/import`, worker, 'POST', {
      recording_id: recording.id,
      text: '음성 합성은 연체 4건이라고 말했습니다.',
    });

    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({
      recording_id: recording.id,
      session_id,
      status: 'approved',
      text: `[${pseudonym}]은 연체 4건이라고 말했습니다.`,
      engine: 'curated-dataset',
    });
    expect(await (await req(`/sessions/${session_id}/transcript`, worker)).json()).toMatchObject({ status: 'approved' });
  });

  it('rejects transcript import by a non-admin', async () => {
    const { worker, case_id } = await fixture();
    const started = await req(`/cases/${case_id}/sessions/start`, worker, 'POST', { method: 'phone' });
    const { session_id } = (await started.json()) as { session_id: number };
    const recording = (await (await upload(session_id, worker, silentWav())).json()) as { id: number };

    const imported = await req(`/sessions/${session_id}/transcript/import`, worker, 'POST', {
      recording_id: recording.id,
      text: '합성 전사문',
    });

    expect(imported.status).toBe(403);
  });
});
