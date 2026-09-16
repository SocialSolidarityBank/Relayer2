// 수기·음성 전문 보기(2026-09-16 인계). 회차별 요약의 `전문 보기`가 여기로 온다.
// 읽기 전용이다 — 편집·승인은 상담 기록하기가 담당한다.
import { useEffect, useRef, useState } from 'react';
import { getSessionRecord, type SessionRecord } from '../api.ts';
import {
  Forbidden,
  getTranscript,
  listRecordings,
  recordingAudioHref,
  type Recording,
  type Transcript,
} from '../speech-api.ts';
import { Badge, Button, Card, Empty, ErrorText, Item, PageHeader } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';
import { fmtBytes, fmtMs } from './session-audio.tsx';

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
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRefs = useRef(new Map<number, HTMLAudioElement>());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const found = await getSessionRecord(sessionId);
        if (!live) return;
        setRec(found);
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : '회차를 불러오지 못했어요.');
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
          setVoiceError(e instanceof Error ? e.message : '녹음을 불러오지 못했어요.');
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
  if (!rec) return <p className="empty">불러오는 중이에요.</p>;

  const written =
    (rec.memo?.trim() ?? '') !== '' || rec.cards.length > 0 || (rec.next_goal_text?.trim() ?? '') !== '';

  return (
    <>
      <PageHeader
        title="수기·음성 전문"
        meta={`${rec.seq}회차 · ${dateLabel(rec.held_at)} · ${METHOD_LABEL[rec.method ?? ''] ?? rec.method ?? '방법 없음'}`}
      />
      <div className="wire-container">
        <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>
          회차별 요약으로
        </Button>

        <Card title="수기 기록">
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
        </Card>

        <Card title="음성">
          {voiceError && <ErrorText>{voiceError}</ErrorText>}
          {recordings.length === 0 ? (
            <Empty>올라온 녹음이 없어요.</Empty>
          ) : (
            recordings.map((r) => (
              <div className="wire-repeat-card" key={r.id}>
                <Item
                  title={`${r.created_at.slice(0, 10)} 녹음 · ${fmtBytes(r.bytes)}${
                    r.duration_ms ? ` · ${fmtMs(r.duration_ms)}` : ''
                  }`}
                  desc={
                    r.deleted_at
                      ? '보유기간이 지나 지웠어요.'
                      : `${TRANSCRIBE_LABEL[r.transcribe_state]}${
                          r.transcribe_note ? ` — ${r.transcribe_note}` : ''
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
              <p className="panel-meta">
                전사문{transcript.status === 'draft' && <> · <Badge>확인 전</Badge></>}
              </p>
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
        </Card>
      </div>
    </>
  );
}
