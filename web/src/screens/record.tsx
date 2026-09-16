// 상담 기록하기 — 6구획. 유일한 필수는 수기 메모다(SPEC §1, GLOSSARY §6-2).
// 구획이 곧 카드 분류다. 실무자는 문장마다 분류를 고르지 않는다.
// 레이아웃은 CCC 기록 레일 계약: wire-container rail-grid record-grid > .record-side + .record-main.
import { useEffect, useState } from 'react';
import {
  getBriefing,
  getCase,
  getSessionRecord,
  planSession,
  recordSession,
  type Briefing,
  type CaseView,
  type NewSessionInput,
  type OutcomeInput,
  type SessionRecord,
} from '../api.ts';
import {
  Button,
  Card,
  Choice,
  ChoiceGroup,
  Empty,
  ErrorText,
  Field,
  FormActions,
  Item,
  LineList,
  PageHeader,
  withDraft,
  type Line,
} from '../ui.tsx';
import { METHODS } from '../vocab.ts';

/** `datetime-local` 이 바로 먹는 지역시각 문자열. 지금 시각을 분 단위로 자른다. */
function localNow(): string {
  return toLocalInput(new Date().toISOString());
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** 과제 결과 3종(2026-09-15 Q). 화면 말과 저장값을 한 곳에서 잇는다. */
const TASK_RESULTS: ReadonlyArray<{ label: string; value: OutcomeInput }> = [
  { label: '진행 전', value: { card_id: 0, result: 'not_done', follow: 'continue' } },
  { label: '진행 중', value: { card_id: 0, result: 'in_progress' } },
  { label: '완료', value: { card_id: 0, result: 'done' } },
];

const taskResultLabel = (o: OutcomeInput | undefined): string | null => {
  if (!o) return null;
  if (o.follow === 'stop') return '그만둠';
  if (o.result === 'done') return '완료';
  if (o.result === 'in_progress') return '진행 중';
  if (o.result === 'not_done') return '진행 전';
  return null;
};

export function RecordScreen({ caseId, sessionId: editingId }: { caseId: number; sessionId?: number }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [view, setView] = useState<CaseView | null>(null);
  const [memo, setMemo] = useState('');
  const [tasks, setTasks] = useState<Line[]>([]);
  const [questions, setQuestions] = useState<Line[]>([]);
  const [changes, setChanges] = useState<Line[]>([]);
  const [opinion, setOpinion] = useState('');
  const [nextGoal, setNextGoal] = useState('');
  const [overallGoal, setOverallGoal] = useState('');
  const [place, setPlace] = useState('');
  // 예정 회차가 없을 때 이 자리에서 바로 적는 일시·상담 방식.
  const [heldAt, setHeldAt] = useState(localNow());
  const [method, setMethod] = useState<NewSessionInput['method']>('in_person');
  // 종결 상담(요구 5). 일정에서 미리 골랐으면 이어받고, 여기서 바꿀 수도 있다.
  const [isClosing, setIsClosing] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, OutcomeInput>>({});
  const [taskDraft, setTaskDraft] = useState<Line>({ text: '' });
  const [questionDraft, setQuestionDraft] = useState<Line>({ text: '' });
  const [changeDraft, setChangeDraft] = useState<Line>({ text: '' });
  // 저장해 둔 회차를 고쳐 쓰는 중이면 그 회차. 새로 쓰는 중이면 null.
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * 예정 회차가 없어 이 화면이 방금 연 회차(2026-09-16 검수).
   *
   * 저장은 두 걸음이다 — 회차를 열고, 거기에 기록한다. 둘째가 실패했는데 첫째를 기억하지
   * 않으면 다시 누를 때마다 **빈 예정 회차가 하나씩 쌓인다.** 동의가 없어 409 가 나는
   * 자리에서 실제로 그렇게 됐다.
   */
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 늦게 온 응답이 새 화면을 덮지 않게 한다(2026-09-16 검수). 고쳐 쓰기 요청이 날아간 뒤
    // `상담 기록하기` 로 넘어가면, 먼저 끝난 새 화면 위에 이전 응답이 내려앉아
    // `editing` 을 지난 회차로 되돌린다 — 그대로 저장하면 그 회차를 덮어쓴다.
    let live = true;
    void (async () => {
      const [b, v, rec] = await Promise.all([
        getBriefing(caseId),
        getCase(caseId),
        editingId ? getSessionRecord(editingId) : Promise.resolve(null),
      ]);
      if (!live) return;
      setBriefing(b);
      setView(v);
      setOverallGoal(rec?.overall_goal ?? v.case.overall_goal ?? '');

      if (rec) {
        setEditing(rec);
        setMemo(rec.memo ?? '');
        setPlace(rec.place ?? '');
        setHeldAt(rec.held_at ? toLocalInput(rec.held_at) : localNow());
        setMethod((rec.method as NewSessionInput['method']) ?? 'in_person');
        setIsClosing(rec.is_closing);
        setNextGoal(rec.next_goal_text ?? '');
        setTasks(rec.cards.filter((c) => c.kind === 'promise').map((c) => ({ text: c.text })));
        setQuestions(rec.cards.filter((c) => c.kind === 'question').map((c) => ({ text: c.text })));
        setChanges(
          rec.cards.filter((c) => c.kind === 'fact').map((c) => ({ text: c.text, area: c.area ?? undefined })),
        );
        setOpinion(rec.cards.find((c) => c.kind === 'judgment')?.text ?? '');
        // 지난번에 매긴 결과를 그대로 다시 세운다. 안 그러면 고쳐 쓰기가 전부 미확인으로 덮는다.
        const prior: Record<number, OutcomeInput> = {};
        for (const c of rec.open_cards) {
          if (!c.result || c.result === 'unchecked') continue;
          prior[c.card_id] = {
            card_id: c.card_id,
            result: c.result as OutcomeInput['result'],
            follow: (c.follow as OutcomeInput['follow']) ?? undefined,
            reason: c.reason ?? undefined,
          };
        }
        setOutcomes(prior);
        return;
      }

      // **고쳐 쓰던 회차를 반드시 놓는다**(2026-09-16 검수). 이 화면은 고쳐 쓰기와 새 기록이
      // 같은 부품이라, 고쳐 쓰기를 열어 둔 채 `상담 기록하기` 로 넘어오면 `editing` 이 남는다.
      // 그러면 새로 쓴 글이 PATCH 로 **지난 회차를 덮어쓴다** — 지운 기록은 돌아오지 않는다.
      setEditing(null);

      // 기록 대상은 다가오는 예정 회차다. 상담 일정 등록이 곧 그 회차를 만든다.
      const planned = v.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0];
      // 고쳐 쓰다 넘어온 경우 앞 회차 글이 그대로 남아 있다. 칸을 전부 비우고 새로 세운다.
      // `추가` 를 안 누른 초안 줄(taskDraft 등)도 비운다 — 저장할 때 함께 실려 간다.
      setMemo('');
      setNextGoal('');
      setTasks([]);
      setQuestions([]);
      setChanges([]);
      setOpinion('');
      setOutcomes({});
      setTaskDraft({ text: '' });
      setQuestionDraft({ text: '' });
      setChangeDraft({ text: '' });
      setPlace(planned?.place ?? '');
      setIsClosing(planned?.is_closing ?? false);
      setMethod((planned?.method as NewSessionInput['method']) ?? 'in_person');
      setHeldAt(planned?.scheduled_at ? toLocalInput(planned.scheduled_at) : localNow());
    })();
    return () => {
      live = false;
    };
  }, [caseId, editingId]);

  if (!briefing || !view) return <p className="empty">불러오는 중이에요.</p>;
  if (editingId && !editing) return <p className="empty">불러오는 중이에요.</p>;

  // 예정 회차가 있으면 그것을 기록한다. 없으면 여기서 일시·상담 방식을 적고 회차를 만든다.
  // 일정을 미리 잡지 않고 만난 상담(갑작스러운 방문·전화)이 기록되지 못하면 안 된다.
  const session = editing
    ? { id: editing.session_id, seq: editing.seq, method: editing.method, place: editing.place }
    : view.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0];
  const seq = session?.seq ?? Math.max(0, ...view.sessions.map((s) => s.seq)) + 1;
  const inPerson = method === 'in_person';

  const setOutcome = (card_id: number, value: OutcomeInput | null) =>
    setOutcomes((prev) => {
      const next = { ...prev };
      if (value) next[card_id] = value;
      else delete next[card_id];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // 예정 회차가 없으면 지금 적은 일시로 회차를 먼저 연다. 방금 연 것이 있으면 그것을 쓴다.
      let targetId = session?.id ?? openedId;
      if (!targetId) {
        const opened = await planSession(caseId, {
          scheduled_at: new Date(heldAt).toISOString(),
          method,
          place: inPerson && place ? place : undefined,
          is_closing: isClosing,
        });
        targetId = opened.session_id;
        setOpenedId(targetId);
      }

      await recordSession(targetId, {
        held_at: new Date(heldAt).toISOString(),
        method,
        is_closing: isClosing,
        memo,
        place: inPerson && place ? place : undefined,
        next_goal_text: nextGoal.trim() || null,
        overall_goal: overallGoal.trim() || null,
        cards: [
          // `추가`를 누르지 않고 적어만 둔 줄도 함께 저장한다.
          ...withDraft(tasks, taskDraft).map((t) => ({ kind: 'promise', text: t.text, section: 'promise' })),
          ...withDraft(questions, questionDraft).map((q) => ({ kind: 'question', text: q.text, section: 'question' })),
          ...withDraft(changes, changeDraft).map((c) => ({
            kind: 'fact',
            text: c.text,
            section: 'change',
            area: c.area,
          })),
          ...(opinion.trim() ? [{ kind: 'judgment', text: opinion.trim(), section: 'judgment' }] : []),
        ],
        outcomes: Object.values(outcomes),
      });
      window.location.hash = isClosing ? `#/cases/${caseId}/close` : `#/cases/${caseId}/briefing`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const openTasks = briefing.open_tasks?.items ?? [];
  const openQuestions = briefing.today_questions ?? [];

  // 레일에 살아 있는 과제를 오른쪽에 또 적었나. 띄어쓰기만 다른 것도 같은 것으로 본다.
  const flatten = (s: string) => s.replace(/\s+/g, '');
  const duplicateTasks = withDraft(tasks, taskDraft)
    .map((t) => t.text.trim())
    .filter((text) => text && openTasks.some((o) => flatten(o.text) === flatten(text)));

  return (
    <>
      <PageHeader
        title={editing ? '상담 기록 고쳐 쓰기' : '상담 기록하기'}
        meta={`${briefing.participant_card.name ?? briefing.participant_card.pseudonym} · ${
          briefing.participant_card.program_name
        } · ${seq}회차`}
      />

      <div className="wire-container rail-grid record-grid" data-grid="true">
        <aside className="record-side">
          <Card title="확인할 과제" hint="누르지 않으면 이번에 확인 안 함으로 남고, 다음에 다시 올라와요.">
            {openTasks.length === 0 ? (
              <Empty>아직 없어요.</Empty>
            ) : (
              openTasks.map((t) => (
                <div className="wire-repeat-card" key={t.card_id}>
                  <Item
                    title={t.text}
                    desc={`${t.source_session_seq}회차${t.last_result === 'unchecked' ? ' · 지난 회차 미확인' : ''}`}
                  />
                  {/* 결과는 셋이다(2026-09-15 Q). 그만두는 것은 상태가 아니라 과제를 접는 일이라 따로 둔다. */}
                  <ChoiceGroup legend="결과">
                    {TASK_RESULTS.map(({ label, value }) => (
                      <Choice
                        key={label}
                        type="radio"
                        name={`outcome-${t.card_id}`}
                        label={label}
                        checked={taskResultLabel(outcomes[t.card_id]) === label}
                        onChange={() => setOutcome(t.card_id, { ...value, card_id: t.card_id })}
                      />
                    ))}
                  </ChoiceGroup>
                  <Choice
                    type="checkbox"
                    label="이 과제 그만두기"
                    hint="더 안 하기로 했을 때만. 다음 상담에 올라오지 않아요."
                    checked={outcomes[t.card_id]?.follow === 'stop'}
                    onChange={() => {
                      if (outcomes[t.card_id]?.follow === 'stop') {
                        setOutcome(t.card_id, null);
                        return;
                      }
                      const reason = window.prompt('그만두는 이유를 적어 주세요.');
                      if (reason?.trim())
                        setOutcome(t.card_id, {
                          card_id: t.card_id,
                          result: 'not_done',
                          follow: 'stop',
                          reason: reason.trim(),
                        });
                    }}
                  />
                </div>
              ))
            )}
          </Card>

          <Card title="오늘 물어볼 것">
            {openQuestions.length === 0 ? (
              <Empty>아직 없어요.</Empty>
            ) : (
              openQuestions.map((q) => (
                <div className="wire-repeat-card" key={q.card_id}>
                  <Item title={q.text} desc={`${q.source_session_seq}회차`} />
                  <ChoiceGroup legend="결과">
                    <Choice
                      type="checkbox"
                      name={`confirm-${q.card_id}`}
                      label="확인함"
                      checked={outcomes[q.card_id]?.result === 'confirmed'}
                      onChange={() =>
                        setOutcome(
                          q.card_id,
                          outcomes[q.card_id]?.result === 'confirmed' ? null : { card_id: q.card_id, result: 'confirmed' },
                        )
                      }
                    />
                  </ChoiceGroup>
                </div>
              ))
            )}
          </Card>
          {/* 종결 상담은 구획 하나를 차지할 일이 아니다. 레일 아래 체크 하나로 둔다(2026-09-15 Q). */}
          <Card title="종결 상담">
            <Choice
              type="checkbox"
              label="이번이 마지막 상담이에요"
              hint="저장하면 상담 종결 화면으로 이어져요. 저장에 실패하면 사례를 닫지 않아요."
              checked={isClosing}
              onChange={() => setIsClosing((v) => !v)}
            />
          </Card>
        </aside>

        <main className="record-main">
          {/* 일시·방식·장소는 한 묶음이다. 장소는 대면일 때만 나오고 방식 바로 아래에 붙는다(요구 14). */}
          <Card
            title="상담 일시와 상담 방식"
            hint={
              session
                ? '잡아 둔 일정이에요. 실제로 만난 시각이 다르면 여기서 고쳐요.'
                : '잡아 둔 일정이 없어요. 언제 만났는지 여기서 적으면 이 회차가 만들어져요.'
            }
          >
            <Field label="상담 일시" htmlFor="held-at" required>
              <input
                id="held-at"
                type="datetime-local"
                value={heldAt}
                onChange={(e) => setHeldAt(e.target.value)}
              />
            </Field>
            <ChoiceGroup legend="상담 방식">
              {METHODS.map((m) => (
                <Choice
                  key={m.key}
                  type="radio"
                  name="method"
                  label={m.label}
                  checked={method === m.key}
                  onChange={() => setMethod(m.key)}
                />
              ))}
            </ChoiceGroup>
            {inPerson && (
              <Field label="상담 장소" htmlFor="place" hint="대면일 때만 적어요.">
                <input id="place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} />
              </Field>
            )}
          </Card>

          <Card title="1. 상담 내용" hint="상담 내용만 적어도 저장할 수 있어요.">
            <Field label="상담 내용" htmlFor="memo" control="textarea" required>
              <textarea
                id="memo"
                rows={5}
                aria-label="상담 내용"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="오늘 나눈 이야기를 적어 주세요."
              />
            </Field>
          </Card>

          <Card title="2. 수행할 과제" hint="다음 상담의 확인할 과제로 올라가요.">
            <LineList
              id="task"
              label="수행할 과제"
              placeholder="예: 채무 내역서 준비하기"
              lines={tasks}
              draft={taskDraft}
              onDraft={setTaskDraft}
              onChange={setTasks}
            />
            {/*
              `진행 전`·`진행 중`은 그 자체로 "계속 간다"는 뜻이다. 그런데 같은 약속을 또 적는 사람이 있다
              (2026-09-15 예행연습에서 실제로 났다). 그러면 다음 다시보기의 확인할 과제에 같은 문구가 두 줄로 쌓인다.
              막지는 않는다 — 정말 따로 세고 싶을 수도 있다. 다만 겹친다는 사실은 알려 준다.
            */}
            {duplicateTasks.length > 0 && (
              <p className="panel-meta">
                왼쪽 확인할 과제에 이미 있어요: {duplicateTasks.join(' · ')}. 결과만 매기면 다음에도 올라와요.
              </p>
            )}
          </Card>

          <Card title="3. 다음에 물어볼 것" hint="다음 상담의 오늘 물어볼 것으로 올라가요.">
            <LineList
              id="question"
              label="다음에 물어볼 것"
              placeholder="예: 가족 지원 여부"
              lines={questions}
              draft={questionDraft}
              onDraft={setQuestionDraft}
              onChange={setQuestions}
            />
          </Card>

          <Card title="4. 달라진 것" hint="비워 두면 이번 회차 미확인으로 남아요. 변화 없음이 아니에요.">
            <LineList
              id="change"
              label="달라진 것"
              placeholder="예: 월세 계약을 6개월 연장함"
              withArea
              lines={changes}
              draft={changeDraft}
              onDraft={setChangeDraft}
              onChange={setChanges}
            />
          </Card>

          <Card title="5. 실무자 의견">
            <Field label="실무자 의견" htmlFor="opinion" control="textarea">
              <textarea
                id="opinion"
                rows={3}
                aria-label="실무자 의견"
                value={opinion}
                onChange={(e) => setOpinion(e.target.value)}
              />
            </Field>
          </Card>

          <Card title="6. 목표">
            <Field
              label="다음 상담 목표"
              htmlFor="next-goal"
              hint="다음 상담의 오늘 상담 목표로 표시돼요."
            >
              <input id="next-goal" type="text" value={nextGoal} onChange={(e) => setNextGoal(e.target.value)} />
            </Field>
            <Field label="전체 상담 목표" htmlFor="overall-goal" hint="고치면 이전 문구가 이력으로 남아요.">
              <input
                id="overall-goal"
                type="text"
                value={overallGoal}
                onChange={(e) => setOverallGoal(e.target.value)}
                placeholder="비워 두어도 괜찮아요"
              />
            </Field>
          </Card>

          <FormActions>
            {error && <ErrorText>{error}</ErrorText>}
            <Button
              variant="primary"
              disabled={!memo.trim() || (!session && !heldAt) || saving}
              onClick={() => void save()}
            >
              {/* 고쳐 쓰기 화면에서도 저장 버튼은 `저장`이다. 들어올 때 누른 버튼과 이름이 같으면
                  같은 일을 또 하는 줄 안다(2026-09-15 예행연습). 화면 제목이 이미 고쳐 쓰기라고 말한다. */}
              {saving ? '저장 중…' : isClosing ? '저장하고 종결로' : '저장'}
            </Button>
          </FormActions>
        </main>
      </div>
    </>
  );
}
