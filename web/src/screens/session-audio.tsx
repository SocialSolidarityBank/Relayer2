// 상담 녹음 패널과 음성·수기 기록 불일치 접이는 카드. 상담 기록하기(record.tsx)에 붙는다.
//
//   시작이 곧 회차 — 녹음 시작·파일 업로드·수기 첫 입력이 sessions/start 를 부른다.
//   업로드는 즉시 끝나고 전사는 서버가 뒤에서 돌린다. 화면은 상태만 보여 준다.
//   전사 초안은 승인 전에도 보인다. 승인(전사 확인)은 불일치 비교·기록 반영에만 문이다.
//
// 전사문은 기록의 후보이며, 수기 메모를 자동으로 덮어쓰지 않는다.
// 비교는 숫자 항목만 본다(서버 mismatch.ts). 전사문이 없으면 "없음"이 아니라
// "확인 불가"다 — 둘을 같은 화면으로 보여 주면 안 된다.
import { useEffect, useRef, useState } from 'react';
import {
  approveTranscript,
  Forbidden,
  getMismatches,
  getSpeechStatus,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  requestTranscript,
  uploadRecording,
  type Mismatch,
  type MismatchView,
  type Recording,
  type SpeechStatus,
  type Transcript,
} from '../speech-api.ts';
import { Button, Card, Empty, ErrorText, Field, Fold, FormActions, Item } from '../ui.tsx';

export const fmtBytes = (n: number): string =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

export const fmtMs = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const fmtDate = (iso: string): string => iso.slice(0, 10);

/** 파일 길이를 브라우저에서만 읽는다. 읽지 못하면 없이 보낸다 — 서버는 선택으로 받는다. */
const probeDuration = (file: File): Promise<number | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (duration?: number) => {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const timer = setTimeout(() => finish(), 5000);
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined);
    audio.onerror = () => finish();
    audio.src = url;
  });
const accepts = (file: File, formats: string[]): boolean =>
  formats.some((f) => {
    const want = f.toLowerCase();
    return want.includes('/')
      ? file.type.toLowerCase() === want
      : file.name.toLowerCase().endsWith(want.startsWith('.') ? want : `.${want}`);
  });

