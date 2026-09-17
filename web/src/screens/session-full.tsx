// 상담 내용 원본 보기(2026-09-16 인계 · 이름은 2026-09-17 Q — 구 `수기·음성 전문`).
// 회차별 요약의 `전문 보기`가 여기로 온다. 읽기 전용이다 — 편집·승인은 상담 기록하기가 담당한다.
import { useEffect, useRef, useState } from 'react';
import { getCaseDetail, getSessionRecord, type CaseDetail, type SessionRecord } from '../api.ts';
import {
  Forbidden,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  type Recording,
  type Transcript,
} from '../speech-api.ts';
import { Badge, Button, Empty, ErrorText, Fold, Item, ParticipantHero } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';
import { fmtBytes, fmtMs } from './session-audio.tsx';
import { IntakeScreen } from './intake.tsx';

const dateLabel = (iso: string | null): string => {
  if (!iso) return '날짜 없음';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

/** 카드의 출처 구획 라벨 — 기록 화면의 구획 이름과 같다. */
const KIND_LABEL: Record<string, string> = {
  promise: '수행할 과제',
  question: '다음에 물어볼 것',
  judgment: '실무자 의견',
};

const TRANSCRIBE_LABEL: Record<Recording['transcribe_state'], string> = {
  pending: '전사 중…',
  done: '전사됨',
  failed: '전사 실패',
  skipped: '전사 건너뜀',
};

export function SessionFullScreen({ caseId, sessionId }: { caseId: number; sessionId: number }) {
  const [rec, setRec] = useState<SessionRecord | null>(null);
  // 이름은 이 화면이 받지 않는다 — 당사자 카드를 위해 사례 상세를 한 번 더 부른다(2026-09-17 Q 시안).
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRefs = useRef(new Map<number, HTMLAudioElement>());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [found, d] = await Promise.all([getSessionRecord(sessionId), getCaseDetail(caseId)]);
        if (!live) return;
        setRec(found);
        setDetail(d);
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : '회차 불러오기 실패');
      }
      // 음성은 따로 읽는다 — 기능이 꺼져 있거나 녹음이 없어도 수기는 보여야 한다.
      try {
        const [recs, tr] = await Promise.all([listRecordings(sessionId), getTranscript(sessionId)]);
        if (!live) return;
        setRecordings(recs);
        setTranscript('id' in tr ? tr : null);
      } catch (e) {
        if (!live) return;
        if (!(e instanceof Forbidden))
          setVoiceError(e instanceof Error ? e.message : '녹음 불러오기 실패');
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId]);

  const seek = (recordingId: number, offsetMs: number) => {
    const el = audioRefs.current.get(recordingId);
    if (!el) return;
    el.currentTime = offsetMs / 1000;
    void el.play().catch(() => {});
  };

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!rec) return <p className="empty">불러오는 중</p>;

  const written =
    (rec.memo?.trim() ?? '') !== '' || rec.cards.length > 0 || (rec.next_goal_text?.trim() ?? '') !== '';

  return (
    <>
      <ParticipantHero
        name={detail?.participant.name ?? null}
        pseudonym={detail?.pseudonym ?? '확인 중'}
        details={[
          ['당사자 ID', detail?.pseudonym ?? '확인 중'],
          [
            '참여 사업',
            `${detail?.case.program_name ?? '확인 중'}, ${rec.seq}회차 ${dateLabel(rec.held_at)}`,
          ],
          ['연락처', detail?.participant.phone ?? ''],
          ['이메일', detail?.participant.email ?? ''],
        ]}
        actions={
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
        }
      />
      <div className="wire-container">
        {/* 인테이크 회차는 작성 화면을 그대로 잠가서 보여 준다(2026-09-18 UI-3 Q) — 구획·순서·라벨이
            작성할 때와 같아야 "처음에 입력한 내용"으로 읽힌다. 수정 버튼은 그 화면 안에 있다. */}
        {rec.kind === 'intake' ? (
          <IntakeScreen caseId={caseId} readOnly />
        ) : (
          /* 한 화면에서 **하나만 펼친다**(2026-09-17 Q). 펼친 제목 줄은 활성 면(파스텔)을
             받으므로, 둘 다 펼치면 그 신호가 가리킬 대조군이 없다.
             어느 쪽을 펼치는지는 회차가 정한다 — 수기가 있으면 수기가 보러 온 것이고,
             수기 미작성 회차(녹음만 있는 회차)에서는 볼 것이 음성 쪽에 있다. */
          <Fold
            title="상담 내용"
            open={written}
            action={
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.hash = `#/cases/${caseId}/sessions/${sessionId}/edit`;
                }}
              >
                수정
              </Button>
            }
          >
            {!written ? (
              <Empty>수기 미작성</Empty>
            ) : (
              <>
                {rec.memo?.trim() && <p className="info-original">{rec.memo}</p>}
                {rec.next_goal_text?.trim() && (
                  <Item title="다음 상담 목표" desc={rec.next_goal_text} />
                )}
                {rec.cards.map((c, i) => (
                  <div className="wire-repeat-card" key={i}>
                    <Item title={c.text} desc={KIND_LABEL[c.kind] ?? c.kind} />
                  </div>
                ))}
              </>
            )}
          </Fold>
        )}

        <Fold title="음성 기록" open={!written}>
          {voiceError && <ErrorText>{voiceError}</ErrorText>}
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
                      if (el) audioRefs.current.set(r.id, el);
                      else audioRefs.current.delete(r.id);
                    }}
                  />
                )}
              </div>
            ))
          )}

          {transcript && (
            <>
              {/* 구획 이름은 소제목(14/600 --sub)이다 — 값·상태를 쓰는 `.panel-meta`(14/400)로
                  머리를 대신하면 아래 내용과 위계가 같아진다(2026-09-17 Q 제목 위계 점검). */}
              <h3 className="wire-subhead">
                전사문{transcript.status === 'draft' && <> <Badge>확인 전</Badge></>}
              </h3>
              {transcript.segments && transcript.segments.length > 0 ? (
                transcript.segments.map((s, i) => (
                  <div className="wire-repeat-card" key={i}>
                    <Item
                      title={s.text}
                      action={
                        <Button
                          variant="ghost"
                          onClick={() => seek(transcript.recording_id, s.offset_ms)}
                        >
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
          )}
        </Fold>
      </div>
    </>
  );
}
