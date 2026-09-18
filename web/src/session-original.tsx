// 회차 원본 팝업 — 한 회차의 **수기 기록**(왼쪽)과 **녹음 전사**(오른쪽)를 큰 모달 두 열로
// 나란히 읽고 고친다(2026-09-18 Q E2·F5 — 구 오른쪽 드로어 폐지).
//
// 수기 열은 작성 양식 그대로다: 인테이크 회차는 인테이크 화면을 잠근 채 그대로 보이고, 상담
// 회차는 기록 화면의 구획 순서(오늘 상담 내용 → 수행할 과제 → 다음에 물어볼 것 → 실무자 의견
// → 다음 상담 목표)로 편다. 전사 열은 녹음 목록과 전사문이다.
//
// 수정은 **편집 모드 + 리비전 로그**다(플래너 판단 D3). `수정` → 원문 칸이 열리고 `저장` 하면
// 새 리비전이 붙는다(`POST /sessions/:id/revisions`, append-only — 지울 수 없다). 원본이 바뀌면
// 그 회차의 AI 요약·불일치는 `재정리 필요`(서버 `stale`)가 되고, 자동 재처리는 하지 않는다(비용·동의 게이트).
// 저장 실패는 **그 자리에 그대로** 보인다 — 성공한 척하지 않는다.
import { useEffect, useRef, useState } from 'react';
import {
  getSessionRecord,
  listRevisions,
  reviseSession,
  type Revision,
  type RevisionKind,
  type SessionRecord,
} from './api.ts';
import {
  Forbidden,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  type Recording,
  type Transcript,
} from './speech-api.ts';
import { Badge, Button, Empty, ErrorText, Item, Meta } from './ui.tsx';
import { Dialog } from './dialog.tsx';
import { fmtBytes, fmtMs } from './screens/session-audio.tsx';
import { IntakeScreen } from './screens/intake.tsx';

/** 기록 화면의 구획 이름 그대로다 — 원본은 적을 때의 양식으로 읽혀야 한다. */
const KIND_LABEL: Record<string, string> = {
  promise: '수행할 과제',
  question: '다음에 물어볼 것',
  judgment: '실무자 의견',
  fact: '확인한 사실',
};
const KIND_ORDER = ['promise', 'question', 'judgment', 'fact'];

const TRANSCRIBE_LABEL: Record<Recording['transcribe_state'], string> = {
  pending: '전사 중',
  done: '전사됨',
  failed: '전사 실패',
  skipped: '전사 건너뜀',
};

export type OriginalPart = 'written' | 'voice';

// 부르는 쪽이 리비전 저장 실패를 그 자리에 적는다. 5xx 배너는 `api.ts` 가 띄운다 — 까닭을
// 화면이 모르는 실패만 배너 몫이고, 409(원본 없음)·400 은 여기서 문구로 보인다.

const stamp = (iso: string): string => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * 원문 한 단 + 편집 모드. 읽을 때는 본문 단, `수정` 을 누르면 같은 자리가 textarea 가 된다.
 * 저장은 리비전을 붙이고, 실패는 그 자리에 남는다. 리비전 로그는 아래에 최신순으로 쌓인다.
 */
