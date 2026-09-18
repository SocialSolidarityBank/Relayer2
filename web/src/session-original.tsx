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
//
// v6 분석(2026-09-18 Q)은 **덧붙는 층**이다 — 부르기가 실패해도 원본 두 열은 그대로 보인다.
//  - 수기 열: 승인 분석이 있으면 `원문 그대로 | 구조화` 전환이 붙는다(기본 원문, 인테이크 제외).
//  - 전사 열: 전사가 승인됐으면 맥락 덩어리 대신 **문장 행**(상태 띠·불일치·연결)을 그린다.
//    덩어리 묶음은 침묵 간격의 근사치이고 문장 행은 서버 span 이라 둘을 겹쳐 그릴 수 없다 —
//    분석이 있으면 문장 행이, 없으면 덩어리가 그 자리를 갖는다(전사문 전문 아코디언은 둘 다 그대로).
//  - 세 번째 자리: 대조 패널(≥768 우측, ≤767 아래 — `.analysis-split`). 문장을 고르면 수기↔전사를
//    나란히 놓고, 키워드 칩·회차 카드 칩은 같은 자리에 백링크 목록을 연다(Q 11).
import { useEffect, useRef, useState } from 'react';
import {
  Forbidden as ApiForbidden,
  getAnalysis,
  getBacklinks,
  getSessionRecord,
  isTranscriptSpan,
  type AnalysisView,
  type Backlink,
  type SessionRecord,
} from './api.ts';
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
import { ContrastPanel, type ContrastPanelProps } from './analysis-panel.tsx';
import { StructuredRecordView, paragraphOfSpan } from './structured-record.tsx';
import { TranscriptView } from './transcript-view.tsx';
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

function Voice({
  sessionId,
  analysis,
  selectedSpan,
  onSelectSpan,
  filter,
  onToggleFilter,
}: {
  sessionId: number;
  /** 승인 전사에 붙은 v6 분석. 있으면 전사 열이 문장 행으로 간다. */
  analysis: AnalysisView | null;
  selectedSpan: string | null;
  onSelectSpan: (spanId: string) => void;
  filter: boolean;
  onToggleFilter: () => void;
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
  const blocks =
    transcript === null
      ? []
      : transcript.segments && transcript.segments.length > 0
        ? transcriptBlocks(transcript.segments)
        : [{ offset_ms: 0, end_ms: 0, texts: [transcript.text] }];
  // 분석의 전사 span 은 승인 전사만 가리킨다(T19) — 초안 전사에는 문장 행을 그리지 않는다.
  const spanRows = analysis && analysis.transcript?.status === 'approved' ? analysis : null;
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
            {spanRows ? (
              // 문장 행 — 상태 띠는 링크된 수기 span 에서 상속하고, 주의 문구·불일치 모아보기·
              // `전사 없는 녹음 N건` 은 뷰가 스스로 적는다.
              <TranscriptView
                spans={spanRows.spans}
                documents={spanRows.documents}
                links={spanRows.analysis?.body?.links ?? []}
                discrepancies={spanRows.analysis?.body?.discrepancies ?? []}
                record={spanRows.analysis?.body?.record ?? null}
                selectedSpan={selectedSpan}
                onSelect={onSelectSpan}
                filterDiscrepancies={filter}
                onToggleFilter={onToggleFilter}
                transcriptStatus={spanRows.transcript?.status ?? null}
                recordingsWithoutTranscript={spanRows.transcript?.recordings_without_transcript ?? 0}
              />
            ) : (
              <>
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
              </>
            )}
          </section>
        </>
      ) : (
        recordings.length > 0 && <Empty>전사문 없음</Empty>
      )}
    </>
  );
}

/**
 * 큰 팝업 두 열 + 대조 패널. 왼쪽 수기, 오른쪽 녹음 전사 — 둘 다 늘 그려서 없는 쪽은 `없음` 으로 말한다
 * (두 열 폭이 같아야 한다, AC-E2). 열고 닫는 것은 부르는 화면이 정한다(회차 목록이 어느 회차인지 안다).
 * 수기 열은 **상담 기록지 그대로**(편집 모드)라 `수정` 을 누르면 저장하고 팝업이 닫힌다(2026-09-18 Q 7).
 */
