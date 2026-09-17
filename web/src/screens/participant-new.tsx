// 당사자 등록 — 당사자 + PII 금고 + 참여 사업 하나를 한 번에 만든다(GLOSSARY §2).
// 정본 화면 이름이다. `사례 등록`이라는 이름은 존재하지 않는다.
import { useEffect, useState } from 'react';
import {
  createCase,
  getConsentCopy,
  issueAccess,
  listPrograms,
  type ConsentCopy,
  type Program,
} from '../api.ts';
import {
  Button,
  Card,
  Choice,
  DataRows,
  ErrorText,
  Field,
  Fold,
  FormActions,
  PageHeader,
} from '../ui.tsx';



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
  const [saving, setSaving] = useState<'intake' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 등록하고 **동의 링크**를 만드는 길(2026-09-18 Q). 실무자가 대신 적어 넣은 경우에
   * 나머지 동의는 당사자가 링크로 준다. 링크와 확인 코드는 **발급 응답에만 있다** —
   * 화면을 떠나면 다시 볼 수 없어서 여기서 바로 보여 준다.
   */
  const [issued, setIssued] = useState<{ caseId: number; token: string; code: string } | null>(null);
  // 등록에 필요한 것: 이름 · 사업 · 사례를 열 수 있게 하는 개인정보 수집·이용 동의.
  const ready = Boolean(name.trim() && program.trim() && granted.personal_data_collection_use);

  const save = async (then: 'intake' | 'link') => {
    setSaving(then);
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
      if (then === 'intake') {
        // 정본 문구: '등록했어요. 이제 첫 상담을 기록할 수 있어요.'
        window.location.hash = `#/cases/${created.case_id}/intake`;
        return;
      }
      const access = await issueAccess(created.case_id);
      setIssued({ caseId: created.case_id, token: access.token, code: access.code });
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록하지 못했어요.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* 제목 아래 설명 줄은 두지 않는다(2026-09-18 Q, §13). 무엇을 만드는지는 카드가 말한다. */}
      <PageHeader title="당사자 등록" />

      <div className="wire-container">
        <Card title="당사자">
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

        <Card title="참여 사업">
          <Field
            label="사업"
            htmlFor="program"
            required
            control="select"
            // 상태는 남기고 설명은 걷는다 — 사업이 하나도 없으면 여기서 막히기 때문이다.
            hint={
              programs !== null && programs.length === 0
                ? '아직 사업이 없어요. 관리자가 설정 › 기관 정보 관리에서 먼저 만들어야 해요.'
                : undefined
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
          <Field label="예정 회차 수" htmlFor="planned">
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

        {/* 동의는 **항목마다 상위 접힘 카드 하나**다(2026-09-18 Q). 묶음 카드(`동의`)를 걷고
            이중 접힘(`자세히 보기`)도 걷었다.
            이 화면에서는 **체크가 접힌 머리에 선다** — 등록에서 할 일은 동의를 받는 것이고
            문안 전체는 필요할 때만 펼친다(당사자 정보 탭은 이미 받은 동의를 읽는 자리라
            체크가 본문 아래다). 체크를 눌러도 카드가 접히거나 펼쳐지지 않는다. */}
        {copies.map((c) => (
          <Fold
            key={c.domain}
            group="consents"
            title={
              <>
                <span
                  className="consent-head-check"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Choice
                    type="checkbox"
                    label={c.label}
                    checked={!!granted[c.domain]}
                    onChange={() => setGranted((prev) => ({ ...prev, [c.domain]: !prev[c.domain] }))}
                  />
                </span>
                {c.required && (
                  <span className="wire-required-mark">
                    <span className="wire-required-mark-label">필수</span>
                  </span>
                )}
              </>
            }
            desc={<span title={c.body}>{c.body}</span>}
          >
            <DataRows
              rows={[
                ['동의문', c.body],
                ['무엇을 받나', c.items.join(' · ')],
                ['왜 받나', c.purpose_text],
                ['얼마나 두나', c.retention_text],
                ...(c.recipient ? ([['어디로 가나', c.recipient]] as Array<[string, string]>) : []),
                ['거부할 수 있나', c.refusal_text],
                ['문안 판', `${c.version}, 지문 ${c.hash}`],
              ]}
            />
          </Fold>
        ))}

        {/* 동의 링크를 만들었으면 링크와 확인 코드를 여기서 바로 전한다. 코드는 지금 한 번만 보인다. */}
        {issued && (
          <Card
            title="개인정보 및 민감정보 처리 동의 링크"
            action={
              <Button onClick={() => (window.location.hash = `#/cases/${issued.caseId}/intake`)}>
                인테이크 쓰기
              </Button>
            }
          >
            <DataRows
              rows={[
                ['링크', `${window.location.origin}/#/access/${issued.token}`],
                ['확인 코드', issued.code],
              ]}
            />
            <p className="panel-meta">이 화면을 닫으면 코드는 다시 볼 수 없어요. 지금 전해 주세요.</p>
          </Card>
        )}

        {/* 만드는 화면이라 `등록`이다(2026-09-18 Q — `저장`은 이미 있는 것을 고칠 때 쓴다).
            두 길: 바로 인테이크를 쓰거나, 남은 동의를 당사자에게 링크로 받는다. */}
        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          {!issued && (
            <>
              <Button
                disabled={!ready || saving !== null}
                onClick={() => void save('link')}
              >
                {saving === 'link' ? '등록 중…' : '등록하고 동의 링크 만들기'}
              </Button>
              <Button
                variant="primary"
                disabled={!ready || saving !== null}
                onClick={() => void save('intake')}
              >
                {saving === 'intake' ? '등록 중…' : '등록하고 인테이크 쓰기'}
              </Button>
            </>
          )}
        </FormActions>
      </div>
    </>
  );
}
