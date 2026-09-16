// 음성 경로(P4). 순서가 곧 규칙이다.
//
//   녹음 동의 → 녹음 저장 → STT 동의 → 외부 전사 → 가림 → 초안 → 사람이 확인해야 기록
//
// 음성 원본은 **기관 안에만** 둔다. 밖으로 나가는 것은 STT 호출 한 번뿐이고 그것도 동의가 있어야 한다.
// 전사문은 회차 기록의 후보이지 기록이 아니다 — 승인 게이트는 AI 초안과 같다.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { assertCaseAccess, caseIdOfRecording, caseIdOfSession, NotFound } from './access.ts';
import { assertConsent } from './service.ts';
import { audit } from './audit.ts';
import {
  CONSENT_COPY,
  RETENTION_DAYS,
  sttEnabled,
  STT_PROVIDERS,
  voiceEnabled,
} from './consent.ts';
import { sql } from './db.ts';
import { maskAll } from './domain/masking.ts';
import { decryptPii, decryptText, encryptText } from './pii.ts';
import type { Session } from './domain/types.ts';

/** 정본이 `azure` 로 못박았다. 다른 곳으로 음성을 보내려면 정본을 먼저 고친다. */
const PROVIDER = 'azure' as const;

/** 음성이 사는 곳. 기관 디스크다. 백업 스크립트는 여기를 건드리지 않는다. */
const VOICE_ROOT = resolve(process.env.VOICE_ROOT ?? './voice');

/** 한 번에 받는 음성의 상한. 라우트의 본문 제한과 같은 값이다. */
export const SPEECH_MAX_BYTES = 50 * 1024 * 1024;

/** 받는 음성 형식. 파일 머리(매직)로 확인한다 — 보낸 쪽이 적은 형식은 믿지 않는다. */
export const SPEECH_FORMATS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'] as const;
type SpeechFormat = (typeof SPEECH_FORMATS)[number];

const FORMAT_INFO: Record<SpeechFormat, { mime: string; ext: string }> = {
  wav: { mime: 'audio/wav', ext: 'wav' },
  mp3: { mime: 'audio/mpeg', ext: 'mp3' },
  m4a: { mime: 'audio/mp4', ext: 'm4a' },
  flac: { mime: 'audio/flac', ext: 'flac' },
  ogg: { mime: 'audio/ogg', ext: 'ogg' },
  webm: { mime: 'audio/webm', ext: 'webm' },
};

// Content-Type 은 별명이 많다. 전부 같은 형식으로 접어서 본다.
const MIME_TO_FORMAT: Record<string, SpeechFormat> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/x-mpeg': 'mp3',
  'audio/mpeg3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/webm': 'webm',
};

export class SttUnavailable extends Error {}

/** 받지 않는 파일·깨진 요청은 보낸 쪽 잘못이다(400). 서버 고장(503)과 구분한다. */
export class RecordingRejected extends Error {}

export type Recording = {
  id: number;
  session_id: number;
  content_type: string;
  bytes: number;
  duration_ms: number | null;
  delete_after: string;
  deleted_at: string | null;
  created_at: string;
};

export type TranscriptSegment = { text: string; offset_ms: number; duration_ms: number };

export type Transcript = {
  id: number;
  recording_id: number;
  session_id: number;
  status: 'draft' | 'approved';
  text: string;
  /** 전사 근거 조각. 재생 위치를 찾는 데 쓴다. */
  segments?: TranscriptSegment[];
  mask_hits: Record<string, number>;
  engine: string | null;
  created_at: string;
};

/** 음성 기능이 지금 어디까지 되는가. 키 같은 비밀은 담지 않는다 — 로그인만 하면 볼 수 있다. */
export function speechStatus(): {
  enabled: boolean;
  transcription_ready: boolean;
  max_bytes: number;
  formats: string[];
} {
  return {
    enabled: voiceEnabled(),
    transcription_ready: sttEnabled(),
    max_bytes: SPEECH_MAX_BYTES,
    formats: [...SPEECH_FORMATS],
  };
}

const hasBytes = (b: Uint8Array, sig: number[], off = 0): boolean =>
  b.length >= off + sig.length && sig.every((v, i) => b[off + i] === v);

