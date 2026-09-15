// 인테이크 작성하기 — 공통 뼈대 + 고른 영역 모듈. 사업 모듈은 P2.
// I-05: 고른 영역의 세부 질문을 실제로 펼친다. 제목·배지만 보여주면 미완이다.
// I-09: 전체 상담 목표는 사례의 overall_goal 을 쓴다. 비워둘 수 있다.
import { useEffect, useState } from 'react';
import { getCase, getIntake, saveIntake, type CaseView } from '../api.ts';
import {
  intakeSectionLabel,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_OPTION,
  STEP1_GROUPS,
  STEP2_GROUPS,
  STEP3_GROUPS,
  STEP4_GROUPS,
  type IntakeQuestion,
  type IntakeQuestionGroup,
} from '../intake-questions.ts';
import { ECONOMY_NUMBER_FIELDS, NEED_AREAS } from '../need-areas.ts';
import {
  Button,
  Card,
  Choice,
  ChoiceGroup,
  ErrorText,
  Field as FormField,
  FormActions,
  LineList,
  PageHeader,
  type Line,
} from '../ui.tsx';

const AREA_QUESTION_KEY = 'difficulty_areas';
/** 다른 답에 딸린 질문들. 지금은 2순위 지원욕구 하나다. */
const DEPENDENT_QUESTIONS = [...STEP1_GROUPS, ...STEP2_GROUPS, ...STEP3_GROUPS, ...STEP4_GROUPS]
  .flatMap((g) => g.questions)
  .filter((q) => q.excludeChosenOf);
const EXCLUSIVE_OPTIONS = [NO_RESPONSE_OPTION, NOT_APPLICABLE_OPTION];

type Answers = Record<string, string | string[]>;

