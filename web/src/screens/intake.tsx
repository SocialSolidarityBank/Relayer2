// 인테이크 작성하기 — 2026-09-16 수정 요청의 아홉 구획.
// 1. 상담 일시와 상담 방식 → 세션 필드(held_at·method·place)
// 2~6. 질문지(intake-questions.ts) → detail
// 7. 전체 상담 목표 → 사례 overall_goal, 8~9. 수행할 과제·다음에 물어볼 것 → 카드
import { useEffect, useState } from 'react';
import {
  getCase,
  getCaseDetail,
  getIntake,
  saveIntake,
  type CaseDetail,
  type CaseView,
  type ConsultationMethod,
  type IntakeInput,
} from '../api.ts';
import {
  INTAKE_GROUPS,
  INTAKE_MEMO_QUESTION,
  NOT_APPLICABLE_OPTION,
  PREFERRED_METHOD_OPTIONS,
  type IntakeQuestion,
  type IntakeQuestionGroup,
} from '../intake-questions.ts';
import { METHODS } from '../vocab.ts';
import { EMPTY_DATE_TIME, dateTimeFromIso, dateTimeToIso } from '../date-time.ts';
import { DateTimeInput } from '../date-time-input.tsx';
import { TaskOwnerToggle } from '../task-owner.tsx';
import {
  Button,
  Card,
  Choice,
  ChoiceGroup,
  ErrorText,
  Field as FormField,
  FormActions,
  LineList,
  ParticipantHero,
  withDraft,
  type Line,
} from '../ui.tsx';

/** 인테이크의 실제 상담 방식 네 선택지(요청 2). 방문은 예정 회차 전용이라 여기선 뺀다. */
const INTAKE_METHODS = METHODS.filter((m) => m.key !== 'visit');

/** 옛 무응답은 보이지 않지만, 사용자가 새 답을 고르면 함께 저장하지 않는다. */
const EXCLUSIVE_OPTIONS = [NOT_APPLICABLE_OPTION, '무응답'];

type Answers = Record<string, string | string[]>;

/** 지금 시각을 한국 시간의 날짜·시·분으로 표시하는 상담 일시 초깃값. */
const nowDateTime = () => dateTimeFromIso(new Date().toISOString());

/** 글이 길어지면 칸이 아래로 늘어난다(요청 7). 불러온 글도 처음부터 다 보이게 한다. */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** 구 문항의 답을 새 문항으로 옮긴다. 모호한 값은 억지로 새 값에 끼우지 않고 원본만 남긴다. */
function withLegacyMapping(detail: Record<string, unknown>, memo: string | null): Answers {
  const answers = { ...(detail as Answers) };

  // 과거 수급·심사 중·상충하는 답은 현재 수급 상태로 추정하지 않는다.
  if (typeof answers.welfare_status !== 'string') {
    const basic = answers.welfare_basic_livelihood;
    const near = answers.welfare_near_poverty;
    if (basic === '수급 중' && near !== '해당') answers.welfare_status = '기초생활보장수급';
    else if (near === '해당' && basic !== '수급 중') answers.welfare_status = '차상위계층';
    else if (basic === '비수급' && near === '비해당') answers.welfare_status = '해당 없음';
  }

  // 명시적으로 기록한 옛 선호 답이 우선한다. 복수 답을 임의로 하나로 줄이지 않는다.
  if (typeof answers.preferred_counsel_method !== 'string') {
    const legacy: Record<string, string> = {
      '대면': '대면',
      '전화': '전화',
      '온라인 화상': '화상',
      '기타': '기타(이메일, SNS 등)',
    };
    const preferred = answers.participation_preferred_method;
    const fromPreferred =
      typeof preferred === 'string' ? legacy[preferred]
      : Array.isArray(preferred) && preferred.length === 1 ? legacy[preferred[0]]
      : undefined;
    if (fromPreferred) answers.preferred_counsel_method = fromPreferred;
  }

  // 신청 배경 글 칸이 비어 있고 예전 기록이 memo 에만 있으면(초기 데이터) memo 를 칸에 올린다.
  // 저장 때 이 칸을 그대로 memo 로 돌려내므로 지우면 memo 도 지워진다.
  if (answers.application_reason_detail === undefined && typeof memo === 'string') {
    answers.application_reason_detail = memo;
  }

  return answers;
}

