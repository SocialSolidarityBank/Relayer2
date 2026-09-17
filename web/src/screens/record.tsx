// 상담 기록하기 — 사용자 피드백에 따른 다섯 구획. 수기 없이 녹음만 있는 회차도 기록이다.
// 구획이 곧 카드 분류다. 실무자는 문장마다 분류를 고르지 않는다.
// 레이아웃은 본문 5:5(2026-09-18 Q D2): wire-container rail-grid record-grid > .record-side(오른쪽 붙박이) + .record-main(왼쪽).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  getBriefing,
  getCaseDetail,
  getCase,
  getSessionRecord,
  startSession,
  recordSession,
  type Briefing,
  type CaseDetail,
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
  Fold,
  FormActions,
  Item,
  LineList,
  ParticipantHero,
  withDraft,
  type Line,
} from '../ui.tsx';
import { METHODS } from '../vocab.ts';
import { dateTimeFromIso, dateTimeToIso } from '../date-time.ts';
import { DateTimeInput } from '../date-time-input.tsx';
import { RecordingPanel, SessionAudio } from './session-audio.tsx';
import { TaskOwnerToggle } from '../task-owner.tsx';
import { OWNER_LABEL } from '../api.ts';

/** 지금 시각을 한국 시간의 날짜·시·분으로 표시하는 상담 일시 초깃값. */
const nowDateTime = () => dateTimeFromIso(new Date().toISOString());

/** 과제 결과 3종(2026-09-15 Q). 화면 말과 저장값을 한 곳에서 잇는다. */
const TASK_RESULTS: ReadonlyArray<{ label: string; value: OutcomeInput }> = [
  { label: '진행 전', value: { card_id: 0, result: 'not_done', follow: 'continue' } },
  { label: '진행 중', value: { card_id: 0, result: 'in_progress' } },
  { label: '완료', value: { card_id: 0, result: 'done' } },
];

/** 상태 어휘는 명사형이다(2026-09-18 Q): 진행 전 · 진행 중 · 완료 · 중단. 행동 체크박스 `그만두기`만 동사형. */
const taskResultLabel = (o: OutcomeInput | undefined): string | null => {
  if (!o) return null;
  if (o.follow === 'stop') return '중단';
  if (o.result === 'done') return '완료';
  if (o.result === 'in_progress') return '진행 중';
  if (o.result === 'not_done') return '진행 전';
  return null;
};

/** 닫힌 카드 한 줄의 꼬리. 과제는 완료·중단, 질문은 확인함. */
const closedLabel = (result: string | null, follow: string | null | undefined): string =>
  result === 'confirmed' ? '확인함' : follow === 'stop' ? '중단' : '완료';

