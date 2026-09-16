// AI가 정리한 내용 검토하기(P3, GLOSSARY §6-5).
// 버튼은 **승인 / 수정** 둘이다. 반려·재생성은 없다(요구 21).
// 수정본도 **별도 승인 전에는 초안**이다. 승인 전에는 어떤 것도 기록이 아니다.
import { useEffect, useState } from 'react';
import { approveDraft, getDraft, makeDraft, type Draft } from '../api.ts';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  FactChanges,
  Field,
  Fold,
  FormActions,
  LineList,
  PageHeader,
  withDraft,
  type Line,
} from '../ui.tsx';

const MASK_LABEL: Record<string, string> = {
  name: '이름',
  phone: '연락처',
  email: '이메일',
  rrn: '주민번호',
  card: '카드번호',
  account: '계좌번호',
};

export function ReviewScreen({ caseId, sessionId }: { caseId: number; sessionId: number }) {
  const [draft, setDraft] = useState<Draft | 'none' | null>(null);
  const [summary, setSummary] = useState('');
  const [changes, setChanges] = useState<Line[]>([]);
  const [changeDraft, setChangeDraft] = useState<Line>({ text: '' });
  const [tasks, setTasks] = useState<Line[]>([]);
  const [taskDraft, setTaskDraft] = useState<Line>({ text: '' });
  const [questions, setQuestions] = useState<Line[]>([]);
  const [questionDraft, setQuestionDraft] = useState<Line>({ text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (next: Draft | 'none') => {
    setDraft(next);
    if (next === 'none') return;
    setSummary(next.summary);
    setChanges(next.changes.map((text) => ({ text })));
    setTasks(next.tasks.map((text) => ({ text })));
    setQuestions(next.questions.map((text) => ({ text })));
  };

  useEffect(() => {
    void getDraft(sessionId).then(load);
  }, [sessionId]);

  const run = async (fn: () => Promise<Draft>) => {
    setBusy(true);
    setError(null);
    try {
      load(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : '하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  if (draft === null) return <p className="empty">불러오는 중이에요.</p>;

  const masked = draft !== 'none' ? Object.entries(draft.mask_hits) : [];

  return (
    <>
      <PageHeader
        title="AI가 정리한 내용 검토하기"
        meta={
          draft === 'none' ? (
            '아직 정리한 것이 없어요'
          ) : draft.status === 'approved' ? (
            <Badge tone="mint">승인함</Badge>
          ) : (
            <Badge>초안 · 승인 전에는 기록이 아니에요</Badge>
          )
        }
      />

      <div className="wire-container">
        {draft === 'none' ? (
          <Card title="AI 정리" hint="저장된 상담 자료만 씁니다. 보내기 전에 이름·연락처를 마스킹해요.">
            <Empty>아직 정리한 것이 없어요.</Empty>
            <FormActions>
              {error && <ErrorText>{error}</ErrorText>}
              <Button variant="primary" disabled={busy} onClick={() => void run(() => makeDraft(sessionId))}>
                {busy ? '정리 중…' : 'AI로 정리하기'}
              </Button>
            </FormActions>
          </Card>
        ) : (
          <>
            {/* 접힌 카드 둘(2026-09-16 Q). 사실관계 변화가 마스킹 자리로 올라오고, 마스킹은 그 아래 접힌다.
                요약이 먼저 눈에 들어와야 하므로 둘 다 닫아 둔다. */}
            <Fold
              title="내용 불일치"
              desc={
                draft.fact_changes.length > 0
                  ? `지난 회차와 어긋나는 사실 ${draft.fact_changes.length}건`
                  : '지난 회차와 어긋나는 사실 없음'
              }
            >
              <p className="panel-meta">
                지난 회차 자료와 견줘 달라진 사실만 골라 양쪽 원문을 그대로 보여 줘요. 어느 쪽이 맞는지는 판정하지 않아요.
              </p>
              <FactChanges items={draft.fact_changes} />
            </Fold>

            <Fold
              title="마스킹"
              desc={
                masked.length === 0
                  ? '마스킹한 값 없음'
                  : masked.map(([kind, n]) => `${MASK_LABEL[kind] ?? kind} ${n}건`).join(' · ')
              }
            >
              <p className="panel-meta">
                외부로 보내기 전에 무엇을 마스킹했는지예요. 마스킹한 값 자체는 어디에도 남기지 않아요.
              </p>
              <p className="panel-meta">모델 {draft.model}</p>
            </Fold>

            <Card title="요약" hint="사람이 고칠 수 있어요. 고쳐도 승인 전에는 초안이에요.">
              <Field label="요약" htmlFor="summary" control="textarea">
                <textarea
                  id="summary"
                  rows={4}
                  aria-label="요약"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </Field>
            </Card>

            <Card title="달라진 것" hint="지난 회차와 견줘 바뀐 것만이에요.">
              <LineList
                id="draft-change"
                label="달라진 것"
                placeholder="예: 연체 3건 → 4건"
                lines={changes}
                draft={changeDraft}
                onDraft={setChangeDraft}
                onChange={setChanges}
              />
            </Card>

            <Card title="수행할 과제" hint="승인하면 다음 상담의 확인할 과제로 올라가요.">
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

            <FormActions>
              {error && <ErrorText>{error}</ErrorText>}
              <Button disabled={busy} onClick={() => void run(() => makeDraft(sessionId))}>
                다시 정리
              </Button>
              <Button
                variant="primary"
                disabled={busy || !summary.trim()}
                onClick={() =>
                  void run(() =>
                    approveDraft(sessionId, {
                      summary: summary.trim(),
                      changes: withDraft(changes, changeDraft).map((c) => c.text),
                      tasks: withDraft(tasks, taskDraft).map((t) => t.text),
                      questions: withDraft(questions, questionDraft).map((q) => q.text),
                    }),
                  )
                }
              >
                {busy ? '처리 중…' : '승인'}
              </Button>
            </FormActions>

            <p className="panel-meta">
              승인해도 원문은 바뀌지 않아요. <a href={`#/cases/${caseId}/info`}>당사자 정보</a>에서 회차별 요약과
              함께 봐요.
            </p>
          </>
        )}
      </div>
    </>
  );
}
