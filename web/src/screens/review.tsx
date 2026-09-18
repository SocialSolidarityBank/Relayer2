// AI 정리 검토·승인 화면 (RQ 21). v6 초안 계약으로 갈았다(2026-09-18 Q) — 사람이 고치는 건
// 요약 항목 문자열·과제·질문뿐이고, 원문 span·01 구조·키워드는 건드리지 않는다.
// 고친 문자열이 참조 원문과 어긋나면 승인 때 서버가 거절한다 — 그 말을 그대로 보인다.
import { useEffect, useState } from 'react';
import {
  approveAnalysis,
  getAnalysis,
  getAnalysisDraft,
  getCaseDetail,
  makeAnalysisDraft,
  CHANGE_SUBSECTIONS,
  CHANGE_SUBSECTION_LABEL,
  type AnalysisRevision,
  type AnalysisView,
  type CaseDetail,
  type Dialogue,
  type PromiseResultItem,
  type SessionSummary,
  type SummaryItem,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Fold,
  FormActions,
  LineList,
  ParticipantHero,
  withDraft,
  type Line,
} from '../ui.tsx';
import { SessionSummaryView } from '../session-summary.tsx';
import { StructuredRecordView } from '../structured-record.tsx';
import { TranscriptView } from '../transcript-view.tsx';

const MASK_LABEL: Record<string, string> = {
  name: '이름',
  phone: '전화',
  email: '이메일',
  rrn: '주민번호',
  card: '카드번호',
  account: '계좌번호',
};

const SUBSECTION_NO = ['①', '②', '③'] as const;

/** 한 문자열만 고치는 칸 — 라벨은 접근성 이름으로만 둔다(구역 제목이 이미 말한다). */
const EditText = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="wire-input-box" data-control="textarea">
    <textarea aria-label={label} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const EditItems = ({ items, onItems }: { items: SummaryItem[]; onItems: (items: SummaryItem[]) => void }) => (
  <ul className="seq-list">
    {items.map((item, i) => (
      <li key={i}>
        <EditText
          label={`항목 ${i + 1}`}
          value={item.text}
          onChange={(v) => onItems(items.map((x, j) => (j === i ? { ...x, text: v } : x)))}
        />
      </li>
    ))}
  </ul>
);

const EditPromise = ({ item, onItem }: { item: PromiseResultItem; onItem: (x: PromiseResultItem) => void }) => (
  <li>
    <EditText label="약속" value={item.promise} onChange={(v) => onItem({ ...item, promise: v })} />
    <EditText label="실제 결과" value={item.result} onChange={(v) => onItem({ ...item, result: v })} />
    {item.changes.map((c, i) => (
      <div key={i}>
        <EditText
          label={`변화 전 ${i + 1}`}
          value={c.before}
          onChange={(v) => onItem({ ...item, changes: item.changes.map((x, j) => (j === i ? { ...x, before: v } : x)) })}
        />
        <EditText
          label={`변화 후 ${i + 1}`}
          value={c.after}
          onChange={(v) => onItem({ ...item, changes: item.changes.map((x, j) => (j === i ? { ...x, after: v } : x)) })}
        />
        <EditText
          label={`의미 ${i + 1}`}
          value={c.meaning ?? ''}
          onChange={(v) =>
            onItem({ ...item, changes: item.changes.map((x, j) => (j === i ? { ...x, meaning: v || undefined } : x)) })
          }
        />
      </div>
    ))}
    {item.conclusion != null && (
      <EditText label="결론" value={item.conclusion} onChange={(v) => onItem({ ...item, conclusion: v })} />
    )}
  </li>
);

/** 새로 드러난 것·새로운 가능성 — 대화 두 줄과 내용 줄들을 그대로 고친다. */
const EditDialogueLines = <T extends { dialogue?: Dialogue; lines: string[] }>({
  item,
  onItem,
}: {
  item: T;
  onItem: (x: T) => void;
}) => (
  <li>
    {item.dialogue?.worker != null && (
      <EditText
        label="실무자"
        value={item.dialogue.worker}
        onChange={(v) => onItem({ ...item, dialogue: { ...item.dialogue, worker: v } })}
      />
    )}
    {item.dialogue?.participant != null && (
      <EditText
        label="당사자"
        value={item.dialogue.participant}
        onChange={(v) => onItem({ ...item, dialogue: { ...item.dialogue, participant: v } })}
      />
    )}
    {item.lines.map((l, i) => (
      <EditText
        key={i}
        label={`내용 ${i + 1}`}
        value={l}
        onChange={(v) => onItem({ ...item, lines: item.lines.map((x, j) => (j === i ? v : x)) })}
      />
    ))}
  </li>
);

/**
 * 요약 편집 — `SessionSummaryView` 와 같은 구역 순서를 유지하되 항목 문자열이 입력칸이 된다.
 * span·goal·구조는 그대로 둔다(고치면 근거가 깨진다 — 서버 검증이 잡는다).
 */
