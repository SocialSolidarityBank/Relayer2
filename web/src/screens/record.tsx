// 상담 기록하기 — 6구획. 유일한 필수는 수기 메모다(SPEC §1, GLOSSARY §6-2).
// 구획이 곧 카드 분류다. 실무자는 문장마다 분류를 고르지 않는다.
// 레이아웃은 CCC 기록 레일 계약: wire-container rail-grid record-grid > .record-side + .record-main.
import { useEffect, useState } from 'react';
import {
  getBriefing,
  getCase,
  planSession,
  recordSession,
  type Briefing,
  type CaseView,
  type NewSessionInput,
  type OutcomeInput,
} from '../api.ts';
import { LIFE_AREAS } from '../areas.ts';
import { Button, Card, Choice, ChoiceGroup, Empty, ErrorText, Field, FormActions, Item, PageHeader } from '../ui.tsx';
import { METHODS } from '../vocab.ts';

/** `datetime-local` 이 바로 먹는 지역시각 문자열. 지금 시각을 분 단위로 자른다. */
function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type Line = { text: string; area?: string };

function LineList({
  id,
  label,
  placeholder,
  withArea,
  lines,
  onChange,
}: {
  /** id 는 공백 없는 슬러그다. 라벨을 그대로 쓰면 유효하지 않은 id 가 된다. */
  id: string;
  label: string;
  placeholder: string;
  withArea?: boolean;
  lines: Line[];
  onChange: (next: Line[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [area, setArea] = useState<string>(LIFE_AREAS[0].key);
  const add = () => {
    if (!draft.trim()) return;
    onChange([...lines, withArea ? { text: draft.trim(), area } : { text: draft.trim() }]);
    setDraft('');
  };
  return (
    <>
      {withArea && (
        <Field label="영역" htmlFor={`${id}-area`} control="select">
          <select id={`${id}-area`} value={area} onChange={(e) => setArea(e.target.value)}>
            {LIFE_AREAS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="wire-field-with-action">
        <Field label={label} htmlFor={`${id}-input`}>
          <input
            id={`${id}-input`}
            type="text"
            aria-label={label}
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Button onClick={add}>추가</Button>
      </div>
      {lines.map((line, i) => (
        <div className="wire-repeat-card" key={`${line.text}-${i}`}>
          <Item
            title={`${withArea ? `${LIFE_AREAS.find((a) => a.key === line.area)?.label} · ` : ''}${line.text}`}
            action={<Button onClick={() => onChange(lines.filter((_, j) => j !== i))}>지우기</Button>}
          />
        </div>
      ))}
    </>
  );
}

export function RecordScreen({ caseId }: { caseId: number }) {
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
  const [outcomes, setOutcomes] = useState<Record<number, OutcomeInput>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [b, v] = await Promise.all([getBriefing(caseId), getCase(caseId)]);
      setBriefing(b);
      setView(v);
      setOverallGoal(v.case.overall_goal ?? '');
      // 기록 대상은 다가오는 예정 회차다. 상담 일정 등록이 곧 그 회차를 만든다.
      setPlace(v.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0]?.place ?? '');
    })();
  }, [caseId]);

  if (!briefing || !view) return <p className="empty">불러오는 중이에요.</p>;

  // 예정 회차가 있으면 그것을 기록한다. 없으면 여기서 일시·상담 방식을 적고 회차를 만든다.
  // 일정을 미리 잡지 않고 만난 상담(갑작스러운 방문·전화)이 기록되지 못하면 안 된다.
  const session = view.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0];
  const seq = session?.seq ?? Math.max(0, ...view.sessions.map((s) => s.seq)) + 1;
  const inPerson = (session?.method ?? method) === 'in_person';

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
      // 예정 회차가 없으면 지금 적은 일시로 회차를 먼저 연다.
      const sessionId =
        session?.id ??
        (
          await planSession(caseId, {
            scheduled_at: new Date(heldAt).toISOString(),
            method,
            place: inPerson && place ? place : undefined,
          })
        ).session_id;

      await recordSession(sessionId, {
        held_at: new Date(heldAt).toISOString(),
        memo,
        place: inPerson && place ? place : undefined,
        next_goal_text: nextGoal.trim() || null,
        overall_goal: overallGoal.trim() || null,
        cards: [
          ...tasks.map((t) => ({ kind: 'promise', text: t.text, section: 'promise' })),
          ...questions.map((q) => ({ kind: 'question', text: q.text, section: 'question' })),
          ...changes.map((c) => ({ kind: 'fact', text: c.text, section: 'change', area: c.area })),
          ...(opinion.trim() ? [{ kind: 'judgment', text: opinion.trim(), section: 'judgment' }] : []),
        ],
        outcomes: Object.values(outcomes),
      });
      window.location.hash = `#/cases/${caseId}/briefing`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const openTasks = briefing.open_tasks?.items ?? [];
  const openQuestions = briefing.today_questions ?? [];

  return (
    <>
      <PageHeader
        title="상담 기록하기"
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
                  <ChoiceGroup legend="결과">
                    {(
                      [
                        ['done', '했음'],
                        ['in_progress', '진행 중'],
                      ] as const
                    ).map(([result, label]) => (
                      <Choice
                        key={result}
                        type="radio"
                        name={`outcome-${t.card_id}`}
                        label={label}
                        checked={outcomes[t.card_id]?.result === result}
                        onChange={() => setOutcome(t.card_id, { card_id: t.card_id, result })}
                      />
                    ))}
                    <Choice
                      type="radio"
                      name={`outcome-${t.card_id}`}
                      label="못 함 · 계속"
                      checked={outcomes[t.card_id]?.result === 'not_done' && outcomes[t.card_id]?.follow === 'continue'}
                      onChange={() => setOutcome(t.card_id, { card_id: t.card_id, result: 'not_done', follow: 'continue' })}
                    />
                    <Choice
                      type="radio"
                      name={`outcome-${t.card_id}`}
                      label="못 함 · 그만둠"
                      checked={outcomes[t.card_id]?.follow === 'stop'}
                      onChange={() => {
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
                  </ChoiceGroup>
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
        </aside>

        <main className="record-main">
          {!session && (
            <Card title="상담 일시와 상담 방식" hint="잡아 둔 일정이 없어요. 언제 만났는지 여기서 적으면 이 회차가 만들어져요.">
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
            </Card>
          )}

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
            {inPerson && (
              <Field label="상담 장소" htmlFor="place">
                <input id="place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} />
              </Field>
            )}
          </Card>

          <Card title="2. 수행할 과제" hint="다음 상담의 확인할 과제로 올라가요.">
            <LineList id="task" label="수행할 과제" placeholder="예: 채무 내역서 준비하기" lines={tasks} onChange={setTasks} />
          </Card>

          <Card title="3. 다음에 물어볼 것" hint="다음 상담의 오늘 물어볼 것으로 올라가요.">
            <LineList id="question" label="다음에 물어볼 것" placeholder="예: 가족 지원 여부" lines={questions} onChange={setQuestions} />
          </Card>

          <Card title="4. 달라진 것" hint="비워 두면 이번 회차 미확인으로 남아요. 변화 없음이 아니에요.">
            <LineList
              id="change"
              label="달라진 것"
              placeholder="예: 월세 계약을 6개월 연장함"
              withArea
              lines={changes}
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
              {saving ? '저장 중…' : '저장'}
            </Button>
          </FormActions>
        </main>
      </div>
    </>
  );
}
