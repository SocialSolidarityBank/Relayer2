// 회차 원본 드로어 — 한 회차의 **수기 기록**과 **녹음·전사**를 오른쪽에서 열어 읽는다
// (2026-09-18 Q 승인). 구 `회차별 원본 보기` 탭과 `상담 내용 원본 보기` 화면을 대체한다.
//
// 왜 모달이 아니라 드로어인가: 원본은 **옆의 회차 목록·요약과 대조하면서** 읽는 것이다. 팀 목업
// 넷은 1,040px 모달이라 화면을 다 가려서 그 대조를 못 한다. 드로어는 회차 목록을 왼쪽에 남긴다.
//
// 한 회차에서 볼 것은 둘이라 **버튼도 둘**이다(목업 공통 배치): `상담 기록 보기` · `녹음 전사 보기`.
// 인테이크 회차의 수기 기록은 인테이크 작성 화면을 잠근 채 그대로 보여 준다 — 구획·순서·라벨이
// 작성할 때와 같아야 "처음에 적은 것"으로 읽힌다(2026-09-18 UI-3).
import { useEffect, useRef, useState } from 'react';
import { getSessionRecord, type SessionRecord } from './api.ts';
import {
  Forbidden,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  type Recording,
  type Transcript,
} from './speech-api.ts';
import { Badge, Button, Empty, ErrorText, Item } from './ui.tsx';
import { fmtBytes, fmtMs } from './screens/session-audio.tsx';
import { IntakeScreen } from './screens/intake.tsx';

/** 카드의 출처 구획 라벨 — 기록 화면의 구획 이름과 같다. */
const KIND_LABEL: Record<string, string> = {
  promise: '수행할 과제',
  question: '다음에 물어볼 것',
  judgment: '실무자 의견',
  fact: '확인한 사실',
};

const TRANSCRIBE_LABEL: Record<Recording['transcribe_state'], string> = {
  pending: '전사 중',
  done: '전사됨',
  failed: '전사 실패',
  skipped: '전사 건너뜀',
};

export type OriginalPart = 'written' | 'voice';

/** 회차 머리에 세우는 버튼 둘. 접힘 카드가 같이 열리지 않게 클릭을 막는다. */
export function OriginalButtons({
  onOpen,
  hasVoice,
}: {
  onOpen: (part: OriginalPart) => void;
  /** 녹음이 아예 없는 회차에서는 전사 버튼을 세우지 않는다. */
  hasVoice: boolean;
}) {
  const open = (part: OriginalPart) => (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onOpen(part);
  };
  return (
    <>
      <Button onClick={open('written')}>상담 기록 보기</Button>
      {hasVoice && <Button onClick={open('voice')}>녹음 전사 보기</Button>}
    </>
  );
}

function Written({ rec, caseId }: { rec: SessionRecord; caseId: number }) {
  const written =
    (rec.memo?.trim() ?? '') !== '' || rec.cards.length > 0 || (rec.next_goal_text?.trim() ?? '') !== '';
  if (rec.kind === 'intake') return <IntakeScreen caseId={caseId} readOnly />;
  if (!written) return <Empty>수기 미작성</Empty>;
  return (
    <>
      {rec.memo?.trim() && <p className="info-original">{rec.memo}</p>}
      {rec.next_goal_text?.trim() && <Item title="다음 상담 목표" desc={rec.next_goal_text} />}
      {rec.cards.map((c, i) => (
        <div className="wire-repeat-card" key={i}>
          <Item title={c.text} desc={KIND_LABEL[c.kind] ?? c.kind} />
        </div>
      ))}
    </>
  );
}

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
  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      {recordings.length === 0 ? (
        <Empty>올라온 녹음 없음</Empty>
      ) : (
        recordings.map((r) => (
          <div className="wire-repeat-card" key={r.id}>
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
          <h3 className="wire-subhead">
            전사문
            {transcript.status === 'draft' && (
              <>
                {' '}
                <Badge>확인 전</Badge>
              </>
            )}
          </h3>
          {/* 자동 전사는 틀릴 수 있다 — 목업 넷이 공통으로 띄운 경고를 한 줄로 남긴다.
              없는 발화·시각·화자를 화면이 만들어 채우지 않는다. */}
          <p className="panel-meta">자동 전사라 틀린 곳 있음</p>
          {transcript.segments && transcript.segments.length > 0 ? (
            transcript.segments.map((s, i) => (
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
            ))
          ) : (
            <p className="info-original">{transcript.text}</p>
          )}
        </>
      ) : (
        recordings.length > 0 && <Empty>전사문 없음</Empty>
      )}
    </>
  );
}

/**
 * 오른쪽 드로어. 네이티브 `<dialog>` 라 Escape 로 닫히고 초점이 안에 갇힌다.
 * 열고 닫는 것은 부르는 화면이 정한다(회차 카드가 어느 회차·어느 쪽인지 안다).
 */
export function SessionOriginalDrawer({
  caseId,
  sessionId,
  seq,
  part,
  onClose,
}: {
  caseId: number;
  sessionId: number;
  seq: number;
  part: OriginalPart;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

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
    <dialog
      ref={dialog}
      className="side-drawer"
      aria-labelledby="drawer-title"
      onClose={onClose}
      // 바깥(백드롭)을 누르면 닫는다 — 드로어 면 안의 클릭은 그대로 둔다.
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="side-drawer-head">
        <h2 id="drawer-title">
          {seq}회차 {part === 'written' ? '상담 기록' : '녹음 전사'}
        </h2>
        <Button onClick={() => dialog.current?.close()}>닫기</Button>
      </div>
      <div className="side-drawer-body">
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : part === 'voice' ? (
          <Voice sessionId={sessionId} />
        ) : rec === null ? (
          <Empty>불러오는 중</Empty>
        ) : (
          <Written rec={rec} caseId={caseId} />
        )}
      </div>
    </dialog>
  );
}
