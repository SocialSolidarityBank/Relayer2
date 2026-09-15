// 당사자 등록 — 당사자 + PII 금고 + 참여 사업 하나를 한 번에 만든다(GLOSSARY §2).
// 정본 화면 이름이다. `사례 등록`이라는 이름은 존재하지 않는다.
import { useState } from 'react';
import { createCase, CONSENT_DOMAINS, type ConsentDomain } from '../api.ts';
import { Button, Card, Choice, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

const DEFAULT_PROGRAM = '함께온기금 울타리대출';

/** 문안은 정본(CCC S7)이다. 화면에서 줄이거나 바꾸지 않는다 — 바꾸면 해시가 달라진다. */
const CONSENT_COPY: Record<ConsentDomain, { label: string; copy: string; required?: boolean }> = {
  personal_data_collection_use: {
    label: '개인정보 수집·이용',
    copy: '개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다.',
    required: true,
  },
  sensitive_information_processing: {
    label: '민감정보 처리',
    copy: '건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다.',
  },
};

export function ParticipantNewScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [program, setProgram] = useState(DEFAULT_PROGRAM);
  const [planned, setPlanned] = useState('');
  // 동의는 영역마다 따로 받는다. 한 번에 묶어 받지 않는다(P1).
  const [granted, setGranted] = useState<Record<string, boolean>>({});
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
        // 고르지 않은 영역은 거부로 남긴다. 빈 칸을 동의로 읽지 않는다.
        consents: CONSENT_DOMAINS.map((domain) => ({
          domain,
          decision: granted[domain] ? ('grant' as const) : ('decline' as const),
        })),
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

        <Card title="동의" hint="영역마다 따로 받아요. 고르지 않으면 거부로 남아요.">
          {CONSENT_DOMAINS.map((domain) => (
            <div className="wire-repeat-card" key={domain}>
              <Choice
                type="checkbox"
                label={`${CONSENT_COPY[domain].label}${CONSENT_COPY[domain].required ? ' (필수)' : ''}`}
                hint={CONSENT_COPY[domain].copy}
                checked={!!granted[domain]}
                onChange={() => setGranted((prev) => ({ ...prev, [domain]: !prev[domain] }))}
              />
            </div>
          ))}
          <p className="panel-meta">
            민감정보 처리에 동의하지 않으면 상담 기록을 저장할 수 없어요. 나중에 당사자 정보에서 받을 수 있어요.
          </p>
        </Card>

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button
            variant="primary"
            disabled={
              !name.trim() || !program.trim() || !granted.personal_data_collection_use || saving
            }
            onClick={() => void save()}
          >
            {saving ? '저장 중…' : '등록하고 인테이크 쓰기'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
