// 당사자 등록 — 당사자 + PII 금고 + 참여 사업 하나를 한 번에 만든다(GLOSSARY §2).
// 정본 화면 이름이다. `사례 등록`이라는 이름은 존재하지 않는다.
import { useState } from 'react';
import { createCase } from '../api.ts';
import { Button, Card, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

const DEFAULT_PROGRAM = '함께온기금 울타리대출';

export function ParticipantNewScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [program, setProgram] = useState(DEFAULT_PROGRAM);
  const [planned, setPlanned] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createCase({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        program_name: program.trim(),
        sessions_planned: planned ? Number(planned) : undefined,
      });
      // 정본 문구: '등록했어요. 이제 첫 상담을 기록할 수 있어요.'
      window.location.hash = `#/cases/${created.case_id}/intake`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="당사자 등록" meta="당사자 한 명과 참여 사업 하나를 엽니다" />

      <div className="wire-container">
        <Card title="당사자" hint="이름·연락처·이메일은 금고에 따로 보관해요. 상담 기록에는 남지 않아요.">
          <Field label="이름" htmlFor="name" required>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="연락처" htmlFor="phone">
            <input id="phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="이메일" htmlFor="email">
            <input id="email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </Card>

        <Card title="참여 사업" hint="한 상담은 사업 하나만 다뤄요. 다른 사업은 사례를 따로 열어요.">
          <Field label="사업 이름" htmlFor="program" required>
            <input id="program" type="text" value={program} onChange={(e) => setProgram(e.target.value)} />
          </Field>
          <Field label="예정 회차 수" htmlFor="planned" hint="선택 · 예: 6">
            <input
              id="planned"
              type="text"
              inputMode="numeric"
              value={planned}
              onChange={(e) => setPlanned(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </Card>

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" disabled={!name.trim() || !program.trim() || saving} onClick={() => void save()}>
            {saving ? '저장 중…' : '등록하고 인테이크 쓰기'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