function Question({
  question,
  value,
  options,
  onChange,
}: {
  question: IntakeQuestion;
  value: string | string[] | undefined;
  /** 다른 답에 따라 줄어든 선택지. 주지 않으면 질문이 가진 것을 그대로 쓴다. */
  options?: readonly string[];
  onChange: (next: string | string[]) => void;
}) {
  if (question.kind === 'text') {
    // 예시는 placeholder 하나로만 보여 준다. 같은 문장을 도움말로 또 쓰면 두 번 읽힌다.
    return (
      <FormField label={question.label} htmlFor={question.key}>
        <input
          id={question.key}
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={question.hint}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }

  const choices = options ?? question.options ?? [];
  const chosen = Array.isArray(value) ? value : value ? [value] : [];

  // 선택지가 열 개를 넘는 한 가지 고르기는 드롭다운이다. 라디오로 늘어놓으면 화면을 덮는다.
  if (question.dropdown) {
    return (
      <FormField label={question.label} htmlFor={question.key} control="select">
        <select
          id={question.key}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">고르세요</option>
          {choices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </FormField>
    );
  }

  const toggle = (option: string) => {
    if (question.kind === 'select') {
      onChange(chosen[0] === option ? '' : option);
      return;
    }
    // 무응답·해당 없음은 다른 선택과 함께 고를 수 없다(I-02).
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

export function IntakeScreen({ caseId }: { caseId: number }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [overallGoal, setOverallGoal] = useState('');
  const [questions, setQuestions] = useState<Line[]>([]);
  // 첫 상담에서도 약속은 나온다("다음까지 서류 떼어 오기"). 2026-09-15 예행연습에서 드러난 빈자리.
  const [tasks, setTasks] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이미 쓴 인테이크가 있으면 그것을 열어 고친다. 첫 회차는 하나뿐이다.
  const [written, setWritten] = useState(false);
  const [locked, setLocked] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const [v, intake] = await Promise.all([getCase(caseId), getIntake(caseId)]);
      setView(v);
      setOverallGoal(intake.overall_goal ?? v.case.overall_goal ?? '');
      setWritten(intake.session_id !== null);
      setAnswers((intake.detail ?? {}) as Answers);
      setTasks(intake.cards.filter((c) => c.kind === 'promise').map((c) => ({ text: c.text })));
      setQuestions(intake.cards.filter((c) => c.kind === 'question').map((c) => ({ text: c.text })));
      setLocked(intake.cards.filter((c) => c.locked).map((c) => c.text));
    })();
  }, [caseId]);

  if (!view) return <p className="empty">불러오는 중이에요.</p>;
  // 인테이크를 건너뛰고 다른 회차부터 기록한 사례는 여기서 새로 쓰지 못한다.
  if (!written && view.sessions.length > 0)
    return (
      <p className="empty">
        이 사례에는 이미 다른 회차가 있어요. 인테이크는 첫 회차예요.{' '}
        <a href={`#/cases/${caseId}/briefing`}>15초 다시보기</a>로 가세요.
      </p>
    );

  const chosenAreas = (answers[AREA_QUESTION_KEY] as string[] | undefined) ?? [];
  // 고른 영역만 표준 하위영역(선택 2 + 상세 1)을 편다. 정본 세부항목은 need-areas.ts 에 있다.
  const openAreas = NEED_AREAS.filter((a) => chosenAreas.includes(a.label) && a.subdomains.length > 0);
  const areaGroup = STEP2_GROUPS[0];

  const setAnswer = (key: string, value: string | string[]) =>
    setAnswers((prev) => {
      const next = { ...prev, [key]: value };
      // 1순위를 바꿨는데 2순위가 그 값이면 2순위를 비운다. 목록에서만 빼면 이미 고른 값이 남는다.
      for (const q of DEPENDENT_QUESTIONS) {
        if (q.excludeChosenOf === key && next[q.key] === value) next[q.key] = '';
      }
      return next;
    });

  /** 다른 질문에서 이미 고른 값은 선택지에서 뺀다(1순위로 고른 욕구는 2순위에 안 뜬다). */
  const optionsFor = (q: IntakeQuestion): readonly string[] | undefined => {
    if (!q.excludeChosenOf) return undefined;
    const taken = answers[q.excludeChosenOf];
    if (typeof taken !== 'string' || !taken) return undefined;
    return (q.options ?? []).filter((o) => o !== taken);
  };

  const renderGroup = (group: IntakeQuestionGroup) => (
    <Card title={intakeSectionLabel(group.title)} key={group.title}>
      {group.questions.map((q) => (
        <Question
          key={q.key}
          question={q}
          value={answers[q.key]}
          options={optionsFor(q)}
          onChange={(v) => setAnswer(q.key, v)}
        />
      ))}
    </Card>
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveIntake(caseId, {
        memo: (answers.application_reason_detail as string) || undefined,
        overall_goal: overallGoal.trim() || null,
        detail: answers,
        // I-08: 다음에 물어볼 것은 상담 기록하기와 같은 입력이며 확인할 것 카드가 된다.
        cards: [
          ...questions.map((q) => ({ kind: 'question', text: q.text, section: 'intake' })),
          ...tasks.map((t) => ({ kind: 'promise', text: t.text, section: 'promise' })),
        ],
      });
      // 처음 쓴 것이면 일정 잡기로, 고쳐 쓴 것이면 보던 자리(15초 다시보기)로 돌아간다.
      window.location.hash = written ? `#/cases/${caseId}/briefing` : `#/cases/${caseId}/schedule`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="인테이크 작성하기"
        meta={`${view.pseudonym} · ${view.case.program_name} · 1회차`}
      />

      <div className="wire-container">
        {STEP1_GROUPS.map(renderGroup)}

        <Card title={intakeSectionLabel(areaGroup.title)} hint="고른 영역만 아래에 세부 질문이 열려요.">
          {areaGroup.questions.map((q) => (
            <Question
          key={q.key}
          question={q}
          value={answers[q.key]}
          options={optionsFor(q)}
          onChange={(v) => setAnswer(q.key, v)}
        />
          ))}
        </Card>

        {openAreas.map((area) => (
          <Card title={area.label} key={area.key}>
            {area.subdomains.map((sub) => (
              <Question
                key={sub.key}
                question={{
                  key: `need_${area.key}_${sub.key}`,
                  label: sub.title,
                  kind: 'multi',
                  options: sub.items,
                }}
                value={answers[`need_${area.key}_${sub.key}`]}
                onChange={(v) => setAnswer(`need_${area.key}_${sub.key}`, v)}
              />
            ))}
            {area.key === 'economy' &&
              ECONOMY_NUMBER_FIELDS.map((f) => (
                <Question
                  key={f.key}
                  question={{ key: f.key, label: f.label, kind: 'text', hint: f.hint }}
                  value={answers[f.key]}
                  onChange={(v) => setAnswer(f.key, v)}
                />
              ))}
            <Question
              question={{ key: `need_${area.key}_detail`, label: `${area.label} 상세내용`, kind: 'text' }}
              value={answers[`need_${area.key}_detail`]}
              onChange={(v) => setAnswer(`need_${area.key}_detail`, v)}
            />
          </Card>
        ))}
        {chosenAreas.includes('기타') && (
          <Card title="기타" key="other">
            <Question
              question={{ key: 'need_other_detail', label: '기타 상세내용', kind: 'text' }}
              value={answers.need_other_detail}
              onChange={(v) => setAnswer('need_other_detail', v)}
            />
          </Card>
        )}

        {STEP3_GROUPS.map(renderGroup)}
        {STEP4_GROUPS.map(renderGroup)}

        <Card title="전체 상담 목표">
          <FormField
            label="전체 상담 목표"
            htmlFor="overall-goal"
            hint="비워 두어도 괜찮아요. 나중에 상담 기록하기에서 세우거나 고칠 수 있어요."
          >
            <input
              id="overall-goal"
              type="text"
              value={overallGoal}
              onChange={(e) => setOverallGoal(e.target.value)}
            />
          </FormField>
        </Card>

        <Card title="수행할 과제" hint="저장하면 다음 상담의 확인할 과제로 올라가요.">
          <LineList
            id="intake-task"
            label="수행할 과제"
            placeholder="예: 채무 내역서 떼어 오기"
            lines={tasks}
            onChange={setTasks}
          />
        </Card>

        <Card title="다음에 물어볼 것" hint="저장하면 1회차 15초 다시보기의 오늘 물어볼 것으로 올라가요.">
          <LineList
            id="intake-question"
            label="다음에 물어볼 것"
            placeholder="예: 통원 주기가 어떻게 되는지"
            lines={questions}
            onChange={setQuestions}
          />
        </Card>

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? '저장 중…' : written ? '고쳐 쓰기' : '저장하고 상담 일정 잡기'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