export function SessionOriginalDialog({
  caseId,
  sessionId,
  seq,
  backlinkKeyword,
  initialSpan,
  onClose,
  onSaved,
  onOpenSession,
}: {
  caseId: number;
  sessionId: number;
  seq: number;
  /** 열자마자 이 키워드의 백링크 목록을 패널에 띄운다(회차 카드 키워드 칩). */
  backlinkKeyword?: string;
  /** 열자마자 이 span 을 고르고 그 자리로 간다(백링크로 다른 회차를 열 때). */
  initialSpan?: string;
  onClose: () => void;
  /** 수기를 고쳐 저장했다 — 부르는 화면이 사례 상세를 다시 받는다(회차 상태·`재정리 필요`). */
  onSaved?: () => void;
  /** 백링크가 다른 회차를 가리킨다 — 부르는 화면이 그 회차로 팝업을 다시 연다. */
  onOpenSession?: (sessionId: number, spanId: string) => void;
}) {
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [structured, setStructured] = useState(false);
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);
  const [panel, setPanel] = useState<ContrastPanelProps>({ mode: 'empty' });
  const [filter, setFilter] = useState(false);
  // 패널 버튼이 요청한 이동 — 구조화로 바꾼 뒤 렌더가 끝나야 span 을 찾을 수 있다.
  const [focusRequest, setFocusRequest] = useState<{ kind: 'paragraph' | 'span'; id: string } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const appliedSpan = useRef<string | null>(null);
  const appliedKeyword = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRec(null);
    setError(null);
    setAnalysis(null);
    setStructured(false);
    setSelectedSpan(null);
    setPanel({ mode: 'empty' });
    setFilter(false);
    setFocusRequest(null);
    appliedSpan.current = null;
    appliedKeyword.current = null;
    void getSessionRecord(sessionId)
      .then((r) => alive && setRec(r))
      .catch(
        (e) =>
          alive &&
          setError(e instanceof ApiForbidden ? '열람 권한 없음' : e instanceof Error ? e.message : '불러오지 못함'),
      );
    // 분석은 원본과 따로 간다 — 실패해도 원본 두 열은 그대로다.
    void getAnalysis(sessionId)
      .then((a) => alive && setAnalysis(a))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const spanText = (spanId: string): string => {
    const s = analysis?.spans.find((x) => x.id === spanId);
    const d = s && analysis?.documents.find((x) => x.id === s.doc);
    return s && d ? d.text.slice(s.start, s.end) : '';
  };

  const selectSpan = (spanId: string) => {
    setSelectedSpan(spanId);
    const approved = analysis?.analysis?.body;
    if (!approved) {
      setPanel({ mode: 'empty' });
      return;
    }
    const discrepancy = approved.discrepancies.find((d) => d.transcript_span === spanId);
    const link = approved.links.find((l) => l.transcript_span === spanId);
    if (discrepancy) {
      setPanel({
        mode: 'discrepancy',
        difference: discrepancy.difference,
        transcriptText: spanText(spanId),
        writtenText: discrepancy.written_spans.map(spanText).join(' '),
        paragraph: approved.record.paragraphs.find((p) => p.id === discrepancy.paragraph_id) ?? null,
      });
    } else if (link) {
      setPanel({
        mode: 'link',
        transcriptText: spanText(spanId),
        writtenText: link.written_spans.map(spanText).join(' '),
        paragraph: paragraphOfSpan(approved.record, link.written_spans[0] ?? ''),
      });
    } else {
      setPanel({ mode: 'empty' });
    }
  };

  const openBacklinks = (keyword: string) => {
    setPanel({ mode: 'backlinks', keyword, backlinks: [] });
    void getBacklinks(caseId, keyword)
      .then((rows) => setPanel({ mode: 'backlinks', keyword, backlinks: rows }))
      .catch(() => setPanel({ mode: 'backlinks', keyword, backlinks: [] }));
  };

  // `연결된 수기 단락` — 수기 열을 구조화로 바꾸고 단락 제목으로 간다.
  const goToParagraph = (paragraphId: string) => {
    setStructured(true);
    setFocusRequest({ kind: 'paragraph', id: paragraphId });
  };

  const goToBacklink = (item: Backlink) => {
    if (item.session_id !== sessionId) {
      onOpenSession?.(item.session_id, item.span_id);
      return;
    }
    if (!isTranscriptSpan(item.span_id)) setStructured(true);
    setFocusRequest({ kind: 'span', id: item.span_id });
  };

  // 이동 요청은 렌더 뒤에 처리한다 — 구조화 전환이 끝나야 span·단락이 DOM 에 있다.
  useEffect(() => {
    if (!focusRequest || !body.current) return;
    if (focusRequest.kind === 'paragraph') {
      const el = body.current.querySelector<HTMLElement>(`[data-paragraph-id="${focusRequest.id}"]`);
      el?.querySelector<HTMLElement>('.record-paragraph-title')?.scrollIntoView({ block: 'start' });
      const first = analysis?.analysis?.body?.record.paragraphs.find((p) => p.id === focusRequest.id)?.spans[0];
      if (first) selectSpan(first);
    } else {
      const el = body.current.querySelector<HTMLElement>(`[data-span-id="${focusRequest.id}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus();
      selectSpan(focusRequest.id);
    }
    setFocusRequest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, structured, analysis]);

  // 백링크로 연 회차 — 분석이 오면 그 span 을 고르고 그 자리로 간다(한 번만).
  useEffect(() => {
    if (!analysis || !initialSpan || appliedSpan.current === initialSpan) return;
    appliedSpan.current = initialSpan;
    if (!isTranscriptSpan(initialSpan)) setStructured(true);
    setFocusRequest({ kind: 'span', id: initialSpan });
  }, [analysis, initialSpan]);

  // 키워드 칩으로 연 팝업 — 열자마자 백링크 목록을 띄운다(한 번만).
  useEffect(() => {
    if (!backlinkKeyword || appliedKeyword.current === backlinkKeyword) return;
    appliedKeyword.current = backlinkKeyword;
    openBacklinks(backlinkKeyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backlinkKeyword]);

  // 구조화 보기는 **승인된 분석**에만 선다. 인테이크는 잠근 작성 화면 그대로라 전환이 없다.
  const approved = analysis?.analysis?.status === 'approved' ? analysis.analysis.body : null;
  const canStructure = approved !== null && approved !== undefined && rec?.kind !== 'intake';

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
      <div className="analysis-split" ref={body}>
        <div className="original-body">
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
                <>
                  {canStructure && (
                    <div className="info-tabs" data-cols="2" role="tablist" aria-label="수기 보기">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={!structured}
                        className="wire-step"
                        onClick={() => setStructured(false)}
                      >
                        원문 그대로
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={structured}
                        className="wire-step"
                        onClick={() => setStructured(true)}
                      >
                        구조화
                      </button>
                    </div>
                  )}
                  {structured && approved ? (
                    <StructuredRecordView
                      record={approved.record}
                      spans={analysis?.spans ?? []}
                      documents={analysis?.documents ?? []}
                      annotationsVisible
                      keywords={approved.keywords}
                      onSpanClick={selectSpan}
                      selectedSpan={selectedSpan}
                      onKeywordClick={openBacklinks}
                    />
                  ) : (
                    <RecordScreen
                      caseId={caseId}
                      sessionId={sessionId}
                      embedded
                      onSaved={() => {
                        onSaved?.();
                        onClose();
                      }}
                    />
                  )}
                </>
              )}
            </section>
            <section className="original-col" data-part="voice" tabIndex={-1} aria-label="녹음 전사 기록">
              <h2 className="original-col-head">녹음 전사 기록</h2>
              <Voice
                sessionId={sessionId}
                analysis={analysis}
                selectedSpan={selectedSpan}
                onSelectSpan={selectSpan}
                filter={filter}
                onToggleFilter={() => setFilter((f) => !f)}
              />
            </section>
          </div>
        </div>
        <ContrastPanel {...panel} onGoToParagraph={goToParagraph} onGoToBacklink={goToBacklink} />
      </div>
    </Dialog>
  );
}