function Revisable({
  sessionId,
  kind,
  label,
  text,
  revisions,
  onSaved,
}: {
  sessionId: number;
  kind: RevisionKind;
  label: string;
  /** 원문. 없으면(수기 미작성·전사 없음) 편집도 없다. */
  text: string | null;
  revisions: Revision[] | 'failed' | null;
  onSaved: (rev: Revision) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = revisions === 'failed' || revisions === null ? [] : revisions.filter((r) => r.kind === kind);
  // 최신 리비전이 곧 현재 원문이다 — 저장한 것이 화면에 그대로 보여야 고친 줄 안다.
  const current = mine.length > 0 ? mine[mine.length - 1].text : text;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const rev = await reviseSession(sessionId, kind, draft);
      onSaved(rev);
      setEditing(false);
    } catch (e) {
      setError(`저장 실패, ${e instanceof Error ? e.message : '다시 시도'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="seq-section original-section">
      <h3 className="seq-section-title">{label}</h3>
      {current === null ? (
        <Empty>없음</Empty>
      ) : editing ? (
        <div className="wire-input-box" data-control="textarea">
          <textarea
            aria-label={label}
            rows={8}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      ) : (
        <p className="info-original">{current}</p>
      )}
      {current !== null && (
        <div className="wire-form-actions original-actions">
          {error && <ErrorText>{error}</ErrorText>}
          {editing ? (
            <>
              <Button disabled={saving} onClick={() => setEditing(false)}>
                취소
              </Button>
              <Button
                variant="primary"
                disabled={saving || draft.trim() === '' || draft === current}
                onClick={() => void save()}
              >
                {saving ? '저장 중…' : '저장'}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                setDraft(current);
                setEditing(true);
              }}
            >
              수정
            </Button>
          )}
        </div>
      )}
      {/* 수정 기록은 지울 수 없다(F5). 최신이 위다. */}
      {revisions === 'failed' ? (
        <p className="seq-section-note">수정 기록 불러오기 실패</p>
      ) : (
        mine.length > 0 && (
          <div className="original-revisions">
            <p className="seq-section-note">수정 기록 {mine.length}</p>
            {[...mine].reverse().map((r) => (
              <p className="seq-section-note" key={r.id}>
                <Meta parts={[stamp(r.created_at), r.actor]} />
              </p>
            ))}
          </div>
        )
      )}
    </section>
  );
}

function Written({
  rec,
  caseId,
  revisions,
  onSaved,
}: {
  rec: SessionRecord;
  caseId: number;
  revisions: Revision[] | 'failed' | null;
  onSaved: (rev: Revision) => void;
}) {
  if (rec.kind === 'intake') return <IntakeScreen caseId={caseId} readOnly />;
  const written =
    (rec.memo?.trim() ?? '') !== '' || rec.cards.length > 0 || (rec.next_goal_text?.trim() ?? '') !== '';
  if (!written) return <Empty>수기 미작성</Empty>;
  return (
    <>
      <Revisable
        sessionId={rec.session_id}
        kind="memo"
        label="오늘 상담 내용"
        text={rec.memo?.trim() ? rec.memo : null}
        revisions={revisions}
        onSaved={onSaved}
      />
      {KIND_ORDER.filter((k) => rec.cards.some((c) => c.kind === k)).map((k) => (
        <section className="seq-section original-section" key={k}>
          <h3 className="seq-section-title">{KIND_LABEL[k]}</h3>
          {rec.cards
            .filter((c) => c.kind === k)
            .map((c, i) => (
              <p className="wire-item-desc original-line" key={i} title={c.text}>
                {c.text}
              </p>
            ))}
        </section>
      ))}
      {rec.next_goal_text?.trim() && (
        <section className="seq-section original-section">
          <h3 className="seq-section-title">다음 상담 목표</h3>
          <p className="info-original">{rec.next_goal_text}</p>
        </section>
      )}
      {/* 과제·질문·의견·다음 목표는 기록 화면에서 고친다(구조화된 카드라 원문 칸이 아니다).
          인테이크 회차는 잠근 화면 스스로 `수정` 을 갖는다. */}
      <div className="wire-form-actions original-actions">
        <Button onClick={() => (window.location.hash = `#/cases/${caseId}/sessions/${rec.session_id}/edit`)}>
          기록 수정
        </Button>
      </div>
    </>
  );
}

function Voice({
  sessionId,
  revisions,
  onSaved,
}: {
  sessionId: number;
  revisions: Revision[] | 'failed' | null;
  onSaved: (rev: Revision) => void;
}) {
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
  const transcriptText =
    transcript === null
      ? null
      : transcript.segments && transcript.segments.length > 0
        ? transcript.segments.map((s) => s.text).join('\n')
        : transcript.text;
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
          <section className="seq-section original-section">
            <h3 className="seq-section-title">
              전사문
              {transcript.status === 'draft' && <Badge>확인 전</Badge>}
            </h3>
            {/* 자동 전사는 틀릴 수 있다 — 없는 발화·시각·화자를 화면이 만들어 채우지 않는다. */}
            <p className="seq-section-note">자동 전사라 틀린 곳 있음</p>
            {transcript.segments && transcript.segments.length > 0 && (
              <div className="original-segments">
                {transcript.segments.map((s, i) => (
                  <Item
                    key={i}
                    title={s.text}
                    action={
                      <Button variant="ghost" onClick={() => seek(transcript.recording_id, s.offset_ms)}>
                        {fmtMs(s.offset_ms)}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </section>
          <Revisable
            sessionId={sessionId}
            kind="transcript"
            label="전사 원문"
            text={transcriptText}
            revisions={revisions}
            onSaved={onSaved}
          />
        </>
      ) : (
        recordings.length > 0 && <Empty>전사문 없음</Empty>
      )}
    </>
  );
}

/**
 * 큰 팝업 두 열. 왼쪽 수기, 오른쪽 녹음 전사 — 둘 다 늘 그려서 없는 쪽은 `없음` 으로 말한다
 * (두 열 폭이 같아야 한다, AC-E2). `focus` 는 열 때 초점을 둘 열이다(요약 탭의 버튼 둘).
 * 열고 닫는 것은 부르는 화면이 정한다(회차 목록이 어느 회차인지 안다).
 */
export function SessionOriginalDialog({
  caseId,
  sessionId,
  seq,
  focus = 'written',
  onClose,
  onRevised,
}: {
  caseId: number;
  sessionId: number;
  seq: number;
  focus?: OriginalPart;
  onClose: () => void;
  /** 리비전이 붙었다 — 부르는 화면이 그 회차의 AI 요약·불일치를 `재정리 필요` 로 표시한다. */
  onRevised?: (sessionId: number) => void;
}) {
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | 'failed' | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setRec(null);
    setRevisions(null);
    void getSessionRecord(sessionId)
      .then((r) => alive && setRec(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '불러오기 실패'));
    void listRevisions(sessionId)
      .then((rows) => alive && setRevisions(rows))
      .catch(() => alive && setRevisions('failed'));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    body.current?.querySelector<HTMLElement>(`.original-col[data-part="${focus}"]`)?.focus();
  }, [focus, sessionId]);

  const onSaved = (rev: Revision) => {
    setRevisions((prev) => (prev === null || prev === 'failed' ? [rev] : [...prev, rev]));
    onRevised?.(sessionId);
  };

  return (
    <Dialog id="session-original" title={`${seq}회차 원본`} size="wide" className="original-dialog" open onClose={onClose}>
      <div className="original-cols" ref={body}>
        <section className="original-col" data-part="written" tabIndex={-1} aria-label="수기 기록">
          <h3 className="wire-subhead">수기 기록</h3>
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : rec === null ? (
            <Empty>불러오는 중</Empty>
          ) : (
            <Written rec={rec} caseId={caseId} revisions={revisions} onSaved={onSaved} />
          )}
        </section>
        <section className="original-col" data-part="voice" tabIndex={-1} aria-label="녹음 전사">
          <h3 className="wire-subhead">녹음 전사</h3>
          <Voice sessionId={sessionId} revisions={revisions} onSaved={onSaved} />
        </section>
      </div>
    </Dialog>
  );
}
