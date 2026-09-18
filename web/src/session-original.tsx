// 회차 원본 팝업 — 한 회차의 **수기 기록**(왼쪽)과 **녹음 전사 기록**(오른쪽)을 큰 카드 하나의
// 두 열로 나란히 읽고 고친다(2026-09-18 Q — 카드 머리 + 두 H2 열 머리 + 가로선 구성).
//
// 수기 열은 작성 화면 그대로다: 인테이크 회차는 인테이크 화면을 잠근 채 보이고, 상담 회차는
// 기록 화면을 `embedded` 로 심는다(페이지 제목·HERO 는 팝업 머리가 말하므로 걷는다). 수기
// 수정은 기록 화면의 `수정` 버튼이 한다 — 이 팝업의 구 리비전 편집(수기·전사 원문 칸)은 걷었다.
//
// 전사 열은 녹음 목록·오디오·전사문이다. 전사문은 **맥락 덩어리**로 읽는다 — 침묵이 길어지거나
// 덩어리가 길어지면 새 카드로 가르고, 머리의 시작 시각을 누르면 그 자리부터 재생한다.
// 전사문 고치기는 없다(자동 전사 원문은 리비전 대상이 아니다 — 수기만 수정한다).
import { useEffect, useRef, useState } from 'react';
import { getSessionRecord, type SessionRecord } from './api.ts';
import {
  Forbidden,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  type Recording,
  type Transcript,
  type TranscriptSegment,
} from './speech-api.ts';
import { Button, Empty, ErrorText, Fold, Item } from './ui.tsx';
import { Dialog } from './dialog.tsx';
import { fmtBytes, fmtMs } from './screens/session-audio.tsx';
import { IntakeScreen } from './screens/intake.tsx';
import { RecordScreen } from './screens/record.tsx';
import './session-original.css';

const TRANSCRIBE_LABEL: Record<Recording['transcribe_state'], string> = {
  pending: '전사 중',
  done: '전사됨',
  failed: '전사 실패',
  skipped: '전사 건너뜀',
};

/** 전사문 맥락 덩어리 하나 — 시작 시각과 그 덩어리의 문장들. */
type TranscriptBlock = { offset_ms: number; end_ms: number; texts: string[] };

/**
 * 전사 조각을 맥락 덩어리로 묶는다. 침묵(다음 조각 시작 − 이전 조각 끝)이 2.5초 이상이거나
 * 덩어리가 ~400자를 넘으면 새 덩어리를 연다. 침묵 간격은 이야기 맥락의 근사치다 — 진짜
 * 화제 분할은 AI 파이프라인이 해야 한다.
 */
const transcriptBlocks = (segments: TranscriptSegment[]): TranscriptBlock[] => {
  const blocks: TranscriptBlock[] = [];
  for (const s of segments) {
    const last = blocks[blocks.length - 1];
    const gap = last ? s.offset_ms - last.end_ms : Infinity;
    const size = last ? last.texts.join(' ').length : 0;
    if (!last || gap >= 2500 || size > 400) {
      blocks.push({ offset_ms: s.offset_ms, end_ms: s.offset_ms + s.duration_ms, texts: [s.text] });
    } else {
      last.end_ms = s.offset_ms + s.duration_ms;
      last.texts.push(s.text);
    }
  }
  return blocks;
};

