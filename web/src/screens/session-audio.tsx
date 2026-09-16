// 음성·수기 기록 불일치 패널. 상담 기록하기(record.tsx)에 접이는 카드로 붙는다.
//
//   녹음 올리기 → 전사하기 → 전사 확인(사람 승인) → 불일치 확인
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
  type Recording,
  type SpeechStatus,
  type Transcript,
  type MismatchView,
} from '../speech-api.ts';
import { Button, Empty, ErrorText, Field, Fold, Item } from '../ui.tsx';

const fmtBytes = (n: number): string =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

const fmtMs = (ms: number): string => {
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

export function SessionAudio({
  sessionId,
  onAccessLost,
  writtenChanged = false,
}: {
  sessionId: number;
  /** 배정이 빠져 403 이 오면 부른다 — 화면을 닫는 판단은 부모가 한다. */
  onAccessLost?: () => void;
  writtenChanged?: boolean;
}) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [draftText, setDraftText] = useState('');
  const [mismatches, setMismatches] = useState<MismatchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 한 번에 하나의 일만 한다 — 올리는 중에 전사를 누르면 응답 순서가 뒤집힌다. */
  const [busy, setBusy] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const audioRefs = useRef(new Map<number, HTMLAudioElement>());
  /** 언마운트·접근 상실 뒤 늦게 온 응답이 상태를 덮지 못하게 한다. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setRecordings([]);
    setTranscript(null);
    setDraftText('');
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
        const [recs, tr, mm] = await Promise.all([
          listRecordings(sessionId),
          getTranscript(sessionId),
          getMismatches(sessionId),
        ]);
        if (!live) return;
        setRecordings(recs);
        const found = 'id' in tr ? tr : null;
        setTranscript(found);
        setDraftText(found?.text ?? '');
        setMismatches(mm);
      } catch (e) {
        if (!live) return;
        if (e instanceof Forbidden) onAccessLost?.();
        setError(e instanceof Error ? e.message : '불러오지 못했어요.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };

  }, [sessionId]);

  const guard = (e: unknown): void => {
    if (e instanceof Forbidden) onAccessLost?.();
    if (alive.current) setError(e instanceof Error ? e.message : '실패했어요.');
  };

  const pickFile = async (file: File) => {
    if (!status) return;
    setError(null);
    if (status.max_bytes > 0 && file.size > status.max_bytes) {
      setError(`파일이 너무 커요. ${fmtBytes(status.max_bytes)} 까지 올릴 수 있어요.`);
      return;
    }
    if (status.formats.length > 0 && !accepts(file, status.formats)) {
      setError(`이 형식은 받지 않아요. 가능한 형식: ${status.formats.join(', ')}`);
      return;
    }
    setBusy('upload');
    try {
      const ms = await probeDuration(file);
      await uploadRecording(sessionId, file, ms);
      const recs = await listRecordings(sessionId);
      if (!alive.current) return;
      setRecordings(recs);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) {
        setBusy(null);
        setPickedName(null);
      }
    }
  };

  const transcribe = async (rec: Recording) => {
    setBusy(`tr-${rec.id}`);
    setError(null);
    try {
      const tr = await requestTranscript(rec.id);
      if (!alive.current) return;
      setTranscript(tr);
      setDraftText(tr.text);
      // 새 초안이 생기면 이전 비교 결과는 옛 전사문 기준이다 — 다시 확인하게 둔다.
      setMismatches(null);
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
      const edited = draftText !== transcript?.text ? draftText : undefined;
      const tr = await approveTranscript(sessionId, transcript.id, edited);
      if (!alive.current) return;
      setTranscript(tr);
      setDraftText(tr.text);
      // 승인된 전사문이 바뀌었으니 지난 비교는 버리고 사람이 다시 확인한다.
      setMismatches(null);
    } catch (e) {
      guard(e);
    } finally {
      if (alive.current) setBusy(null);
    }
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

  const seek = (recordingId: number, offsetMs: number) => {
    const el = audioRefs.current.get(recordingId);
    if (!el) return;
    el.currentTime = offsetMs / 1000;
    void el.play().catch(() => {});
  };

  const summary =
    status === null
      ? '불러오는 중'
      : !status.enabled
        ? '꺼져 있어요'
        : transcript?.status === 'approved'
          ? '전사 확인됨'
          : transcript
            ? '전사 확인 전'
            : recordings.length > 0
              ? `녹음 ${recordings.length}개`
              : '숫자 항목 비교';

  return (
    <Fold title="음성·수기 기록 불일치" desc={error ? '불러오기 실패' : summary}>
      {error && <ErrorText>{error}</ErrorText>}
      {loading ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : error && !status ? (
        <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
      ) : !status?.enabled ? (
        // 기능이 꺼져 있으면 꺼져 있다고만 말한다. 빈 양식을 보여 주면 켜져 있는 줄 안다.
        <Empty>녹음·전사 기능이 꺼져 있어요.</Empty>
      ) : (
        <>

          <Field
            label="녹음 올리기"
            htmlFor="voice-file"
            hint={`${status.formats.join(', ') || '오디오'} · ${fmtBytes(status.max_bytes)} 까지`}
          >
            <input
              id="voice-file"

              type="file"
              accept={status.formats.map((f) => f.includes('/') || f.startsWith('.') ? f : `.${f}`).join(',')}
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setPickedName(f.name);
                void pickFile(f);
              }}
            />
          </Field>
          {/* 파일 이름은 이 화면에서만 보인다. 서버에는 보내지 않고 감사에도 남지 않는다. */}
          {busy === 'upload' && pickedName && <p className="panel-meta">올리는 중: {pickedName}</p>}

          {recordings.length === 0 ? (
            <Empty>올라온 녹음이 없어요.</Empty>
          ) : (
            recordings.map((r) => (
              <div className="wire-repeat-card" key={r.id}>
                <Item
                  title={`${fmtDate(r.created_at)} 녹음 · ${fmtBytes(r.bytes)}${
                    r.duration_ms ? ` · ${fmtMs(r.duration_ms)}` : ''
                  }`}
                  desc={
                    r.deleted_at
                      ? '보유기간이 지나 지웠어요.'
                      : `${fmtDate(r.delete_after)}까지 보관`
                  }
                  action={
                    !r.deleted_at && (
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
                    ref={(el) => {
                      if (el) audioRefs.current.set(r.id, el);
                      else audioRefs.current.delete(r.id);
                    }}
                  />
                )}
              </div>
            ))
          )}
          {!status.transcription_ready && (
            <p className="panel-meta">전사 준비가 안 됐어요. 전사하기는 누를 수 없어요.</p>
          )}

          {transcript && (
            <Field
              label={transcript.status === 'approved' ? '전사문(확인됨)' : '전사문 초안'}
              htmlFor="transcript"
              control="textarea"
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

          {transcript?.status === 'approved' && (
            <Button disabled={busy !== null || writtenChanged} onClick={() => void checkMismatches()}>
              {busy === 'mismatch' ? '확인 중…' : '불일치 확인'}
            </Button>
          )}

          {writtenChanged && <Empty>변경한 수기 기록을 저장한 뒤 비교할 수 있어요.</Empty>}
          {!writtenChanged && mismatches && (
            <>
              <p className="panel-meta">숫자 항목 비교</p>
              {mismatches.voice_status === 'unavailable' ? (
                <Empty>{mismatches.voice_reason === 'missing_written' ? '저장된 수기 기록이 없어 비교할 수 없어요.' : '전사문이 없어 비교할 수 없어요.'}</Empty>
              ) : mismatches.voice_status === 'needs_review' ? (
                <Empty>전사 확인 전이라 아직 비교하지 않았어요.</Empty>
              ) : mismatches.voice_vs_written.length === 0 ? (
                <Empty>전사문과 수기 기록 사이에 어긋난 숫자 항목이 없어요.</Empty>
              ) : (
                <MismatchList items={mismatches.voice_vs_written} />
              )}
              {mismatches.across_sessions.length > 0 && (
                <>
                  <p className="panel-meta">회차간 기록 불일치</p>
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