/** 파일 머리로 형식을 읽는다. 모르는 머리면 null 이다. */
function magicFormat(b: Uint8Array): SpeechFormat | null {
  if (hasBytes(b, [0x52, 0x49, 0x46, 0x46]) && hasBytes(b, [0x57, 0x41, 0x56, 0x45], 8)) return 'wav';
  if (hasBytes(b, [0x66, 0x4c, 0x61, 0x43])) return 'flac';
  if (hasBytes(b, [0x4f, 0x67, 0x67, 0x53])) return 'ogg';
  if (hasBytes(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (hasBytes(b, [0x66, 0x74, 0x79, 0x70], 4)) return 'm4a';
  if (hasBytes(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

/**
 * 형식을 확정한다. 파일 머리와 Content-Type 이 **둘 다** 같은 형식이어야 한다.
 * 보낸 쪽 표기만 믿지도 않고, 형식을 생략한 임의 바이트를 음성으로 취급하지도 않는다.
 */
function detectFormat(audio: Uint8Array, declared?: string): SpeechFormat | null {
  const magic = magicFormat(audio);
  if (!magic) return null;
  const d = (declared ?? '').split(';')[0].trim().toLowerCase();
  const fromMime = MIME_TO_FORMAT[d];
  return fromMime === magic ? magic : null;
}


/**
 * 녹음을 받아 기관 디스크에 둔다. 동의(상담 녹음 + 음성 원본 보유기간)가 없으면 받지 않는다.
 * 지울 날짜를 **처음부터 박는다** — 나중에 세겠다고 미루면 기한이 와도 아무도 모른다.
 */
export async function saveRecording(
  sessionId: number,
  audio: Uint8Array,
  actorId: number,
  opts?: { durationMs?: number; contentType?: string },
): Promise<Recording> {
  if (!voiceEnabled()) throw new SttUnavailable('녹음 기능이 꺼져 있어요.');
  if (audio.byteLength === 0) throw new RecordingRejected('빈 파일이에요.');
  if (audio.byteLength > SPEECH_MAX_BYTES) {
    throw new RecordingRejected(
      `파일이 너무 커요. ${Math.floor(SPEECH_MAX_BYTES / 1024 / 1024)}MB 까지 받아요.`,
    );
  }
  const format = detectFormat(audio, opts?.contentType);
  if (!format) {
    throw new RecordingRejected(
      `알 수 없는 음성 형식이에요. ${SPEECH_FORMATS.join('·')} 파일만 받아요.`,
    );
  }
  const durationMs = opts?.durationMs;
  if (
    durationMs !== undefined &&
    (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 2_147_483_647)
  ) {
    throw new RecordingRejected('녹음 길이가 올바르지 않아요.');
  }

  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new NotFound('회차를 찾지 못했어요.');
  // 배정되지 않은 실무자는 동의 문구가 뭐든 받지 않는다. 확인은 부수 효과보다 먼저다.
  await assertCaseAccess(session.case_id, actorId);

  await assertConsent(session.case_id, 'counseling_recording');
  await assertConsent(session.case_id, 'voice_original_retention_period');

  const days = RETENTION_DAYS[CONSENT_COPY.voice_original_retention_period.retentionDuration ?? ''];
  if (!days) throw new Error('보유기간 문구를 해석하지 못했어요.');

  const sha256 = createHash('sha256').update(audio).digest('hex');
  // 같은 회차에 같은 파일을 두 번 올리면 새 물건이 아니다 — 있는 행을 돌려준다.
  const [dup] = await sql<Recording[]>`
    select id, session_id, content_type, bytes, duration_ms, delete_after, deleted_at, created_at
    from recordings
    where session_id = ${sessionId} and sha256 = ${sha256} and deleted_at is null`;
  if (dup) {
    await assertCaseAccess(session.case_id, actorId);
    return dup;
  }

  // 사례별로 나눠 둔다. 사례를 통째로 지울 때 폴더 하나만 지우면 된다.
  // 파일명은 우리가 만든다 — 보낸 쪽 파일명은 그 자체로 정보가 샌다.
  const relPath = join(String(session.case_id), `${sessionId}-${randomUUID()}.${format}`);
  const full = join(VOICE_ROOT, relPath);
  await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, audio, { mode: 0o600, flag: 'wx' });

  const deleteAfter = new Date(Date.now() + days * 86_400_000).toISOString();
  let row: Recording;
  try {
    [row] = await sql<Recording[]>`
      insert into recordings (session_id, rel_path, bytes, sha256, content_type, duration_ms, delete_after, created_by)
      values (${sessionId}, ${relPath}, ${audio.byteLength}, ${sha256},
              ${FORMAT_INFO[format].mime}, ${durationMs ?? null}, ${deleteAfter}, ${actorId})
      returning id, session_id, content_type, bytes, duration_ms, delete_after, deleted_at, created_at`;
  } catch (err) {
    // 행이 없는 파일은 아무도 지우지 않는다. 쓰고 실패했으면 바로 치운다.
    await rm(full, { force: true });
    throw err;
  }

  // 언제 받아서 언제까지 두는지를 남긴다. 음성 자체는 감사에 담지 않는다.
  await audit({
    actorId,
    action: 'voice.record',
    caseId: session.case_id,
    fields: [
      `bytes=${audio.byteLength}`,
      `type=${FORMAT_INFO[format].mime}`,
      `retention=${days}일`,
      `delete_after=${deleteAfter.slice(0, 10)}`,
    ],
  });
  await assertCaseAccess(session.case_id, actorId);

  return row;
}

/** 회차의 녹음 목록. 지운 것도 낸다 — 있었다는 사실이 기록이다. */
export async function listRecordings(sessionId: number, actorId: number): Promise<Recording[]> {
  const caseId = await caseIdOfSession(sessionId);
  if (caseId === null) throw new NotFound('회차를 찾지 못했어요.');
  await assertCaseAccess(caseId, actorId);
  const rows = await sql<Recording[]>`
    select id, session_id, content_type, bytes, duration_ms, delete_after, deleted_at, created_at
    from recordings where session_id = ${sessionId} order by id desc`;
  await assertCaseAccess(caseId, actorId);
  return rows;
}

/**
 * 재생용 원본. **열 때마다 배정을 다시 확인한다** — 어제 배정됐다는 사실이 오늘의 권한이 아니다.
 * 공개 URL 은 만들지 않는다. 바이트는 이 길로만 나간다.
 */
export async function readRecordingAudio(
  recordingId: number,
  actorId: number,
): Promise<{ recording: Recording; bytes: Uint8Array; content_type: string }> {
  const caseId = await caseIdOfRecording(recordingId);
  if (caseId === null) throw new NotFound('녹음을 찾지 못했어요.');
  await assertCaseAccess(caseId, actorId);

  const [rec] = await sql<Array<Recording & { rel_path: string }>>`
    select id, session_id, content_type, bytes, duration_ms, delete_after, deleted_at, created_at, rel_path
    from recordings where id = ${recordingId}`;
  if (!rec) throw new NotFound('녹음을 찾지 못했어요.');
  if (rec.deleted_at) throw new RecordingRejected('보유기간이 지나 지운 녹음이에요.');
  const full = join(VOICE_ROOT, rec.rel_path);
  const info = await stat(full);
  if (info.size > SPEECH_MAX_BYTES) {
    throw new RecordingRejected('허용 크기를 넘은 녹음은 열 수 없어요.');
  }
  const bytes = await readFile(full);
  const format = detectFormat(bytes, rec.content_type);
  if (!format) throw new RecordingRejected('녹음 파일 형식이 저장 정보와 맞지 않아요.');
  await audit({ actorId, action: 'voice.read', caseId, fields: [`recording=${recordingId}`] });
  // 파일을 읽는 사이 배정이 빠졌다면 바이트를 내보내지 않는다.
  await assertCaseAccess(caseId, actorId);
  return { recording: rec, bytes, content_type: FORMAT_INFO[format].mime };
}

const AzureResultSchema = z.object({
  combinedPhrases: z.array(z.object({ text: z.string().optional() })).optional(),
  phrases: z
    .array(
      z.object({
        text: z.string().optional(),
        offsetMilliseconds: z.number().optional(),
        durationMilliseconds: z.number().optional(),
      }),
    )
    .optional(),
});

/**
 * 외부 전사(Azure Fast Transcription). 실패하면 **정확히 실패한다** —
 * 없는 것을 있는 것처럼 답하지 않고, 제공자가 준 오류 문구를 그대로 밖에 내지 않는다
 * (응답 본문에 엔드포인트·키 조각이 섞여 있을 수 있다).
 */
async function transcribeAudio(
  audio: Uint8Array,
  format: SpeechFormat,
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const configuredEndpoint = process.env.AZURE_SPEECH_ENDPOINT?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  if (!key || (!configuredEndpoint && !region)) {
    throw new SttUnavailable('전사 제공자 설정이 없어 전사를 할 수 없어요.');
  }

  // 정본 제공자는 azure 다. 엔드포인트는 환경이 주면 그것을, 아니면 문서의 지역 엔드포인트를 쓴다.
  // 구독 키가 평문으로 나가지 않도록 HTTPS 아닌 주소는 요청 전에 막는다.
  if (!configuredEndpoint && !/^[a-z0-9-]+$/.test(region ?? '')) {
    throw new SttUnavailable('전사 제공자 지역 설정이 올바르지 않아요.');
  }
  let url: string;
  try {
    const endpoint = new URL(
      configuredEndpoint || `https://${region}.api.cognitive.microsoft.com`,
    );
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/speechtotext/transcriptions:transcribe`;
    endpoint.search = 'api-version=2025-10-15';
    endpoint.hash = '';
    url = endpoint.toString();
  } catch {
    throw new SttUnavailable('전사 제공자 주소 설정이 올바르지 않아요.');
  }

  const form = new FormData();
  form.append(
    'audio',
    new Blob([audio], { type: FORMAT_INFO[format].mime }),
    `audio.${FORMAT_INFO[format].ext}`,
  );
  form.append('definition', JSON.stringify({ locales: ['ko-KR'], profanityFilterMode: 'None' }));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new SttUnavailable('전사 제공자에 연결하지 못했어요.');
  }

  if (!res.ok) throw new SttUnavailable(`전사가 되지 않았어요 (${res.status}).`);
  const parsed = AzureResultSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new SttUnavailable('전사 응답을 읽지 못했어요.');
  const payload = parsed.data;

  const text = (
    (payload.combinedPhrases ?? []).map((p) => p.text?.trim() ?? '').filter(Boolean).join(' ') ||
    (payload.phrases ?? []).map((p) => p.text?.trim() ?? '').filter(Boolean).join(' ')
  ).trim();
  if (!text) throw new SttUnavailable('전사 결과가 비어 있어요.');

  const segments = (payload.phrases ?? [])
    .filter((p) => p.text && Number.isFinite(p.offsetMilliseconds))
    .map((p) => ({
      text: p.text ?? '',
      offset_ms: Math.max(0, Math.round(p.offsetMilliseconds ?? 0)),
      duration_ms: Math.max(0, Math.round(p.durationMilliseconds ?? 0)),
    }));

  return { text, segments };
}

/**
 * 전사 초안을 만든다. 보내기 전에 가린다 — 음성에도 이름과 번호가 들어 있다.
 * 다만 **음성 자체는 가릴 수 없다.** 그래서 외부 STT 동의를 따로 받는다.
 */
export async function draftTranscript(recordingId: number, actorId: number): Promise<Transcript> {
  if (!voiceEnabled()) throw new SttUnavailable('전사 기능이 꺼져 있어요.');
  if (!sttEnabled()) throw new SttUnavailable('전사 제공자 설정이 없어 전사를 할 수 없어요.');

  const [rec] = await sql<
    Array<{ id: number; session_id: number; rel_path: string; content_type: string; deleted_at: string | null }>
  >`select id, session_id, rel_path, content_type, deleted_at from recordings where id = ${recordingId}`;
  if (!rec) throw new NotFound('녹음을 찾지 못했어요.');
  if (rec.deleted_at) throw new RecordingRejected('보유기간이 지나 지운 녹음이에요.');

  const [session] = await sql<Session[]>`select * from sessions where id = ${rec.session_id}`;
  if (!session) throw new NotFound('회차를 찾지 못했어요.');
  // 외부로 나가기 직전에 배정을 다시 본다 — 파일을 읽고 나서 알면 늦는다.
  await assertCaseAccess(session.case_id, actorId);
  await assertConsent(session.case_id, 'external_stt_processing');

  const full = join(VOICE_ROOT, rec.rel_path);
  const info = await stat(full);
  if (info.size > SPEECH_MAX_BYTES) {
    throw new RecordingRejected('허용 크기를 넘은 녹음은 전사할 수 없어요.');
  }
  const audio = await readFile(full);
  const format = detectFormat(audio, rec.content_type);
  if (!format) throw new RecordingRejected('알 수 없는 음성 형식이라 전사할 수 없어요.');
  // 파일을 읽는 사이 권한·동의가 바뀔 수 있다. 외부 전송 바로 앞에서 다시 확인한다.
  await assertCaseAccess(session.case_id, actorId);
  await assertConsent(session.case_id, 'external_stt_processing');

  const { text: raw, segments } = await transcribeAudio(audio, format);
  // 긴 외부 호출 사이 배정이 빠졌다면 결과를 저장하지 않는다.
  await assertCaseAccess(session.case_id, actorId);

  // 전사문에도 이름·번호가 그대로 나온다. 저장 전에 가린다 — 본문과 근거 조각 둘 다.
  const [participant] = await sql<
    Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>
  >`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${session.case_id}`;

  const subject = {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
  };
  const { parts, hits } = maskAll([{ label: '전사', text: raw }], subject);
  const maskedSegmentParts = maskAll(
    segments.map((s) => ({ label: '조각', text: s.text })),
    subject,
  ).parts;
  const maskedSegments = segments.map((s, i) => ({ ...s, text: maskedSegmentParts[i].text }));

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into transcripts (recording_id, session_id, status, text, segments, mask_hits, engine, created_by)
    values (${recordingId}, ${rec.session_id}, 'draft', ${encryptText(parts[0].text)},
            ${encryptText(JSON.stringify(maskedSegments))}, ${sql.json(hits)}, ${PROVIDER}, ${actorId})
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
  // 저장 중 배정이 빠졌으면 응답으로 상담 내용을 내보내지 않는다.
  await assertCaseAccess(session.case_id, actorId);

  return {
    id: row.id,
    recording_id: recordingId,
    session_id: rec.session_id,
    status: 'draft',
    text: parts[0].text,
    segments: maskedSegments,
    mask_hits: hits,
    engine: PROVIDER,
    created_at: row.created_at,
  };
}

type TranscriptRow = Omit<Transcript, 'segments'> & { segments: string | null };

const SegmentArraySchema = z.array(
  z.object({
    text: z.string(),
    offset_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  }),
);

const decodeTranscript = (row: TranscriptRow): Transcript => {
  const packed = row.segments ? decryptText(row.segments) : null;
  let segments: TranscriptSegment[] | undefined;
  if (packed) {
    try {
      const parsed = SegmentArraySchema.safeParse(JSON.parse(packed));
      segments = parsed.success ? parsed.data : undefined;
    } catch {
      segments = undefined;
    }
  }
  return { ...row, text: decryptText(row.text) ?? '', segments };
};

/** 회차의 현재 전사문. 마지막 행이 현재 상태다(AI 초안과 같은 규칙). */
export async function latestTranscript(sessionId: number, actorId: number): Promise<Transcript | null> {
  const caseId = await caseIdOfSession(sessionId);
  if (caseId === null) throw new NotFound('회차를 찾지 못했어요.');
  await assertCaseAccess(caseId, actorId);

  const [row] = await sql<TranscriptRow[]>`
    select id, recording_id, session_id, status, text, segments, mask_hits, engine, created_at
    from transcripts where session_id = ${sessionId} order by id desc limit 1`;
  await assertCaseAccess(caseId, actorId);
  return row ? decodeTranscript(row) : null;
}

/**
 * 승인. 사람이 고친 문구가 있으면 그것으로 승인한다.
 * 지우지 않고 새 행을 쌓는다 — 무엇을 보고 승인했는지가 남아야 한다.
 * `transcriptId` 를 주면 **그 초안을 본 승인**이다 — 사이에 새 초안이 올라왔으면
 * 다른 물건을 승인하는 셈이므로 거절한다.
 */
export async function approveTranscript(
  sessionId: number,
  actorId: number,
  editedText: string | undefined,
  transcriptId: number,
): Promise<Transcript> {
  const caseId = await caseIdOfSession(sessionId);
  if (caseId === null) throw new NotFound('회차를 찾지 못했어요.');
  await assertCaseAccess(caseId, actorId);
  await assertConsent(caseId, 'external_stt_processing');

  const [row] = await sql<TranscriptRow[]>`
    select id, recording_id, session_id, status, text, segments, mask_hits, engine, created_at
    from transcripts where session_id = ${sessionId} order by id desc limit 1`;
  if (!row) throw new NotFound('승인할 전사문이 없어요.');
  const current = decodeTranscript(row);
  if (transcriptId !== current.id) {
    throw new RecordingRejected('새 전사문이 올라왔어요. 내용을 다시 확인한 뒤 승인해 주세요.');
  }
  if (current.status !== 'draft') {
    throw new RecordingRejected('승인할 최신 전사 초안이 없어요.');
  }

  const text = editedText ?? current.text;
  const edited = editedText !== undefined && editedText !== current.text;
  // 고친 본문에 옛 타임스탬프를 붙이면 그 구간에서 그 말이 나온 것처럼 보인다.
  const approvedSegments = edited ? null : row.segments;
  const [inserted] = await sql<Array<{ id: number; created_at: string }>>`
    insert into transcripts (recording_id, session_id, status, text, segments, mask_hits, engine, created_by, approved_by)
    select ${current.recording_id}, ${sessionId}, 'approved', ${encryptText(text)},
           ${approvedSegments}, ${sql.json(current.mask_hits)}, ${current.engine}, ${actorId}, ${actorId}
    where ${transcriptId} = (
      select id from transcripts where session_id = ${sessionId} order by id desc limit 1
    )
    returning id, created_at`;
  if (!inserted) {
    throw new RecordingRejected('새 전사문이 올라왔어요. 내용을 다시 확인한 뒤 승인해 주세요.');
  }

  await audit({
    actorId,
    action: 'voice.approve',
    caseId,
    fields: [`transcript=${current.id}`, edited ? 'edited=yes' : 'edited=no'],
  });
  await assertCaseAccess(caseId, actorId);

  return {
    ...current,
    id: inserted.id,
    status: 'approved',
    text,
    segments: edited ? undefined : current.segments,
    created_at: inserted.created_at,
  };
}

/**
 * 보유기간이 지난 음성을 지운다. 파일을 지우고 행은 남긴다 —
 * "있었는데 지웠다"와 "처음부터 없었다"는 다른 사실이다.
 * **지웠거나 원래 없던 것만** 지운 것으로 표시한다 — 디스크 오류를 지움으로 둔갑시키지 않는다.
 */
export async function sweepExpiredRecordings(): Promise<{
  deleted: number;
  missing: number;
  failed: number;
}> {
  const due = await sql<Array<{ id: number; rel_path: string; session_id: number }>>`
    select id, rel_path, session_id from recordings
    where deleted_at is null and delete_after <= now()`;

  let deleted = 0;
  let missing = 0;
  let failed = 0;
  for (const rec of due) {
    const full = join(VOICE_ROOT, rec.rel_path);
    try {
      await rm(full);
      deleted += 1;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // 이미 없는 파일도 지운 것으로 표시한다. 없는 것을 계속 붙들고 있을 이유가 없다.
        missing += 1;
      } else {
        // 권한·디스크 오류는 지운 게 아니다. 표시하지 않고 다음 청소 때 다시 본다.
        failed += 1;
        continue;
      }
    }
    await sql`update recordings set deleted_at = now() where id = ${rec.id}`;
  }
  if (due.length > 0) {
    await audit({
      action: 'voice.sweep',
      fields: [`deleted=${deleted}`, `missing=${missing}`, `failed=${failed}`],
    });
  }
  return { deleted, missing, failed };
}