function Voice({ sessionId }: { sessionId: number }) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audios = useRef(new Map<number, HTMLAudioElement>());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await listRecordings(sessionId);
        if (!alive) return;
        setRecordings(rows);
        // 전사문은 **회차 단위**다(`GET /sessions/:id/transcript`) — 녹음 하나를 골라 묻는 게 아니다.
        // 서버는 없으면 `{ status: 'none' }` 만 주므로 그건 전사문으로 세지 않는다.
        if (rows.some((r) => r.transcribe_state === 'done')) {
          const t = await getTranscript(sessionId);
          if (alive && 'id' in t) setTranscript(t);
        }
      } catch (e) {
        if (!alive) return;
        setRecordings([]);
        // 녹음 동의가 없는 회차는 서버가 막는다 — 그때는 자료가 없는 것과 같게 적는다.
        if (!(e instanceof Forbidden)) setError(e instanceof Error ? e.message : '녹음 불러오기 실패');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const seek = (recordingId: number, offsetMs: number) => {
    const el = audios.current.get(recordingId);
    if (!el) return;
    el.currentTime = offsetMs / 1000;
    void el.play();
  };

  if (recordings === null) return <Empty>불러오는 중</Empty>;
  const blocks =
    transcript === null
      ? []
      : transcript.segments && transcript.segments.length > 0
        ? transcriptBlocks(transcript.segments)
        : [{ offset_ms: 0, end_ms: 0, texts: [transcript.text] }];
  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      {recordings.length === 0 ? (
        <Empty>올라온 녹음 없음</Empty>
      ) : (
        recordings.map((r) => (
          <div className="original-recording" key={r.id}>
            <Item
              title={`${r.created_at.slice(0, 10)} 녹음, ${fmtBytes(r.bytes)}${
                r.duration_ms ? `, ${fmtMs(r.duration_ms)}` : ''
              }`}
              desc={
                r.deleted_at
                  ? '보유기간 만료로 삭제됨'
                  : `${TRANSCRIBE_LABEL[r.transcribe_state]}${
                      r.transcribe_note ? `, ${r.transcribe_note}` : ''
                    }`
              }
            />
            {!r.deleted_at && (
              <audio
                controls
                preload="none"
                src={recordingAudioHref(r.id)}
                style={{ width: '100%' }}
                ref={(el) => {
                  if (el) audios.current.set(r.id, el);
                  else audios.current.delete(r.id);
                }}
              />
            )}
          </div>
        ))
      )}
      {transcript ? (
        <>
          {/* 전사문 원문은 녹음 아래 **접힌 아코디언**이다(2026-09-18 Q — 구 왼쪽 기록지의 `전사문(확인됨)`
              칸 대체). 상태는 채운 배지가 아니라 머리의 컬러 텍스트다. */}
          <Fold
            title={transcript.status === 'approved' ? '전사문(확인됨)' : '전사문 초안'}
            desc={transcript.status === 'draft' ? '확인 전' : undefined}
          >
            <p className="transcript-full">{transcript.text}</p>
          </Fold>
          <section className="seq-section original-section">
            <h3 className="seq-section-title">전사 기록</h3>
            {/* 자동 전사는 틀릴 수 있다 — 없는 발화·시각·화자를 화면이 만들어 채우지 않는다. */}
            <p className="seq-section-note">자동 전사라 틀린 곳 있음</p>
            <div className="transcript-blocks">
              {blocks.map((b, i) => (
                <div className="transcript-block" key={i}>
                  <Button variant="ghost" onClick={() => seek(transcript.recording_id, b.offset_ms)}>
                    {fmtMs(b.offset_ms)}
                  </Button>
                  <p className="transcript-block-text">{b.texts.join(' ')}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        recordings.length > 0 && <Empty>전사문 없음</Empty>
      )}
    </>
  );
}

/**
 * 큰 팝업 두 열. 왼쪽 수기, 오른쪽 녹음 전사 — 둘 다 늘 그려서 없는 쪽은 `없음` 으로 말한다
 * (두 열 폭이 같아야 한다, AC-E2). 열고 닫는 것은 부르는 화면이 정한다(회차 목록이 어느 회차인지 안다).
 * 수기 열은 **상담 기록지 그대로**(편집 모드)라 `수정` 을 누르면 저장하고 팝업이 닫힌다(2026-09-18 Q 7).
 */
export function SessionOriginalDialog({
  caseId,
  sessionId,
  seq,
  onClose,
  onSaved,
}: {
  caseId: number;
  sessionId: number;
  seq: number;
  onClose: () => void;
  /** 수기를 고쳐 저장했다 — 부르는 화면이 사례 상세를 다시 받는다(회차 상태·`재정리 필요`). */
  onSaved?: () => void;
}) {
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRec(null);
    void getSessionRecord(sessionId)
      .then((r) => alive && setRec(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '불러오기 실패'));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  return (
    <Dialog
      id="session-original"
      title={`${seq}회차 원본`}
      size="wide"
      className="original-dialog"
      headClose
      open
      onClose={onClose}
    >
      <div className="original-heads">
        <h2>수기 기록</h2>
        <h2>녹음 전사 기록</h2>
      </div>
      <div className="original-cols">
        <section className="original-col" data-part="written" tabIndex={-1} aria-label="수기 기록">
          {/* 한 열로 접히면 위 열 머리 줄을 걷고 각 열이 자기 제목을 단다(.original-col-head). */}
          <h2 className="original-col-head">수기 기록</h2>
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : rec === null ? (
            <Empty>불러오는 중</Empty>
          ) : rec.kind === 'intake' ? (
            <IntakeScreen caseId={caseId} readOnly />
          ) : (
            <RecordScreen caseId={caseId} sessionId={sessionId} embedded onSaved={() => { onSaved?.(); onClose(); }} />
          )}
        </section>
        <section className="original-col" data-part="voice" tabIndex={-1} aria-label="녹음 전사 기록">
          <h2 className="original-col-head">녹음 전사 기록</h2>
          <Voice sessionId={sessionId} />
        </section>
      </div>
    </Dialog>
  );
}
