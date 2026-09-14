// 상담 일정 등록 — 예정 회차 한 건을 만든다. 3구획(당사자 / 일시와 상담 방식 / 메모).
// 결정 42의 `상담 등록`은 2026-09-14 Q가 철회했다(상담 기록하기와 혼동).
// 1구획 `당사자`는 당사자 목록·동의 모델이 있어야 완성되므로 베타에는 없다.
import { useEffect, useState } from 'react';
import { getCase, planSession, type CaseView, type NewSessionInput } from '../api.ts';
import { Button, Card, Choice, ChoiceGroup, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';
import { METHODS } from '../vocab.ts';

export function ScheduleNewScreen({ caseId }: { caseId: number }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [at, setAt] = useState('');
  const [method, setMethod] = useState<NewSessionInput['method']>('in_person');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCase(caseId).then(setView);
  }, [caseId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await planSession(caseId, {
        scheduled_at: new Date(at).toISOString(),
        method,
        place: method === 'in_person' && place.trim() ? place.trim() : undefined,
        plan_memo: memo.trim() || undefined,
      });
      window.location.hash = `#/cases/${caseId}/briefing`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const nextSeq = view ? Math.max(0, ...view.sessions.map((s) => s.seq)) + 1 : null;

  return (
    <>
      <PageHeader
        title="상담 일정 등록"
        meta={
          view
            ? `${view.pseudonym} · ${view.case.program_name}${nextSeq ? ` · ${nextSeq}회차` : ''}`
            : '불러오는 중이에요'
        }
      />

      <div className="wire-container">
        <Card title="일시와 상담 방식">
          <Field label="일시" htmlFor="at" required>
            <input id="at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
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

          {method === 'in_person' && (
            <Field label="상담 장소" htmlFor="place">
              <input id="place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} />
            </Field>
          )}
        </Card>

        <Card title="메모" hint="미리 적어 둘 것을 자유롭게 적어요. 과제나 질문으로 등록되지는 않아요.">
          <Field label="메모" htmlFor="memo" control="textarea">
            <textarea id="memo" rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </Card>

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" disabled={!at || saving} onClick={() => void save()}>
            {saving ? '저장 중…' : '등록'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