export function RecordScreen({
  caseId,
  sessionId: editingId,
  startClosing = false,
}: {
  caseId: number;
  sessionId?: number;
  /** 당사자 카드에서 `상담 종결`로 들어왔으면 종결 체크를 켜고 시작한다(2026-09-17 Q). */
  startClosing?: boolean;
}) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  // 당사자 카드의 연락처·이메일은 사례 상세가 준다(2026-09-17 Q).
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [view, setView] = useState<CaseView | null>(null);
  const [memo, setMemo] = useState('');
  const [tasks, setTasks] = useState<Line[]>([]);
  const [questions, setQuestions] = useState<Line[]>([]);
  const [opinion, setOpinion] = useState('');
  const [nextGoal, setNextGoal] = useState('');
  const [place, setPlace] = useState('');
  // 소요 시간(분). 빈 칸이면 보내지 않는다(2026-09-18 Q D4 — `sessions.duration_min`).
  const [duration, setDuration] = useState('');
  // 예정 회차가 없을 때 이 자리에서 바로 적는 일시·상담 방식.
  const [heldAt, setHeldAt] = useState(nowDateTime);
  const [method, setMethod] = useState<NewSessionInput['method']>('in_person');
  // 종결 상담(요구 5). 일정에서 미리 골랐으면 이어받고, 여기서 바꿀 수도 있다.
  const [isClosing, setIsClosing] = useState(startClosing);
  const [outcomes, setOutcomes] = useState<Record<number, OutcomeInput>>({});
  const [taskDraft, setTaskDraft] = useState<Line>({ text: '', owner: 'participant' });
  const [questionDraft, setQuestionDraft] = useState<Line>({ text: '' });
  // 저장해 둔 회차를 고쳐 쓰는 중이면 그 회차. 새로 쓰는 중이면 null.
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * 시작이 곧 회차(2026-09-16 인계). 수기 첫 입력이든 녹음 시작이든 그 순간 회차가 생긴다.
   * `startedId` 는 sessions/start 로 열린(기록됨) 회차다. 예정 회차를 열어 시작했으면 그 id.
   * ref 에도 둔다 — setState 가 반영되기 전 같은 틱의 두 번째 부르기가 회차를 또 만들면 안 된다.
   */
  const [startedId, setStartedId] = useState<number | null>(null);
  const startedRef = useRef<number | null>(null);
  const startingRef = useRef<Promise<number> | null>(null);
  /** 위 녹음 패널에서 전사문이 바뀌면 올라간다 — 불일치 카드가 다시 읽는 신호. */
  const [voiceStamp, setVoiceStamp] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 늦게 온 응답이 새 화면을 덮지 않게 한다(2026-09-16 검수). 수정 요청이 날아간 뒤
    // `상담 기록하기` 로 넘어가면, 먼저 끝난 새 화면 위에 이전 응답이 내려앉아
    // `editing` 을 지난 회차로 되돌린다 — 그대로 저장하면 그 회차를 덮어쓴다.
    let live = true;
    void (async () => {
      const [b, v, rec, d] = await Promise.all([
        getBriefing(caseId),
        getCase(caseId),
        editingId ? getSessionRecord(editingId) : Promise.resolve(null),
        getCaseDetail(caseId),
      ]);
      if (!live) return;
      setBriefing(b);
      setView(v);
      setDetail(d);

      if (rec) {
        setEditing(rec);
        setMemo(rec.memo ?? '');
        setPlace(rec.place ?? '');
        setDuration(rec.duration_min == null ? '' : String(rec.duration_min));
        setHeldAt(rec.held_at ? dateTimeFromIso(rec.held_at) : nowDateTime());
        setMethod((rec.method as NewSessionInput['method']) ?? 'in_person');
        setIsClosing(startClosing || rec.is_closing);
        setNextGoal(rec.next_goal_text ?? '');
        setTasks(rec.cards.filter((c) => c.kind === 'promise').map((c) => ({ text: c.text, owner: c.owner })));
        setQuestions(rec.cards.filter((c) => c.kind === 'question').map((c) => ({ text: c.text })));
        setOpinion(rec.cards.find((c) => c.kind === 'judgment')?.text ?? '');
        // 지난번에 매긴 결과를 그대로 다시 세운다. 안 그러면 수정이 전부 미확인으로 덮는다.
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

      // **고쳐 쓰던 회차를 반드시 놓는다**(2026-09-16 검수). 이 화면은 수정과 새 기록이
      // 같은 부품이라, 수정을 열어 둔 채 `상담 기록하기` 로 넘어오면 `editing` 이 남는다.
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
      setOpinion('');
      setOutcomes({});
      setTaskDraft({ text: '', owner: 'participant' });
      setQuestionDraft({ text: '' });
      setPlace(planned?.place ?? '');
      setDuration('');
      // 당사자 카드에서 종결로 들어온 경우가 예정 회차의 표시보다 세다(2026-09-17 Q).
      setIsClosing(startClosing || (planned?.is_closing ?? false));
      setMethod((planned?.method as NewSessionInput['method']) ?? 'in_person');
      setHeldAt(planned?.scheduled_at ? dateTimeFromIso(planned.scheduled_at) : nowDateTime());
    })().catch((failure: unknown) => {
      if (!live) return;
      setBriefing(null);
      setView(null);
      setError(failure instanceof Error ? failure.message : '상담 기록 불러오기 실패');
    });
    return () => {
      live = false;
    };
  }, [caseId, editingId]);

  if ((!briefing || !view) && error) return <ErrorText>{error}</ErrorText>;

  if (!briefing || !view) return <p className="empty">불러오는 중</p>;
  if (editingId && !editing) return <p className="empty">불러오는 중</p>;

  // 종결 사례에는 새 기록을 열지 않는다(2026-09-18 검수). 저장된 회차 고쳐 쓰기는 서버가
  // 허용하므로(recordSession 은 assertCaseOpen 을 지나지 않는다) 수정 모드는 그대로 둔다.
  if (detail?.case.status === 'closed' && !editingId) {
    return (
      <>
        <ParticipantHero
          name={briefing.participant_card.name}
          pseudonym={briefing.participant_card.pseudonym}
          details={[
            ['당사자 ID', briefing.participant_card.pseudonym],
            ['참여 사업', briefing.participant_card.program_name],
            ['연락처', detail.participant.phone ?? ''],
            ['이메일', detail.participant.email ?? ''],
          ]}
        />
        <div className="wire-container">
          <Card
            title="상담 종결"
            tone="warn"
            action={
              <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
            }
          >
            <Empty>종결된 상담, 새 기록 불가</Empty>
          </Card>
        </div>
      </>
    );
  }

  // 예정 회차가 있으면 그것을 기록한다. 없으면 여기서 일시·상담 방식을 적고 회차를 만든다.
  // 일정을 미리 잡지 않고 만난 상담(갑작스러운 방문·전화)이 기록되지 못하면 안 된다.
  const session = editing
    ? { id: editing.session_id, seq: editing.seq, method: editing.method, place: editing.place }
    : view.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0];
  const seq = session?.seq ?? Math.max(0, ...view.sessions.map((s) => s.seq)) + 1;
  const inPerson = method === 'in_person';
  const heldAtIso = dateTimeToIso(heldAt);

  const setOutcome = (card_id: number, value: OutcomeInput | null) =>
    setOutcomes((prev) => {
      const next = { ...prev };
      if (value) next[card_id] = value;
      else delete next[card_id];
      return next;
    });
  /**
   * 회차 id 를 돌려준다. 없으면 sessions/start 로 만든다 — 수기 첫 입력·녹음 시작·
   * 파일 업로드가 모두 이 한 길을 지난다. 두 번 부르지 않는다(계약).
   */
  const ensureSession = (): Promise<number> => {
    if (editing) return Promise.resolve(editing.session_id);
    if (startedRef.current !== null) return Promise.resolve(startedRef.current);
    if (startingRef.current) return startingRef.current;
    const planned = view?.sessions.filter((s) => s.status === 'planned').sort((a, b2) => a.seq - b2.seq)[0];
    const p = startSession(caseId, {
      session_id: planned?.id,
      method,
      is_closing: isClosing,
    }).then((opened) => {
      startedRef.current = opened.session_id;
      setStartedId(opened.session_id);
      return opened.session_id;
    });
    startingRef.current = p;
    void p.catch(() => {
      // 실패하면 다음 시도가 다시 부를 수 있게 연다.
      startingRef.current = null;
    });
    return p;
  };

  const accessLost = () => {
    setBriefing(null);
    setView(null);
    setError('담당 배정 해제, 상담 기록 열기 불가');
  };

  const save = async () => {
    // 일시가 덜 골라진 채 저장하면 회차를 열거나 PATCH 하기 전에 막는다.
    if (!heldAtIso) {
      setError('상담 일시 선택 필요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 수기 첫 입력이 연 회차가 아직 응답 중이면 그 한 요청을 기다린다. 예정 회차 id 로
      // 먼저 PATCH 해 start 와 순서를 뒤집지 않는다.
      let targetId = editing?.session_id ?? startedRef.current;
      if (!targetId && startingRef.current) targetId = await startingRef.current;
      if (!targetId) targetId = session?.id ?? (await ensureSession());

      await recordSession(targetId, {
        held_at: heldAtIso,
        method,
        is_closing: isClosing,
        memo,
        place: inPerson ? place.trim() || null : null,
        duration_min: duration.trim() === '' ? null : Number(duration),
        next_goal_text: nextGoal.trim() || null,
        cards: [
          // `추가`를 누르지 않고 적어만 둔 줄도 함께 저장한다.
          ...withDraft(tasks, taskDraft).map((t) => ({ kind: 'promise', text: t.text, section: 'promise', owner: t.owner })),
          ...withDraft(questions, questionDraft).map((q) => ({ kind: 'question', text: q.text, section: 'question' })),
          ...(opinion.trim() ? [{ kind: 'judgment', text: opinion.trim(), section: 'judgment' }] : []),
        ],
        outcomes: Object.values(outcomes),
      });
      window.location.hash = isClosing ? `#/cases/${caseId}/close` : `#/cases/${caseId}/info`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
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
      {/* 당사자 카드가 머리다(2026-09-17 Q 확대 2단계 — 시안). 화면 용도는 아래 첫 구획 제목이
          말하고, 머리는 사람을 말한다. 정보는 이 화면이 이미 받는 값만 올린다. */}
      <ParticipantHero
        name={briefing.participant_card.name}
        pseudonym={briefing.participant_card.pseudonym}
        details={[
          ['당사자 ID', briefing.participant_card.pseudonym],
          ['참여 사업', `${briefing.participant_card.program_name}, ${seq}회차${editing ? ' 수정' : ''}`],
          ['연락처', detail?.participant.phone ?? ''],
          ['이메일', detail?.participant.email ?? ''],
        ]}        actions={
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
        }
      />
      {/* 시작이 곧 회차 — 녹음·올리기·수기 첫 입력이 회차를 연다(2026-09-16 인계). */}
      <RecordingPanel
        sessionId={session?.id ?? startedId}
        ensureSession={ensureSession}
        onAccessLost={accessLost}
        onTranscriptChange={() => setVoiceStamp((v) => v + 1)}
      />

      <div className="wire-container rail-grid record-grid" data-grid="true">
        <aside className="record-side">
          {/* 종결 상담 체크는 레일 **맨 위**다(2026-09-17 Q). 이번이 마지막인지가 과제 결과보다
              먼저 정해지는 일이고, 당사자 카드에서 `상담 종결`로 들어오면 이미 켜진 채로 열린다.
              제목 없는 2행 카드다(2026-09-18 Q D2) — 체크 한 줄, 안내 한 줄, 가로선 없음. */}
          <Card className="record-closing-card">
            <Choice
              type="checkbox"
              label="종결 상담"
              hint="체크 시 상담 기록 저장 후 상담 종결지 작성 화면으로 이동"
              checked={isClosing}
              onChange={() => setIsClosing((v) => !v)}
            />
          </Card>
          {/* 확인할 과제·오늘 물어볼 것은 카드 안 카드가 아니라 가로선으로 가른다(2026-09-18 Q D5).
              항목이 넷 이상이면 접을 수 있는 카드로 세운다 — 기본은 펼침. */}
          <OpenList title="확인할 과제" count={openTasks.length}>
            {openTasks.length === 0 ? (
              <Empty>없음</Empty>
            ) : (
              openTasks.map((t) => (
                <div className="record-open-item" key={t.card_id}>
                  <Item
                    title={t.text}
                    desc={`${t.source_session_seq}회차, ${OWNER_LABEL[t.owner]}${t.last_result === 'unchecked' ? ', 지난 회차 미확인' : ''}`}
                  />
                  {/* 결과는 셋이다(2026-09-15 Q). 범례 없이 라디오만 선다(2026-09-18 Q D6).
                      그만두는 것은 상태가 아니라 과제를 접는 일이라 따로 둔다. */}
                  <div className="wire-choice-group" role="radiogroup" aria-label="결과">
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
                  </div>
                  <Choice
                    type="checkbox"
                    label="이 과제 그만두기"
                    checked={outcomes[t.card_id]?.follow === 'stop'}
                    onChange={() => {
                      if (outcomes[t.card_id]?.follow === 'stop') {
                        setOutcome(t.card_id, null);
                        return;
                      }
                      const reason = window.prompt('그만두는 이유');
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
          </OpenList>

          <OpenList title="오늘 물어볼 것" count={openQuestions.length}>
            {openQuestions.length === 0 ? (
              <Empty>없음</Empty>
            ) : (
              openQuestions.map((q) => (
                <div className="record-open-item" key={q.card_id}>
                  <Item title={q.text} desc={`${q.source_session_seq}회차`} />
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
                </div>
              ))
            )}
          </OpenList>
          {/* 닫힌 카드는 다시 볼 일이 드물어 접어 둔다(2026-09-18 Q). 펼쳐도 읽기만이고,
              다시 열려면 그 회차를 수정한다. 비어 있으면 카드를 아예 안 그린다. */}
          {briefing.closed_tasks.length > 0 && (
            <Fold title={`완료한 과제 ${briefing.closed_tasks.length}`}>
              {briefing.closed_tasks.map((t) => (
                <Item
                  key={t.card_id}
                  title={t.text}
                  desc={`${t.source_session_seq}회차, ${OWNER_LABEL[t.owner]}, ${t.closed_session_seq}회차 ${closedLabel(t.last_result, t.last_follow)}`}
                />
              ))}
            </Fold>
          )}
          {briefing.closed_questions.length > 0 && (
            <Fold title={`확인한 질문 ${briefing.closed_questions.length}`}>
              {briefing.closed_questions.map((q) => (
                <Item
                  key={q.card_id}
                  title={q.text}
                  desc={`${q.source_session_seq}회차, ${q.closed_session_seq}회차 확인함`}
                />
              ))}
            </Fold>
          )}
        </aside>

        <main className="record-main">
          {/* 목표는 기록하면서 봐야 한다(2026-09-18 UI-9). 전체 상담 목표 + 이 회차가 이어받은 오늘 상담 목표.
              둘 다 없으면 카드를 안 그린다. 고치는 자리는 목표 탭이다(SPEC §4-2) — 여기선 보내기만. */}
          {briefing.goals && (
            <Card title="목표">
              <Item
                title={briefing.goals.overall ?? '전체 상담 목표 없음'}
                desc="전체 상담 목표"
              />
              <Item
                title={briefing.goals.today?.text ?? '오늘 상담 목표 없음'}
                desc={
                  briefing.goals.today?.from_session_seq
                    ? `오늘 상담 목표, ${briefing.goals.today.from_session_seq}회차에서 이어받음`
                    : '오늘 상담 목표'
                }
                action={
                  <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info/goals`)}>수정</Button>
                }
              />
            </Card>
          )}

          {/* 일시·소요 시간·방식·장소는 한 묶음이다. 장소는 대면일 때만 나오고 방식 바로 아래에 붙는다(요구 14). */}
          <Card title="1. 오늘 상담 내용">
            <div className="record-when-row">
              <DateTimeInput idPrefix="held-at" value={heldAt} onChange={setHeldAt} disabled={saving} required />
              <Field label="소요 시간(분)" htmlFor="duration-min">
                <input
                  id="duration-min"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={5}
                  value={duration}
                  disabled={saving}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
            </div>
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
              <Field label="상담 장소" htmlFor="place">
                <input id="place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} />
              </Field>
            )}

            <Field label="오늘 상담 내용" htmlFor="memo" control="textarea">
              <textarea
                id="memo"
                rows={5}
                aria-label="오늘 상담 내용"
                value={memo}
                onChange={(e) => {
                  setMemo(e.target.value);
                  // 수기 첫 입력도 상담의 시작이다 — 회차가 없으면 여기서 만든다.
                  void ensureSession().catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : '회차 열기 실패'),
                  );
                }}
                placeholder="오늘 나눈 이야기"
              />
            </Field>
          </Card>

          <Card title="2. 수행할 과제">
            <LineList
              id="task"
              label="수행할 과제"
              placeholder="예: 채무 내역서 준비하기"
              lines={tasks}
              draft={taskDraft}
              onDraft={setTaskDraft}
              onChange={setTasks}
              ownerToggle={
                <TaskOwnerToggle
                  id="task"
                  value={taskDraft.owner ?? 'participant'}
                  onChange={(owner) => setTaskDraft({ ...taskDraft, owner })}
                />
              }
            />
            {/*
              `진행 전`·`진행 중`은 그 자체로 "계속 간다"는 뜻이다. 그런데 같은 약속을 또 적는 사람이 있다
              (2026-09-15 예행연습에서 실제로 났다). 그러면 다음 다시보기의 확인할 과제에 같은 문구가 두 줄로 쌓인다.
              막지는 않는다 — 정말 따로 세고 싶을 수도 있다. 다만 겹친다는 사실은 알려 준다.
            */}
            {duplicateTasks.length > 0 && (
              <p className="panel-meta">
                왼쪽 확인할 과제와 중복: {duplicateTasks.join(', ')}, 결과만 매기면 다음에도 올라옴
              </p>
            )}
          </Card>

          <Card title="3. 다음에 물어볼 것">
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


          <Card title="4. 실무자 의견">
            <Field label="실무자 의견" htmlFor="opinion" control="textarea" hideLabel>
              <textarea
                id="opinion"
                rows={3}
                aria-label="실무자 의견"
                value={opinion}
                onChange={(e) => setOpinion(e.target.value)}
              />
            </Field>
          </Card>

          <Card title="5. 다음 상담 목표">
            <Field label="다음 상담 목표" htmlFor="next-goal" hideLabel>
              <input
                id="next-goal"
                type="text"
                aria-label="다음 상담 목표"
                value={nextGoal}
                onChange={(e) => setNextGoal(e.target.value)}
              />
            </Field>
          </Card>

          {(session?.id ?? startedId) ? (
            <SessionAudio
              key={session?.id ?? startedId}
              sessionId={(session?.id ?? startedId)!}
              writtenChanged={memo !== (editing?.memo ?? '')}
              voiceStamp={voiceStamp}
              onAccessLost={accessLost}
            />
          ) : (
            <Fold title="음성·수기 기록 불일치">
              <Empty>녹음 시작 또는 상담 내용 입력 시 회차 생성</Empty>
            </Fold>
          )}

          <FormActions>
            {error && <ErrorText>{error}</ErrorText>}
            <Button
              variant="primary"
              disabled={(!memo.trim() && !startedId && !editing) || !heldAtIso || saving}
              onClick={() => void save()}
            >
              {/* 수정 화면에서도 저장 버튼은 `저장`이다. 들어올 때 누른 버튼과 이름이 같으면
                  같은 일을 또 하는 줄 안다(2026-09-15 예행연습). 화면 제목이 이미 수정이라고 말한다. */}
              {saving ? '저장 중…' : isClosing ? '저장하고 종결로' : '저장'}
            </Button>
          </FormActions>
        </main>
      </div>
    </>
  );
}

/**
 * 레일의 열린 항목 묶음. 넷 이상이면 접을 수 있는 카드(기본 펼침), 아니면 보통 카드다
 * (2026-09-18 Q D5). 제목은 같고, 접을 수 있을 때만 개수가 붙는다(`완료한 과제 N` 과 같은 꼴).
 */
function OpenList({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return count >= 4 ? (
    <Fold title={`${title} ${count}`} open>
      {children}
    </Fold>
  ) : (
    <Card title={title}>{children}</Card>
  );
}
