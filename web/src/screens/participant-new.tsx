// 당사자 등록 — 당사자 + PII 금고 + 참여 사업 하나를 한 번에 만든다(GLOSSARY §2).
// 정본 화면 이름이다. `사례 등록`이라는 이름은 존재하지 않는다.
import { useEffect, useState } from 'react';
import { createCase, getConsentCopy, listPrograms, type ConsentCopy, type Program } from '../api.ts';
import { Button, Card, Choice, ConsentDetail, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';



export function ParticipantNewScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  // 사업은 **고르기만** 한다(2026-09-16 Q). 직접 치면 같은 사업이 두 이름으로 갈린다.
  // 목록은 설정 › 기관 정보 관리에서 관리자가 만든다.
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [program, setProgram] = useState('');
  // 선행 목록 둘. **한 번 실패하면 버튼이 영원히 잠기므로** 다시 받을 길을 둔다(2026-09-16 검수).
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadAt, setReloadAt] = useState(0);
  useEffect(() => {
    setLoadFailed(false);
    void Promise.all([listPrograms(), getConsentCopy()])
      .then(([rows, list]) => {
        setPrograms(rows);
        if (rows.length === 1) setProgram(rows[0].name);
        setCopies(list);
      })
      .catch(() => setLoadFailed(true));
  }, [reloadAt]);
  const [planned, setPlanned] = useState('');
  // 동의는 영역마다 따로 받는다. 한 번에 묶어 받지 않는다(P1).
  // **문안은 서버에서 받는다** — 화면이 복사해 두면 서버가 바뀌어도 옛 글로 동의를 받는다(2026-09-16 검수).
  const [copies, setCopies] = useState<ConsentCopy[]>([]);
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
        consents: copies.map((c) => ({
          domain: c.domain,
          decision: granted[c.domain] ? ('grant' as const) : ('decline' as const),
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
          <Field
            label="사업"
            htmlFor="program"
            required
            control="select"
            hint={
              programs !== null && programs.length === 0
                ? '아직 사업이 없어요. 관리자가 설정 › 기관 정보 관리에서 먼저 만들어야 해요.'
                : '설정 › 기관 정보 관리에서 관리자가 목록을 관리해요.'
            }
          >
            <select id="program" value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">고르기</option>
              {(programs ?? []).map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
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

        {/* 문안 전체를 보여 주고 받는다. 접어 둔 것을 펴면 무엇을 받고 얼마나 두고
            거부하면 어떻게 되는지가 나온다 — 해시에 묶인 내용 그대로다. */}
        {loadFailed && (
          <Card title="불러오지 못했어요">
            <FormActions>
              <ErrorText>사업 목록과 동의 문안을 받지 못했어요.</ErrorText>
              <Button onClick={() => setReloadAt(Date.now())}>다시 불러오기</Button>
            </FormActions>
          </Card>
        )}

        <Card title="동의">
          {copies.map((c) => (
            <div className="wire-repeat-card" key={c.domain}>
              <Choice
                type="checkbox"
                label={`${c.label}${c.required ? ' (필수)' : ''}`}
                hint={c.body}
                checked={!!granted[c.domain]}
                onChange={() => setGranted((prev) => ({ ...prev, [c.domain]: !prev[c.domain] }))}
              />
              <ConsentDetail copy={c} />
            </div>
          ))}
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
