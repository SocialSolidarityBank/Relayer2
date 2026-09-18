// 동의 철회(2026-09-16 Q). 녹음·보유기간 동의를 거두면 **그 사례**의 음성 원본이 바로 사라진다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/db.ts';
import { encryptText } from '../src/pii.ts';
import { getStorage, StorageObjectNotFound } from '../src/storage.ts';
import { enabled, fixture, req, silentWav, upload } from './voice-fixture.ts';

beforeEach(() => vi.stubEnv('VOICE_ENABLED', '1'));
afterEach(() => vi.unstubAllEnvs());


describe.skipIf(!enabled)('recording consent withdrawal', () => {
  it('deletes only that case\'s audio, keeps the transcript and other cases, and audits voice.withdraw', async () => {
    const mine = await fixture();
    const other = await fixture();
    const s1 = (await (await req(`/cases/${mine.case_id}/sessions/start`, mine.worker, 'POST', {})).json()).session_id;
    const s2 = (await (await req(`/cases/${other.case_id}/sessions/start`, other.worker, 'POST', {})).json()).session_id;
    const r1 = await (await upload(s1, mine.worker, silentWav())).json();
    const r2 = await (await upload(s2, other.worker, silentWav(4000))).json();
    const [{ rel_path: p1 }] = await sql<Array<{ rel_path: string }>>`
      select rel_path from recordings where id = ${r1.id}`;
    const [{ rel_path: p2 }] = await sql<Array<{ rel_path: string }>>`
      select rel_path from recordings where id = ${r2.id}`;
    await sql`insert into transcripts (recording_id, session_id, status, text, mask_hits, engine, created_by)
      values (${r1.id}, ${s1}, 'draft', ${encryptText('연체 4건.')}, '{}', 'test-fixture', ${mine.worker})`;

    const withdrawn = await req(`/cases/${mine.case_id}/consents`, mine.worker, 'POST', {
      domain: 'counseling_recording', decision: 'withdraw',
    });
    expect(withdrawn.status).toBe(200);

    const [row] = await sql<Array<{ deleted_at: string | null }>>`select deleted_at from recordings where id = ${r1.id}`;
    expect(row.deleted_at).not.toBeNull();
    const storage = getStorage();
    await expect(storage.open('voice', p1)).rejects.toBeInstanceOf(StorageObjectNotFound);
    const remaining = await storage.open('voice', p2);
    remaining.body.destroy();
    expect((await req(`/recordings/${r1.id}/audio`, mine.worker)).status).toBe(400);
    expect((await req(`/recordings/${r2.id}/audio`, other.worker)).status).toBe(200);
    const transcript = await (await req(`/sessions/${s1}/transcript`, mine.worker)).json();
    expect(transcript.text).toBe('연체 4건.');
    const [audit] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from audit_log where action = 'voice.withdraw' and case_id = ${mine.case_id}`;
    expect(audit.n).toBe(1);
  });
});