function Question({
  question,
  value,
  onChange,
  hideLabel = false,
}: {
  question: IntakeQuestion;
  value: string | string[] | undefined;
  onChange: (next: string | string[]) => void;
  /**
   * 카드 제목이 이미 같은 말을 할 때(문항 하나뿐인 구획) 라벨 행을 빼고 `aria-label` 로만 남긴다.
   * `전체 상담 목표` 카드가 쓰던 방식과 같다 — 같은 말을 두 줄로 읽히게 두지 않는다.
   */
  hideLabel?: boolean;
}) {
  if (question.kind === 'text') {
    // 예시는 placeholder 하나로만 보여 준다. 같은 문장을 도움말로 또 쓰면 두 번 읽힌다.
    return (
      <FormField label={question.label} htmlFor={question.key} hideLabel={hideLabel}>
        <input
          id={question.key}
          type="text"
          aria-label={hideLabel ? question.label : undefined}
          value={typeof value === 'string' ? value : ''}
          placeholder={question.hint}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }


  if (question.kind === 'textarea') {
    return (
      <FormField label={question.label} htmlFor={question.key} control="textarea" hideLabel={hideLabel}>
        <textarea
          id={question.key}
          rows={2}
          ref={grow}
          aria-label={hideLabel ? question.label : undefined}
          value={typeof value === 'string' ? value : ''}
          placeholder={question.hint}
          onInput={(e) => grow(e.currentTarget)}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }

  const choices = question.options ?? [];
  const chosen = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (option: string) => {
    if (question.kind === 'select') {
      onChange(chosen[0] === option ? '' : option);
      return;
    }
    // '해당 없음'은 다른 선택과 함께 고를 수 없다.
    if (EXCLUSIVE_OPTIONS.includes(option)) {
      onChange(chosen.includes(option) ? [] : [option]);
      return;
    }
    const next = chosen.includes(option)
      ? chosen.filter((v) => v !== option)
      : [...chosen.filter((v) => !EXCLUSIVE_OPTIONS.includes(v)), option];
    onChange(next);
  };

  // 선택은 알약 버튼이 아니라 네이티브 radio·checkbox 다(DESIGN-RULES).
  return (
    <ChoiceGroup legend={question.label}>
      {choices.map((option) => (
        <Choice
          key={option}
          type={question.kind === 'select' ? 'radio' : 'checkbox'}
          name={question.key}
          label={option}
          checked={chosen.includes(option)}
          onChange={() => toggle(option)}
        />
      ))}
    </ChoiceGroup>
  );
}

/**
 * 인테이크 작성하기. `readOnly` 면 **같은 화면을 잠근 채** 그린다(2026-09-18 UI-3 — 원본 보기가
 * 이 화면을 그대로 쓴다). 그때는 당사자 카드를 안 그리고(바깥 화면이 그린다) 저장 대신 `수정`이다.
 */
export function IntakeScreen({ caseId, readOnly = false }: { caseId: number; readOnly?: boolean }) {
  const [view, setView] = useState<CaseView | null>(null);
  // 당사자 카드의 이름은 사례 상세가 준다(2026-09-17 Q 시안). 이 화면은 이름을 안 받고 있었다.
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [overallGoal, setOverallGoal] = useState('');
  const [questions, setQuestions] = useState<Line[]>([]);
  // 첫 상담에서도 약속은 나온다("다음까지 서류 떼어 오기"). 2026-09-15 예행연습에서 드러난 빈자리.
  const [tasks, setTasks] = useState<Line[]>([]);
  const [taskDraft, setTaskDraft] = useState<Line>({ text: '', owner: 'participant' });
  const [questionDraft, setQuestionDraft] = useState<Line>({ text: '' });
  // 실제로 진행한 상담의 일시·방식·장소. 선호 상담 방식(detail)과 다른 값이다.
  const [heldAt, setHeldAt] = useState(nowDateTime);
  const [method, setMethod] = useState<ConsultationMethod | ''>('');
  const [place, setPlace] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이미 쓴 인테이크가 있으면 그것을 열어 고친다. 첫 회차는 하나뿐이다.
  const [written, setWritten] = useState(false);

  useEffect(() => {
    // 늦게 온 응답이 새 화면을 덮지 않게 한다 — 다른 사례로 넘어간 뒤 이전 사례의
    // 답이 내려앉아 그대로 저장되는 사고를 막는다.
    let live = true;
    setView(null);
    setError(null);
    setAnswers({});
    setOverallGoal('');
    setTasks([]);
    setQuestions([]);
    setTaskDraft({ text: '', owner: 'participant' });
    setQuestionDraft({ text: '' });
    setHeldAt(nowDateTime());
    setMethod('');
    setPlace('');
    setWritten(false);
    void (async () => {
      const [v, intake, d] = await Promise.all([getCase(caseId), getIntake(caseId), getCaseDetail(caseId)]);
      if (!live) return;
      setView(v);
      setDetail(d);
      setOverallGoal(intake.overall_goal ?? v.case.overall_goal ?? '');
      setWritten(intake.session_id !== null);
      setAnswers(withLegacyMapping(intake.detail ?? {}, intake.memo));
      setTasks(intake.cards.filter((c) => c.kind === 'promise').map((c) => ({ text: c.text, owner: c.owner })));
      setQuestions(intake.cards.filter((c) => c.kind === 'question').map((c) => ({ text: c.text })));
      setHeldAt(intake.held_at ? dateTimeFromIso(intake.held_at) : nowDateTime());
      setMethod(intake.method ?? '');
      setPlace(intake.place ?? '');
    })().catch((failure: unknown) => {
      if (live) setError(failure instanceof Error ? failure.message : '불러오기 실패');
    });
    return () => {
      live = false;
    };
  }, [caseId]);

  if (!view) {
    return error ? <ErrorText>{error}</ErrorText> : <p className="empty">불러오는 중</p>;
  }
  // 인테이크를 건너뛰고 다른 회차부터 기록한 사례는 여기서 새로 쓰지 못한다.
  if (!written && view.sessions.length > 0)
    return (
      <p className="empty">
        이미 다른 회차가 있어 인테이크 작성 불가,{' '}
        <a href={`#/cases/${caseId}/info`}>당사자 정보</a>로 이동
      </p>
    );

  const setAnswer = (key: string, value: string | string[]) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const renderGroup = (group: IntakeQuestionGroup) => (
    <Card title={group.title} key={group.title}>
      {group.questions
        .filter((q) => !q.visibleWhen || answers[q.visibleWhen.key] === q.visibleWhen.equals)
        .map((q) => (
          <Question
            key={q.key}
            question={q}
            value={answers[q.key]}
            onChange={(v) => setAnswer(q.key, v)}
            hideLabel={q.label === group.title}
          />
        ))}
    </Card>
  );

  const save = async () => {
    // 일시를 건드렸는데 덜 골랐으면 지금 시각으로 억지로 채우지 않고 막는다.
    // 아예 비어 있으면 held_at 을 보내지 않아 예전 값이 남는다.
    const heldAtTouched =
      heldAt.date !== EMPTY_DATE_TIME.date ||
      heldAt.period !== EMPTY_DATE_TIME.period ||
      heldAt.hour !== EMPTY_DATE_TIME.hour ||
      heldAt.minute !== EMPTY_DATE_TIME.minute;
    const heldAtIso = dateTimeToIso(heldAt);
    if (heldAtTouched && !heldAtIso) {
      setError('상담 일시 선택 필요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: IntakeInput = {
        // 신청 배경 칸이 곧 memo 다. 비우면 '' 를 보내 memo 도 지운다(생략하면 예전 값이 남는다).
        memo: (answers.application_reason_detail as string) ?? '',
        overall_goal: overallGoal.trim() || null,
        detail: answers,
        // 다음에 물어볼 것은 상담 기록하기와 같은 입력이며 확인할 것 카드가 된다.
        cards: [
          ...withDraft(questions, questionDraft).map((q) => ({ kind: 'question', text: q.text, section: 'intake' })),
          ...withDraft(tasks, taskDraft).map((t) => ({ kind: 'promise', text: t.text, section: 'promise', owner: t.owner })),
        ],
      };
      if (heldAtIso) body.held_at = heldAtIso;
      // 방식을 고르지 않았으면 보내지 않는다 — 수정에서 예전 값을 지우지 않는다.
      if (method && INTAKE_METHODS.some((m) => m.key === method)) {
        body.method = method;
        body.place = method === 'in_person' ? place.trim() || null : null;
      }
      await saveIntake(caseId, body);
      // 처음 쓴 것이면 일정 잡기로, 고쳐 쓴 것이면 보던 자리(당사자 정보)로 돌아간다.
      window.location.hash = written ? `#/cases/${caseId}/info` : `#/cases/${caseId}/schedule`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <div className="intake-form">
      {/* 1. 실제로 진행한 상담의 일시·방식·장소. 장소는 대면일 때만 나온다(요청 2). */}
      <Card title="상담 일시와 상담 방식">
        <div className="when-row">
          <DateTimeInput idPrefix="held-at" value={heldAt} onChange={setHeldAt} disabled={saving || readOnly} required={false} />
        </div>
        <ChoiceGroup legend="상담 방식">
          {INTAKE_METHODS.map((m) => (
            <Choice
              key={m.key}
              type="radio"
              name="method"
              label={m.label}
              checked={method === m.key}
              onChange={() => setMethod(method === m.key ? '' : m.key)}
            />
          ))}
        </ChoiceGroup>
        {method === 'in_person' && (
          <FormField label="상담 장소" htmlFor="place">
            <input id="place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} />
          </FormField>
        )}
      </Card>

      {/* 2~9 구획. 두 열로 나란히 놓되 DOM 순서는 구획 순서 그대로다. */}
      <div className="card-grid two-col">
        {INTAKE_GROUPS.map(renderGroup)}

        <Card title="전체 상담 목표">
          <FormField label="전체 상담 목표" htmlFor="overall-goal" hideLabel>
            <input
              id="overall-goal"
              type="text"
              aria-label="전체 상담 목표"
              value={overallGoal}
              onChange={(e) => setOverallGoal(e.target.value)}
            />
          </FormField>
        </Card>

        <Card title="수행할 과제">
          <LineList
            id="intake-task"
            label="수행할 과제"
            placeholder="예: 채무 내역서 떼어 오기"
            lines={tasks}
            draft={taskDraft}
            onDraft={setTaskDraft}
            onChange={setTasks}
            readOnly={readOnly}
            ownerToggle={
              <TaskOwnerToggle
                id="intake-task"
                value={taskDraft.owner ?? 'participant'}
                onChange={(owner) => setTaskDraft({ ...taskDraft, owner })}
              />
            }
          />
        </Card>

        <Card title="다음에 물어볼 것">
          <LineList
            id="intake-question"
            label="다음에 물어볼 것"
            placeholder="예: 통원 주기가 어떻게 되는지"
            lines={questions}
            draft={questionDraft}
            onDraft={setQuestionDraft}
            onChange={setQuestions}
            readOnly={readOnly}
          />
        </Card>

        {/* 마지막 구획(2026-09-18 Q 결정 D13). 앞 구획 어디에도 안 들어가는 말을 받는 자유 글이고
            선택이다. 정본은 `intake-questions.ts` 의 `INTAKE_MEMO_QUESTION` — 저장 키도 거기 있다. */}
        <Card title={INTAKE_MEMO_QUESTION.label}>
          <Question
            question={INTAKE_MEMO_QUESTION}
            value={answers[INTAKE_MEMO_QUESTION.key]}
            onChange={(v) => setAnswer(INTAKE_MEMO_QUESTION.key, v)}
            hideLabel
          />
        </Card>
      </div>
    </div>
  );

  if (readOnly) {
    return (
      <>
        {/* 네이티브 fieldset disabled 가 안의 input·select·textarea·radio 를 한 번에 잠근다.
            display:contents 라 격자 배치는 그대로다. */}
        <fieldset disabled style={{ display: 'contents', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          {body}
        </fieldset>
        <FormActions>
          <Button variant="primary" onClick={() => (window.location.hash = `#/cases/${caseId}/intake`)}>
            수정
          </Button>
        </FormActions>
      </>
    );
  }

  return (
    <>
      {/* 당사자 카드가 머리다(2026-09-17 Q — ①ⓐ 화면 이름은 적지 않는다, ②ⓐ 정보 격자 유지,
          ③ⓐ 행동은 `당사자 정보` 하나). 이름은 사례 상세에서 받는다. */}
      <ParticipantHero
        name={detail?.participant.name ?? null}
        pseudonym={view.pseudonym}
        details={[
          ['ID', view.pseudonym],
          ['참여중인 사업', `${view.case.program_name}, 1회차 인테이크`],
          ['연락처', detail?.participant.phone ?? ''],
          ['이메일', detail?.participant.email ?? ''],
        ]}
        actions={
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
        }
      />

      <div className="wire-container">
        {body}

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {/* 이미 쓴 인테이크를 다시 열었을 때도 버튼은 `저장`이다.
                들어올 때 누른 버튼(`수정`)과 이름이 같으면 같은 일을 또 하는 줄 안다. */}
            {saving ? '저장 중…' : written ? '저장' : '저장하고 상담 일정 잡기'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
