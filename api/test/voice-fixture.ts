// 음성 통합 테스트 공통 재료. 합성 무음 WAV 와 격리 DB 검사 — 실인물 녹음은 쓰지 않는다.
import { randomUUID } from 'node:crypto';
import { DATABASE_URL, sql } from '../src/db.ts';
import { app } from '../src/routes.ts';
import { issueCookie } from '../src/auth.ts';

export const enabled = process.env.RELAYER_INTEGRATION === '1';
if (enabled) {
  const db = new URL(DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || !db.pathname.startsWith('/relayer_shared_check_'))
    throw new Error('Integration tests require an isolated relayer_shared_check_ database on localhost.');
}

export const cookie = (id: number) => issueCookie(id).split(';')[0];
export const req = (path: string, actor: number, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie: cookie(actor), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

/** 진짜 PCM WAV 머리 + 무음. 바이트 수를 정할 수 있다(상한 검사용). */
export function silentWav(dataBytes = 3200): Uint8Array {
  const data = Buffer.alloc(44 + dataBytes);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}

export const upload = (sessionId: number, actor: number, bytes: Uint8Array) =>
  app.request(`/sessions/${sessionId}/recordings`, {
    method: 'POST',
    headers: { cookie: cookie(actor), 'content-type': 'audio/wav' },
    body: bytes as unknown as BodyInit,
  });

export const ALL_VOICE_CONSENTS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'counseling_recording',
  'voice_original_retention_period',
  'external_stt_processing',
] as const;

/** 실무자 하나와 동의를 갖춘 사례 하나. */
export async function fixture(consents: readonly string[] = ALL_VOICE_CONSENTS) {
  const prefix = randomUUID();
  const [worker] = await sql<Array<{ id: number }>>`
    insert into users (email, name, role) values (${prefix + 'w'}, '음성 실무자', 'worker') returning id`;
  const created = await req('/cases', worker.id, 'POST', {
    name: '음성 합성',
    program_name: '음성 검증',
    consents: consents.map((domain) => ({ domain, decision: 'grant' })),
  });
  if (created.status !== 201) throw new Error(`fixture case failed: ${created.status}`);
  const { case_id } = (await created.json()) as { case_id: number };
  return { worker: worker.id, case_id };
}

/** 녹음 행의 전사 상태가 pending 을 벗어날 때까지 기다린다. 자동 전사는 응답 뒤에 돈다. */
export async function waitTranscribeState(recordingId: number, timeoutMs = 5000): Promise<string> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await sql<Array<{ transcribe_state: string }>>`
      select transcribe_state from recordings where id = ${recordingId}`;
    if (row.transcribe_state !== 'pending') return row.transcribe_state;
    if (Date.now() > until) return 'pending';
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Azure Fast Transcription 을 흉내 내는 fetch. 본문은 합성 문장이다. */
export const azureFetch = (text: string | null, status = 200) =>
  (async () =>
    new Response(text === null ? 'error' : JSON.stringify({ combinedPhrases: [{ text }], phrases: [] }), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