/** 브라우저가 받는 녹음 형식을 고른다. iPhone·iPad Safari 는 webm 을 못 쓰니 mp4(m4a)로 간다. */
const pickMimeType = (): string | undefined =>
  ['audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));

/**
 * 화면 잠김 안내(2026-09-18 Q D1-사실). 근거는 PR 본문의 출처 목록:
 * - iOS: 화면 잠김·앱 전환 시 마이크 트랙이 멈춘다는 보고가 WebKit Bugzilla 에 반복되고(241400·211829),
 *   홈 화면 웹앱·WKWebView 는 WebKit 이 백그라운드 캡처를 의도적으로 끈다(217948). 애플 문서가
 *   "잠기면 반드시 멈춘다"고 못박지는 않으므로 `멈출 수 있음`으로 적는다.
 * - Chrome: 마이크를 잡은 탭은 백그라운드 동결 대상에서 뺀다고 문서화돼 있다(freezing-on-energy-saver).
 *   그래도 절전·메모리 압박은 문서 밖이라 "켜 두고 앞에 두는 것이 안전" 수준으로만 말한다.
 */
const LOCK_NOTE =
  'iPhone·iPad는 화면 잠김이나 앱 전환 시 녹음이 멈출 수 있음, 어느 기기든 화면을 켜고 이 화면을 앞에 둔 채 녹음';

/** 녹음 행의 전사 상태 한 줄. 'done' 은 전사문 상태(draft/approved)로 더 정확히 말한다. */
const stateLabel = (r: Recording, transcript: Transcript | null): string => {
  if (r.transcribe_state === 'done') {
    if (transcript?.recording_id === r.id)
      return transcript.status === 'approved' ? '전사 확인됨' : '전사 초안(확인 전)';
    return '전사됨';
  }
  return (
    { pending: '전사 중…', failed: '전사 실패', skipped: '전사 건너뜀' } as const
  )[r.transcribe_state];
};

function MismatchList({ items }: { items: Mismatch[] }) {
  return (
    <>
      {items.map((m, i) => (
        <div className="wire-repeat-card" key={i}>
          <Item
            title={m.label}
            desc={`${m.leftFrom}: ${m.left} ↔ ${m.rightFrom}: ${m.right}`}
          />
          {(m.leftSnippet || m.rightSnippet) && (
            <dl className="panel-meta">
              <dt>{m.leftFrom}</dt><dd>{m.leftSnippet ?? m.left}</dd>
              <dt>{m.rightFrom}</dt><dd>{m.rightSnippet ?? m.right}</dd>
            </dl>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * 상담 기록하기 상단의 녹음 구역(2026-09-16 인계).
 * 회차가 아직 없으면(sessionId null) 버튼만 선다 — 누르는 순간 `ensureSession` 이 회차를 만든다.
 */
export function RecordingPanel({
  sessionId,
  ensureSession,
  onAccessLost,
  onTranscriptChange,
}: {
  /** 시작된(기록됨) 회차. 없으면 null — 녹음·업로드가 먼저 회차를 만든다. */
  sessionId: number | null;
  /** 회차 id 를 돌려준다. 없으면 sessions/start 로 만들어 돌려준다. */
  ensureSession: () => Promise<number>;
  /** 배정이 빠져 403 이 오면 부른다 — 화면을 닫는 판단은 부모가 한다. */
  onAccessLost?: () => void;
  /** 전사문이 새로 생기거나 상태가 바뀌면 부른다 — 불일치 카드가 다시 읽는다. */
  onTranscriptChange?: () => void;
}) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [draftText, setDraftText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** 한 번에 하나의 일만 한다 — 올리는 중에 전사를 누르면 응답 순서가 뒤집힌다. */
  const [busy, setBusy] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const audioRefs = useRef(new Map<number, HTMLAudioElement>());
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recSessionRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  /** 폴링이 초안을 덮어쓰지 않게, 지금 화면에 띄운 전사문의 id·상태를 기억한다. */
  const transcriptKeyRef = useRef('');
  /** 언마운트·접근 상실 뒤 늦게 온 응답이 상태를 덮지 못하게 한다. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // 화면을 나가도 녹음은 잃지 않는다 — 멈춤과 같은 길로 올린다.
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };
  }, []);

  const applyTranscript = (found: Transcript | null) => {
    const key = found ? `${found.id}:${found.status}` : '';
    if (key !== transcriptKeyRef.current) {
      transcriptKeyRef.current = key;
      setTranscript(found);
      setDraftText(found?.text ?? '');
      onTranscriptChange?.();
    }
  };

  const loadVoice = async (id: number) => {
    // 서버는 전사문을 쓴 뒤 recording 을 done 으로 바꾼다. 녹음을 먼저, 전사문을 다음에
    // 읽어야 done 과 이전 none 을 엇갈려 보고 폴링을 영원히 멈추지 않는다.
    const recs = await listRecordings(id);
    const tr = await getTranscript(id);
    if (!alive.current) return;
    setRecordings(recs);
    applyTranscript('id' in tr ? tr : null);
  };

  useEffect(() => {
    setRecordings([]);
    transcriptKeyRef.current = '';
    setTranscript(null);
    setDraftText('');
    let live = true;
    setLoadFailed(false);
    setError(null);
    void (async () => {
      try {
        const st = await getSpeechStatus();
        if (!live) return;
        setStatus(st);
        if (st.enabled && sessionId !== null) await loadVoice(sessionId);
      } catch (e) {
        if (!live) return;
        if (e instanceof Forbidden) onAccessLost?.();
        setLoadFailed(true);
        setError(e instanceof Error ? e.message : '불러오기 실패');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 전사 중인 녹음이 있는 동안만 4초마다 상태를 다시 읽는다. pending 이 없으면 멈춘다.
  useEffect(() => {
    if (sessionId === null || !recordings.some((r) => r.transcribe_state === 'pending')) return;
    const timer = setInterval(() => {
      void loadVoice(sessionId).catch((e: unknown) => {
        if (e instanceof Forbidden) onAccessLost?.();
      });
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, recordings]);

  // 녹음 중 이탈은 녹음을 잃는다 — 브라우저 기본 경고를 띄운다.
  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Date.now() - recStartRef.current), 500);
    return () => clearInterval(timer);
  }, [recording]);

  const guard = (e: unknown): void => {
    if (e instanceof Forbidden) onAccessLost?.();
    if (alive.current) setError(e instanceof Error ? e.message : '작업 실패');
  };

  const startRecording = async () => {
    setError(null);
    setBusy('record');
    try {
      const id = await ensureSession();
      if (!alive.current) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('이 브라우저는 바로 녹음 불가, 파일 업로드 사용');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 권한 창이 떠 있는 사이 화면을 나갔으면, 방금 얻은 마이크를 즉시 놓는다.
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      try {
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (recorderRef.current === recorder) recorderRef.current = null;
          stream.getTracks().forEach((t) => t.stop());
          void finishRecording();
        };
        recSessionRef.current = id;
        recStartRef.current = Date.now();
        recorderRef.current = recorder;
        recorder.start();
        setElapsed(0);
        setRecording(true);
      } catch (e) {
        recorderRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        setError('마이크 권한 필요, 브라우저 주소창에서 허용');
      } else if (e instanceof DOMException && e.name === 'NotFoundError') {
        setError('마이크 없음, 파일 업로드 사용');
      } else {
        guard(e);
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const finishRecording = async () => {
    const id = recSessionRef.current;
    const ms = Date.now() - recStartRef.current;
    if (alive.current) setRecording(false);
    if (!id || !status) return;
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size === 0) return;
    if (status.max_bytes > 0 && blob.size > status.max_bytes) {
      if (alive.current) setError(`녹음 크기 초과, ${fmtBytes(status.max_bytes)} 까지`);
      return;
    }
    if (alive.current) setBusy('upload');
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      await uploadRecording(id, new File([blob], `recording.${ext}`, { type: blob.type }), ms);
      await loadVoice(id);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const pickFile = async (file: File) => {
    if (!status) return;
    setError(null);
    if (status.max_bytes > 0 && file.size > status.max_bytes) {
      setError(`파일 크기 초과, ${fmtBytes(status.max_bytes)} 까지`);
      return;
    }
    if (status.formats.length > 0 && !accepts(file, status.formats)) {
      setError(`받을 수 없는 형식, 가능한 형식: ${status.formats.join(', ')}`);
      return;
    }
    setBusy('upload');
    try {
      // 크기·형식 검사를 통과한 뒤에야 회차를 만든다 — 못 올리는 파일에 회차를 쓰지 않는다.
      const id = await ensureSession();
      const ms = await probeDuration(file);
      await uploadRecording(id, file, ms);
      await loadVoice(id);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) {
        setBusy(null);
        setPickedName(null);
      }
    }
  };

  /** 자동 전사가 실패·건너뛴 녹음의 재시도 버튼이다. */
  const transcribe = async (rec: Recording) => {
    setBusy(`tr-${rec.id}`);
    setError(null);
    try {
      const tr = await requestTranscript(rec.id);
      if (!alive.current) return;
      applyTranscript(tr);
      if (sessionId !== null) await loadVoice(sessionId);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const approve = async () => {
    if (!transcript || !draftText.trim()) return;
    setBusy('approve');
    setError(null);
    try {
      const edited = draftText !== transcript.text ? draftText : undefined;
      const tr = await approveTranscript(transcript.session_id, transcript.id, edited);
      if (!alive.current) return;
      applyTranscript(tr);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const seek = (recordingId: number, offsetMs: number) => {
    const el = audioRefs.current.get(recordingId);
    if (!el) return;
    el.currentTime = offsetMs / 1000;
    void el.play().catch(() => {});
  };

  // 기능이 꺼져 있으면 구역 자체를 숨긴다(2026-09-16 인계). 빈 양식을 보여 주면 켜져 있는 줄 안다.
  if (status === null && !loadFailed) return null;
  if (loadFailed)
    return (
      <Card title="상담 녹음">
        {error && <ErrorText>{error}</ErrorText>}
        <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
      </Card>
    );
  if (!status?.enabled) return null;

  return (
    <Card title="상담 녹음">
      {error && <ErrorText>{error}</ErrorText>}

      {/* 안내 세 줄 + 버튼 한 행(2026-09-18 Q D1 — 구 카드 도움말 한 줄 대체). */}
      <div className="recording-head">
        <dl className="recording-note">
          <div>
            <dt>파일 형식</dt>
            <dd>{status.formats.join(', ') || '오디오'}</dd>
          </div>
          <div>
            <dt>파일 크기</dt>
            <dd>{fmtBytes(status.max_bytes)} 이내</dd>
          </div>
          <div>
            <dt>주의</dt>
            <dd>{LOCK_NOTE}</dd>
          </div>
        </dl>
        <div className="recording-actions">
          {recording ? (
            <Button variant="primary" onClick={stopRecording}>
              녹음 멈춤
            </Button>
          ) : (
            <Button variant="primary" disabled={busy !== null} onClick={() => void startRecording()}>
              {busy === 'record' ? '시작 중…' : '녹음 시작'}
            </Button>
          )}
          <Button
            disabled={busy !== null || recording}
            onClick={() => fileRef.current?.click()}
          >
            파일 업로드
          </Button>
        </div>
      </div>
      {recording && <p className="panel-meta">녹음 중 {fmtMs(elapsed)}</p>}
      <input
        ref={fileRef}
        id="voice-file"
        type="file"
        hidden
        accept={status.formats.map((f) => (f.includes('/') || f.startsWith('.') ? f : `.${f}`)).join(',')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setPickedName(f.name);
          void pickFile(f);
        }}
      />
      {/* 파일 이름은 이 화면에서만 보인다. 서버에는 보내지 않고 감사에도 남지 않는다. */}
      {busy === 'upload' && <p className="panel-meta">올리는 중{pickedName ? `: ${pickedName}` : '…'}</p>}

      {sessionId !== null &&
        (recordings.length === 0 ? (
          <Empty>올라온 녹음 없음</Empty>
        ) : (
          recordings.map((r) => (
            <div className="wire-repeat-card" key={r.id}>
              <Item
                title={`${fmtDate(r.created_at)} 녹음, ${fmtBytes(r.bytes)}${
                  r.duration_ms ? `, ${fmtMs(r.duration_ms)}` : ''
                }`}
                desc={
                  r.deleted_at
                    ? '보유기간 만료로 삭제됨'
                    : `${fmtDate(r.delete_after)}까지 보관, ${stateLabel(r, transcript)}${
                        r.transcribe_note ? `, ${r.transcribe_note}` : ''
                      }`
                }
                action={
                  !r.deleted_at &&
                  (r.transcribe_state === 'failed' || r.transcribe_state === 'skipped') && (
                    <Button
                      disabled={busy !== null || !status.transcription_ready}
                      onClick={() => void transcribe(r)}
                    >
                      {busy === `tr-${r.id}` ? '전사 중…' : '전사하기'}
                    </Button>
                  )
                }
              />
              {!r.deleted_at && (
                <audio
                  controls
                  preload="none"
                  src={recordingAudioHref(r.id)}
                  style={{ width: '100%' }}
                  ref={(el) => {
                    if (el) audioRefs.current.set(r.id, el);
                    else audioRefs.current.delete(r.id);
                  }}
                />
              )}
            </div>
          ))
        ))}
      {recordings.some((r) => r.transcribe_state === 'failed' || r.transcribe_state === 'skipped') &&
        !status.transcription_ready && (
        <p className="panel-meta">전사 준비 안 됨, 전사하기 불가</p>
      )}

      {transcript && (
        <Field
          label={transcript.status === 'approved' ? '전사문(확인됨)' : '전사문 초안'}
          htmlFor="transcript"
          control="textarea"
          tone="ai"
          hint={transcript.status === 'approved' ? undefined : '승인 전 초안'}
        >
          <textarea
            id="transcript"
            rows={6}
            aria-label="전사문"
            value={draftText}
            disabled={transcript.status === 'approved'}
            onChange={(e) => setDraftText(e.target.value)}
          />
        </Field>
      )}
      {transcript?.status === 'draft' && (
        <Button variant="primary" disabled={busy !== null || !draftText.trim()} onClick={() => void approve()}>
          {busy === 'approve' ? '확인 중…' : '전사 확인'}
        </Button>
      )}
      {transcript?.segments && transcript.segments.length > 0 && (
        <>
          {transcript.segments.map((s, i) => (
            <div className="wire-repeat-card" key={i}>
              <Item
                title={s.text}
                action={
                  <Button variant="ghost" onClick={() => seek(transcript.recording_id, s.offset_ms)}>
                    {fmtMs(s.offset_ms)}
                  </Button>
                }
              />
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

/**
 * 음성·수기 기록 불일치 접이는 카드. 녹음·전사 조작은 위 RecordingPanel 이 맡고,
 * 여기는 승인된 전사문과 수기 기록의 숫자 항목 비교만 남는다.
 */
export function SessionAudio({
  sessionId,
  onAccessLost,
  writtenChanged = false,
  voiceStamp = 0,
}: {
  sessionId: number;
  /** 배정이 빠져 403 이 오면 부른다 — 화면을 닫는 판단은 부모가 한다. */
  onAccessLost?: () => void;
  writtenChanged?: boolean;
  /** 위 패널에서 전사문이 바뀌면 값이 올라간다 — 비교 대상이 달라졌으니 다시 읽는다. */
  voiceStamp?: number;
}) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [mismatches, setMismatches] = useState<MismatchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** 언마운트·접근 상실 뒤 늦게 온 응답이 상태를 덮지 못하게 한다. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setTranscript(null);
    setMismatches(null);
    let live = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const st = await getSpeechStatus();
        if (!live) return;
        setStatus(st);
        if (!st.enabled) return;
        const [tr, mm] = await Promise.all([getTranscript(sessionId), getMismatches(sessionId)]);
        if (!live) return;
        setTranscript('id' in tr ? tr : null);
        setMismatches(mm);
      } catch (e) {
        if (!live) return;
        if (e instanceof Forbidden) onAccessLost?.();
        setError(e instanceof Error ? e.message : '불러오기 실패');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, voiceStamp]);

  const guard = (e: unknown): void => {
    if (e instanceof Forbidden) onAccessLost?.();
    if (alive.current) setError(e instanceof Error ? e.message : '작업 실패');
  };

  const checkMismatches = async () => {
    if (writtenChanged) return;
    setBusy('mismatch');
    setError(null);
    try {
      const mm = await getMismatches(sessionId);
      if (!alive.current) return;
      setMismatches(mm);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const summary =
    status === null
      ? '불러오는 중'
      : !status.enabled
        ? '꺼짐'
        : transcript?.status === 'approved'
          ? '전사 확인됨'
          : transcript
            ? '전사 확인 전'
            : '숫자 항목 비교';

  return (
    <Fold title="음성·수기 기록 불일치" desc={error ? '불러오기 실패' : summary}>
      {error && <ErrorText>{error}</ErrorText>}
      {loading ? (
        <Empty>불러오는 중</Empty>
      ) : error && !status ? (
        <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
      ) : !status?.enabled ? (
        // 기능이 꺼져 있으면 꺼져 있다고만 말한다. 빈 양식을 보여 주면 켜져 있는 줄 안다.
        <Empty>녹음·전사 기능 꺼짐</Empty>
      ) : (
        <>
          {transcript?.status === 'approved' && (
            <Button disabled={busy !== null || writtenChanged} onClick={() => void checkMismatches()}>
              {busy === 'mismatch' ? '확인 중…' : '불일치 확인'}
            </Button>
          )}

          {writtenChanged && <Empty>수기 기록 저장 후 비교 가능</Empty>}
          {!writtenChanged && mismatches && (
            <>
              {/* 구획 이름은 소제목이다(2026-09-17 Q) — 구 `.panel-meta`(14/400)는 값·상태의 옷이라
                  아래 목록과 위계가 같아졌다. */}
              <h3 className="wire-subhead">숫자 항목 비교</h3>
              {mismatches.voice_status === 'unavailable' ? (
                <Empty>{mismatches.voice_reason === 'missing_written' ? '비교 불가, 수기 기록 없음' : '비교 불가, 전사문 없음'}</Empty>
              ) : mismatches.voice_status === 'needs_review' ? (
                <Empty>전사 확인 전, 비교 안 함</Empty>
              ) : mismatches.voice_vs_written.length === 0 ? (
                <Empty>어긋난 숫자 항목 없음</Empty>
              ) : (
                <MismatchList items={mismatches.voice_vs_written} />
              )}
              {mismatches.across_sessions.length > 0 && (
                <>
                  <h3 className="wire-subhead">회차간 기록 불일치</h3>
                  <MismatchList items={mismatches.across_sessions} />
                </>
              )}
            </>
          )}
        </>
      )}
    </Fold>
  );
}