function EditableSummary({ summary, onChange }: { summary: SessionSummary; onChange: (next: SessionSummary) => void }) {
  const patch = (next: Partial<SessionSummary>) => onChange({ ...summary, ...next });
  const patchChanges = (next: Partial<SessionSummary['changes']>) =>
    onChange({ ...summary, changes: { ...summary.changes, ...next } });
  const filled = CHANGE_SUBSECTIONS.filter((k) => summary.changes[k].length > 0);
  return (
    <div className="seq-sections" data-cols="2">
      {summary.core.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="ai">
            이번 상담의 핵심
          </h3>
          <EditItems items={summary.core} onItems={(core) => patch({ core })} />
        </section>
      )}
      {filled.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="change">
            이번 회차에서 확인된 변화
          </h3>
          {filled.map((key, i) => (
            <div className="summary-subsection" key={key}>
              <h4 className="summary-subsection-title">
                {SUBSECTION_NO[i]} {CHANGE_SUBSECTION_LABEL[key]}
              </h4>
              <ul className="seq-list">
                {key === 'promise_result' &&
                  summary.changes.promise_result.map((item, j) => (
                    <EditPromise
                      key={j}
                      item={item}
                      onItem={(x) =>
                        patchChanges({ promise_result: summary.changes.promise_result.map((y, k) => (k === j ? x : y)) })
                      }
                    />
                  ))}
                {key === 'newly_revealed' &&
                  summary.changes.newly_revealed.map((item, j) => (
                    <EditDialogueLines
                      key={j}
                      item={item}
                      onItem={(x) =>
                        patchChanges({ newly_revealed: summary.changes.newly_revealed.map((y, k) => (k === j ? x : y)) })
                      }
                    />
                  ))}
                {key === 'new_possibility' &&
                  summary.changes.new_possibility.map((item, j) => (
                    <EditDialogueLines
                      key={j}
                      item={item}
                      onItem={(x) =>
                        patchChanges({ new_possibility: summary.changes.new_possibility.map((y, k) => (k === j ? x : y)) })
                      }
                    />
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {summary.follow_up.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="warn">
            확인필요
          </h3>
          <EditItems items={summary.follow_up} onItems={(follow_up) => patch({ follow_up })} />
        </section>
      )}
      {summary.completed.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="state">
            완료·해결
          </h3>
          <EditItems items={summary.completed} onItems={(completed) => patch({ completed })} />
        </section>
      )}
    </div>
  );
}

export function ReviewScreen({ caseId, sessionId }: { caseId: number; sessionId: number }) {
  const [draft, setDraft] = useState<AnalysisRevision | 'none' | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [view, setView] = useState<AnalysisView | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState<SessionSummary | null>(null);
  const [tasks, setTasks] = useState<Line[]>([]);
  const [taskDraft, setTaskDraft] = useState<Line>({ text: '' });
  const [questions, setQuestions] = useState<Line[]>([]);
  const [questionDraft, setQuestionDraft] = useState<Line>({ text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (next: AnalysisRevision | 'none') => {
    setDraft(next);
    setEditing(false);
    if (next === 'none') return;
    setEditSummary(next.body?.summary ?? null);
    setTasks((next.body?.tasks ?? []).map((text) => ({ text })));
    setQuestions((next.body?.questions ?? []).map((text) => ({ text })));
  };

  useEffect(() => {
    void getAnalysisDraft(sessionId).then(load);
    void getCaseDetail(caseId).then(setDetail);
    // 원문 문서·span 은 analysis 뷰가 준다 — 초안 본문에는 텍스트가 없다(좌표뿐).
    void getAnalysis(sessionId)
      .then(setView)
      .catch(() => undefined);
  }, [caseId, sessionId]);

  const run = async (fn: () => Promise<AnalysisRevision>) => {
    setBusy(true);
    setError(null);
    try {
      load(await fn());
    } catch (e) {
      // 409(새 초안 도착·원본 바뀜)든 400(검증 실패)이든 서버 문장이 무엇을 해야 하는지 말한다.
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(false);
    }
  };

  if (draft === null) return <p className="empty">불러오는 중</p>;

  const masked = draft === 'none' ? [] : Object.entries(draft.mask_hits);
  const seq = detail?.sessions.find((x) => x.id === sessionId)?.seq ?? null;
  const body = draft === 'none' ? null : draft.body;

  return (
    <>
      {/* 당사자 카드가 머리다(2026-09-17 Q 시안). AI 정리 상태는 배지가 아니라 값으로 내려간다
          — 당사자 카드에는 배지를 두지 않는다(CCC 2026-09-08). */}
      <ParticipantHero
        name={detail?.participant.name ?? null}
        pseudonym={detail?.pseudonym ?? '확인 중'}
        details={[
          ['ID', detail?.pseudonym ?? '확인 중'],
          ['참여중인 사업', `${detail?.case.program_name ?? '확인 중'}${seq ? `, ${seq}회차` : ''}`],
          ['연락처', detail?.participant.phone ?? ''],
          ['이메일', detail?.participant.email ?? ''],
        ]}
        actions={
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
        }
      />

      <div className="wire-container">
        {draft === 'none' ? (
          <Card title="AI 정리" tone="ai">
            <Empty>정리한 것 없음</Empty>
            <FormActions>
              {error && <ErrorText>{error}</ErrorText>}
              <Button variant="primary" disabled={busy} onClick={() => void run(() => makeAnalysisDraft(sessionId))}>
                {busy ? '정리 중…' : 'AI로 정리하기'}
              </Button>
            </FormActions>
          </Card>
        ) : (
          <>
            {draft.status === 'failed' && (
              <Card title="AI 정리" tone="warn">
                {/* 실패 사유는 서버가 적은 그대로다 — 화면이 번역하지 않는다. */}
                <ErrorText>{draft.error ?? '정리 실패'}</ErrorText>
                <FormActions>
                  {error && <ErrorText>{error}</ErrorText>}
                  <Button variant="primary" disabled={busy} onClick={() => void run(() => makeAnalysisDraft(sessionId))}>
                    {busy ? '정리 중…' : 'AI 정리 다시 하기'}
                  </Button>
                </FormActions>
              </Card>
            )}
            {body && (
              <>
                <Card
                  title="요약"
                  tone="ai"
                  action={
                    <Button onClick={() => setEditing((e) => !e)}>{editing ? '보기' : '수정'}</Button>
                  }
                >
                  {editing && editSummary ? (
                    <EditableSummary summary={editSummary} onChange={setEditSummary} />
                  ) : (
                    <SessionSummaryView
                      summary={editSummary}
                      keywords={body.keywords}
                      override={body.summary_override}
                      sessionSeq={seq ?? undefined}
                    />
                  )}
                </Card>

                {view && (
                  <Card
                    title="구조화 기록"
                    tone="ai"
                    hint={`연결 ${body.links.length}건 · 불일치 ${body.discrepancies.length}건`}
                  >
                    <StructuredRecordView
                      record={body.record}
                      spans={view.spans}
                      documents={view.documents}
                      annotationsVisible
                      keywords={[]}
                    />
                  </Card>
                )}

                {view && (
                  <Card title="녹음 전사" tone="ai">
                    <TranscriptView
                      spans={view.spans}
                      documents={view.documents}
                      links={body.links}
                      discrepancies={body.discrepancies}
                      record={body.record}
                      filterDiscrepancies={false}
                      transcriptStatus={view.transcript?.status ?? null}
                      recordingsWithoutTranscript={view.transcript?.recordings_without_transcript ?? 0}
                    />
                  </Card>
                )}

                <Card title="수행할 과제" tone="ai" hint="승인 시 다음 상담의 확인할 과제로 이동">
                  <LineList
                    id="draft-task"
                    label="수행할 과제"
                    placeholder="예: 채무 내역서 떼어 오기"
                    lines={tasks}
                    draft={taskDraft}
                    onDraft={setTaskDraft}
                    onChange={setTasks}
                  />
                </Card>

                <Card title="다음에 물어볼 것">
                  <LineList
                    id="draft-question"
                    label="다음에 물어볼 것"
                    placeholder="예: 통원 주기가 어떻게 되는지"
                    lines={questions}
                    draft={questionDraft}
                    onDraft={setQuestionDraft}
                    onChange={setQuestions}
                  />
                </Card>

                <Fold
                  title="마스킹"
                  desc={
                    masked.length === 0
                      ? '마스킹한 값 없음'
                      : masked.map(([kind, n]) => `${MASK_LABEL[kind] ?? kind} ${n}건`).join(', ')
                  }
                >
                  <p className="panel-meta">모델 {draft.model}</p>
                </Fold>

                <FormActions>
                  {error && <ErrorText>{error}</ErrorText>}
                  {/* 승인 뒤엔 그 사실이 보여야 한다(2026-09-18 UI-7). 초안 status 가 곧 그 신호다. */}
                  {draft.status === 'approved' && !busy && <Badge>승인 완료</Badge>}
                  <Button disabled={busy} onClick={() => void run(() => makeAnalysisDraft(sessionId))}>
                    AI 정리 다시 하기
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        approveAnalysis(sessionId, {
                          draft_id: draft.id,
                          source_versions: draft.source_versions,
                          edits: {
                            summary: editSummary ?? undefined,
                            tasks: withDraft(tasks, taskDraft).map((t) => t.text),
                            questions: withDraft(questions, questionDraft).map((q) => q.text),
                          },
                        }),
                      )
                    }
                  >
                    {busy ? '처리 중…' : draft.status === 'approved' ? '다시 승인' : '승인'}
                  </Button>
                </FormActions>

                <p className="panel-meta">
                  승인해도 원문은 바뀌지 않음, <a href={`#/cases/${caseId}/info`}>당사자 정보</a>의 회차별 요약에서 확인
                </p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
