// 음성 경로(P4). 순서가 곧 규칙이다.
//
//   녹음 동의 → 녹음 저장 → STT 동의 → 외부 전사 → 가림 → 초안 → 사람이 확인해야 기록
//
// 음성 원본은 **기관 안에만** 둔다. 밖으로 나가는 것은 STT 호출 한 번뿐이고 그것도 동의가 있어야 한다.
// 전사문은 회차 기록의 후보이지 기록이 아니다 — 승인 게이트는 AI 초안과 같다.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertConsent } from './service.ts';
import { audit } from './audit.ts';
import {
  CONSENT_COPY,
  RETENTION_DAYS,
  sttEnabled,
  STT_PROVIDERS,
  voiceEnabled,
  type SttProviderId,
} from './consent.ts';
import { sql } from './db.ts';
import { maskAll } from './domain/masking.ts';
import { decryptPii, decryptText, encryptText } from './pii.ts';
import type { Session } from './domain/types.ts';

/** 정본이 `azure` 로 못박았다. 다른 곳으로 음성을 보내려면 정본을 먼저 고친다. */
const PROVIDER = (process.env.STT_PROVIDER ?? 'azure') as SttProviderId;
const REGION = process.env.AZURE_SPEECH_REGION ?? 'koreacentral';

/** 음성이 사는 곳. 기관 디스크다. 백업 스크립트는 여기를 건드리지 않는다. */
const VOICE_ROOT = resolve(process.env.VOICE_ROOT ?? './voice');



export class SttUnavailable extends Error {}

export type Recording = {
  id: number;
  session_id: number;
  bytes: number;
  duration_ms: number | null;
  delete_after: string;
  deleted_at: string | null;
  created_at: string;
};

export type Transcript = {
  id: number;
  recording_id: number;
  session_id: number;
  status: 'draft' | 'approved';
  text: string;
  mask_hits: Record<string, number>;
  engine: string | null;
  created_at: string;
};

/**
 * 녹음을 받아 기관 디스크에 둔다. 동의(상담 녹음 + 음성 원본 보유기간)가 없으면 받지 않는다.
 * 지울 날짜를 **처음부터 박는다** — 나중에 세겠다고 미루면 기한이 와도 아무도 모른다.
 */
export async function saveRecording(
  sessionId: number,
  audio: Uint8Array,
  actorId: number,
  durationMs?: number,
): Promise<Recording> {
  if (!voiceEnabled()) throw new SttUnavailable('녹음 기능이 꺼져 있어요.');
  if (audio.byteLength === 0) throw new SttUnavailable('빈 파일이에요.');

  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차를 찾지 못했어요.');

  await assertConsent(session.case_id, 'counseling_recording');
  await assertConsent(session.case_id, 'voice_original_retention_period');

  const days = RETENTION_DAYS[CONSENT_COPY.voice_original_retention_period.retentionDuration ?? ''];
  if (!days) throw new Error('보유기간 문구를 해석하지 못했어요.');

  const sha256 = createHash('sha256').update(audio).digest('hex');
  // 사례별로 나눠 둔다. 사례를 통째로 지울 때 폴더 하나만 지우면 된다.
  const relPath = join(String(session.case_id), `${sessionId}-${sha256.slice(0, 12)}.audio`);
  const full = join(VOICE_ROOT, relPath);
  await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, audio, { mode: 0o600 });

  const deleteAfter = new Date(Date.now() + days * 86_400_000).toISOString();
  const [row] = await sql<Recording[]>`
    insert into recordings (session_id, rel_path, bytes, sha256, duration_ms, delete_after, created_by)
    values (${sessionId}, ${relPath}, ${audio.byteLength}, ${sha256},
            ${durationMs ?? null}, ${deleteAfter}, ${actorId})
    returning id, session_id, bytes, duration_ms, delete_after, deleted_at, created_at`;

  // 언제 받아서 언제까지 두는지를 남긴다. 음성 자체는 감사에 담지 않는다.
  await audit({
    actorId,
    action: 'voice.record',
    caseId: session.case_id,
    fields: [`bytes=${audio.byteLength}`, `retention=${days}일`, `delete_after=${deleteAfter.slice(0, 10)}`],
  });

  return row;
}

type AzureResult = { DisplayText?: string; RecognitionStatus?: string };

