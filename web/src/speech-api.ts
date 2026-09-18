// 음성 경로 부르기. api.ts 의 `json` 을 다시 쓰지 않는다 — 거기는 403·404·5xx 마다
// 화면 배너를 띄우는데, 이 패널은 접근이 끊긴 것(403)을 스스로 알아야 `onAccessLost` 로
// 화면을 닫을 수 있다. 배너와 패널 오류가 같은 말을 두 번 하지 않게 여기서만 처리한다.
import { API_FAILED, Unauthorized } from './api.ts';

/** 접근이 끊겼다(403). 배정이 빠지면 다음 부르기에서 나온다. */
export class Forbidden extends Error {}

const BASE = import.meta.env.DEV ? '/api' : '';

const announce = (message: string): void => {
  window.dispatchEvent(new CustomEvent(API_FAILED, { detail: message }));
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: init?.headers ?? (init?.body ? { 'content-type': 'application/json' } : undefined),
    });
  } catch {
    announce('서버 연결 실패, 잠시 뒤 다시 시도');
    throw new Error('서버 연결 실패');
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error;
    if (res.status === 401) throw new Unauthorized(message ?? '로그인 필요');
    if (res.status === 403) throw new Forbidden(message ?? '이 사례 접근 불가');
    if (res.status >= 500 || res.status === 404) announce(message ?? `요청 실패 (${res.status})`);
    throw new Error(message ?? `${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 서버 계약(api/src/stt.ts, routes.ts)과 같은 이름이다 ──────────────────

export type SpeechStatus = {
  enabled: boolean;
  transcription_ready: boolean;
  max_bytes: number;
  formats: string[];
};

export type TranscribeState = 'pending' | 'done' | 'failed' | 'skipped';

export type Recording = {
  id: number;
  session_id: number;
  bytes: number;
  duration_ms: number | null;
  delete_after: string;
  deleted_at: string | null;
  created_at: string;
  content_type: string;
  /** 전사 진행 상태. 전사문 자체는 transcripts 에 따로 쌓인다. */
  transcribe_state: TranscribeState;
  /** 실패·건너뜀 이유 한 줄. 본문은 담지 않는다. */
  transcribe_note: string | null;
};

export type TranscriptSegment = { text: string; offset_ms: number; duration_ms: number };

export type Transcript = {
  id: number;
  recording_id: number;
  session_id: number;
  status: 'draft' | 'approved';
  text: string;
  mask_hits: Record<string, number>;
  engine: string | null;
  created_at: string;
  segments?: TranscriptSegment[];
};


export const getSpeechStatus = () => call<SpeechStatus>('/speech/status');

export const listRecordings = (sessionId: number) =>
  call<Recording[]>(`/sessions/${sessionId}/recordings`);

/** 녹음은 본문 그대로 간다. 파일 이름은 서버에 보내지 않는다 — 감사에 남을 이유가 없다. */
  const types: Record<string, string> = {
    wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    flac: 'audio/flac', ogg: 'audio/ogg', webm: 'audio/webm',
  };
export const uploadRecording = (sessionId: number, file: File, durationMs?: number) => {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const q = durationMs ? `?duration_ms=${Math.round(durationMs)}` : '';
  return call<Recording>(`/sessions/${sessionId}/recordings${q}`, {
    method: 'POST',
    headers: { 'content-type': file.type || types[extension] || 'application/octet-stream' },
    body: file,
  });
};

/** 재생 주소. 보호된 경로라 공개 URL 을 만들지 않는다 — 같은 출처 쿠키로만 연다. */
export const recordingAudioHref = (id: number): string => `${BASE}/recordings/${id}/audio`;

export const requestTranscript = (recordingId: number) =>
  call<Transcript>(`/recordings/${recordingId}/transcript`, { method: 'POST' });

export const getTranscript = (sessionId: number) =>
  call<Transcript | { status: 'none' }>(`/sessions/${sessionId}/transcript`);

export const approveTranscript = (sessionId: number, transcriptId: number, text?: string) =>
  call<Transcript>(`/sessions/${sessionId}/transcript/approve`, {
    method: 'POST',
    body: JSON.stringify({ transcript_id: transcriptId, ...(text === undefined ? {} : { text }) }),
  });