/** 외부 전사. 실패하면 **정확히 실패한다** — 없는 것을 있는 것처럼 답하지 않는다. */
async function transcribeAudio(audio: Uint8Array): Promise<string> {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key) throw new SttUnavailable('AZURE_SPEECH_KEY 가 없어 전사를 할 수 없어요.');

  const url =
    `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    '?language=ko-KR&profanity=raw';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
    },
    body: audio,
  });

  if (!res.ok) throw new SttUnavailable(`전사가 되지 않았어요 (${res.status}).`);
  const payload = (await res.json()) as AzureResult;
  if (payload.RecognitionStatus && payload.RecognitionStatus !== 'Success') {
    throw new SttUnavailable(`전사가 되지 않았어요 (${payload.RecognitionStatus}).`);
  }
  const text = payload.DisplayText?.trim();
  if (!text) throw new SttUnavailable('전사 결과가 비어 있어요.');
  return text;
}

/**
 * 전사 초안을 만든다. 보내기 전에 가린다 — 음성에도 이름과 번호가 들어 있다.
 * 다만 **음성 자체는 가릴 수 없다.** 그래서 외부 STT 동의를 따로 받는다.
 */
export async function draftTranscript(recordingId: number, actorId: number): Promise<Transcript> {
  if (!sttEnabled()) throw new SttUnavailable('전사 기능이 꺼져 있어요.');

  const [rec] = await sql<Array<{ id: number; session_id: number; rel_path: string; deleted_at: string | null }>>`
    select id, session_id, rel_path, deleted_at from recordings where id = ${recordingId}`;
  if (!rec) throw new Error('녹음을 찾지 못했어요.');
  if (rec.deleted_at) throw new SttUnavailable('보유기간이 지나 지운 녹음이에요.');

  const [session] = await sql<Session[]>`select * from sessions where id = ${rec.session_id}`;
  await assertConsent(session.case_id, 'external_stt_processing');

  const audio = new Uint8Array(await readFile(join(VOICE_ROOT, rec.rel_path)));

  const raw = await transcribeAudio(audio);

  // 전사문에도 이름·번호가 그대로 나온다. 저장 전에 가린다.
  const [participant] = await sql<Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${session.case_id}`;

  const { parts, hits } = maskAll([{ label: '전사', text: raw }], {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
  });

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into transcripts (recording_id, session_id, status, text, mask_hits, engine, created_by)
    values (${recordingId}, ${rec.session_id}, 'draft', ${encryptText(parts[0].text)},
            ${sql.json(hits)}, ${PROVIDER}, ${actorId})
    returning id, created_at`;

  await audit({
    actorId,
    action: 'voice.transcribe',
    caseId: session.case_id,
    fields: [
      `recipient=${STT_PROVIDERS[PROVIDER].legalRecipient}`,
      `country=${STT_PROVIDERS[PROVIDER].country}`,
      ...Object.entries(hits).map(([kind, n]) => `masked:${kind}=${n}`),
    ],
  });

  return {
    id: row.id,
    recording_id: recordingId,
    session_id: rec.session_id,
    status: 'draft',
    text: parts[0].text,
    mask_hits: hits,
    engine: PROVIDER,
    created_at: row.created_at,
  };
}

/** 회차의 현재 전사문. 마지막 행이 현재 상태다(AI 초안과 같은 규칙). */
export async function latestTranscript(sessionId: number): Promise<Transcript | null> {
  const [row] = await sql<Array<Transcript & { text: string }>>`
    select id, recording_id, session_id, status, text, mask_hits, engine, created_at
    from transcripts where session_id = ${sessionId} order by id desc limit 1`;
  return row ? { ...row, text: decryptText(row.text) ?? '' } : null;
}

/**
 * 승인. 사람이 고친 문구가 있으면 그것으로 승인한다.
 * 지우지 않고 새 행을 쌓는다 — 무엇을 보고 승인했는지가 남아야 한다.
 */
export async function approveTranscript(
  sessionId: number,
  actorId: number,
  editedText?: string,
): Promise<Transcript> {
  const current = await latestTranscript(sessionId);
  if (!current) throw new Error('승인할 전사문이 없어요.');

  const text = editedText ?? current.text;
  const [session] = await sql<Session[]>`select case_id from sessions where id = ${sessionId}`;

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into transcripts (recording_id, session_id, status, text, mask_hits, engine, created_by, approved_by)
    values (${current.recording_id}, ${sessionId}, 'approved', ${encryptText(text)},
            ${sql.json(current.mask_hits)}, ${current.engine}, ${actorId}, ${actorId})
    returning id, created_at`;

  await audit({
    actorId,
    action: 'voice.approve',
    caseId: session?.case_id,
    fields: [`transcript=${current.id}`, editedText ? 'edited=yes' : 'edited=no'],
  });

  return { ...current, id: row.id, status: 'approved', text, created_at: row.created_at };
}

/**
 * 보유기간이 지난 음성을 지운다. 파일을 지우고 행은 남긴다 —
 * "있었는데 지웠다"와 "처음부터 없었다"는 다른 사실이다.
 */
export async function sweepExpiredRecordings(): Promise<{ deleted: number; missing: number }> {
  const due = await sql<Array<{ id: number; rel_path: string; session_id: number }>>`
    select id, rel_path, session_id from recordings
    where deleted_at is null and delete_after <= now()`;

  let deleted = 0;
  let missing = 0;
  for (const rec of due) {
    const full = join(VOICE_ROOT, rec.rel_path);
    try {
      await stat(full);
      await rm(full, { force: true });
      deleted += 1;
    } catch {
      // 이미 없는 파일도 지운 것으로 표시한다. 없는 것을 계속 붙들고 있을 이유가 없다.
      missing += 1;
    }
    await sql`update recordings set deleted_at = now() where id = ${rec.id}`;
  }
  if (due.length > 0) {
    await audit({ action: 'voice.sweep', fields: [`deleted=${deleted}`, `missing=${missing}`] });
  }
  return { deleted, missing };
}
