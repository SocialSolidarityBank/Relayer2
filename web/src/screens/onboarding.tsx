/**
 * 기관 준비 마법사(2026-09-17 Q). 관리자 전용, 단계형.
 *
 *   0 기관 워크스페이스 만들기(이름 · 주소 이름 확인) → 1 기관 정보 → 2 사업 1개 이상 → 3 실무자 초대(건너뛰기 가능) → 4 API 연결 → 완료
 *
 * 0단계는 워크스페이스(기관 이름)가 아직 없을 때만 선다. 계정 가입과 기관 만들기를 갈라 둔 자리다(ASTRA 검토 B).
 * 새 화면 부품을 만들지 않는다 — 설정의 기관 정보·사업 목록·초대·API 연결 폼을 그대로 쓴다.
 * 완료가 `POST /settings/onboarding/complete` 로 `onboarded_at` 을 찍는다. 그 뒤 어디로 가는지는 셸이 정한다
 * (기관 요약 `#/workspace?done=1` → 상담 일정). 마치기 전에는 셸이 관리자를 이 화면으로 되돌린다(클라이언트 리다이렉트).
 */
import { useEffect, useState } from 'react';
import { completeOnboarding, getOrg, saveOrg, type Me, type Program } from '../api.ts';
import { Button, Card, DataRows, Empty, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';
import { ConnectionsPane, InvitePane, OrgPane, ProgramsPane } from './settings.tsx';

const STEPS = ['기관 워크스페이스', '기관 정보', '사업', '실무자 초대', 'API 연결'] as const;

/** 0단계. 기관 이름 하나로 워크스페이스가 생긴다. 주소 이름은 배포자가 정한 것이라 읽기만 한다. */
function WorkspaceStep({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    void getOrg().then((org) => setSlug(org.slug));
  }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveOrg({ name: name.trim(), reg_no: null, address: null, phone: null });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="기관 워크스페이스를 만들어요" hint="이 배포는 기관 하나의 것이에요. 이름은 나중에 기관 정보에서 고칠 수 있어요.">
      <Field label="기관 이름" htmlFor="ws-name" required>
        <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <DataRows
        rows={[
          ['주소 이름', slug ?? '아직 정해지지 않았어요'],
          ['설명', '이 기관에 설정된 접속 주소 이름이에요. 배포할 때 정하고, 바꾸려면 배포 절차(docs/deploy.md)를 따라요.'],
        ]}
      />
      <FormActions>
        {err && <ErrorText>{err}</ErrorText>}
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? '만드는 중…' : '기관 워크스페이스 만들기'}
        </Button>
      </FormActions>
    </Card>
  );
}

export function OnboardingScreen({
  me,
  onWorkspace,
  onDone,
}: {
  me: Me;
  onWorkspace: () => void;
  onDone: () => void;
}) {
  // 워크스페이스가 있으면 0단계는 지났다.
  const [step, setStep] = useState(me.workspace ? 1 : 0);
  const [orgSaved, setOrgSaved] = useState(false);
  const [livePrograms, setLivePrograms] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (me.role !== 'admin')
    return (
      <>
        <PageHeader title="기관 준비" />
        <Card title="관리자가 준비하는 중이에요">
          <Empty>기관 준비는 관리자가 마쳐요. 끝나면 상담 일정부터 함께 쓸 수 있어요.</Empty>
        </Card>
      </>
    );

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await completeOnboarding();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '마치지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  // 단계마다 다음으로 갈 조건. 0단계는 만들기 버튼이 곧 다음이다. 초대는 건너뛸 수 있고, API 연결은 확인만 한다.
  const canNext = step === 1 ? orgSaved : step === 2 ? (livePrograms ?? 0) > 0 : true;
  const last = step === STEPS.length - 1;
  const hint = [
    '기관 이름을 적으면 기관 워크스페이스가 생겨요.',
    '기관 정보를 저장하면 다음으로 갈 수 있어요.',
    '사업이 하나 이상 있어야 당사자를 등록할 수 있어요.',
    '함께 쓸 실무자에게 초대 링크를 만들어 건네요. 지금 없으면 건너뛰어도 돼요 — 설정 › 실무자 관리에서 언제든 할 수 있어요.',
    'OpenAI 키는 여기서 넣어요. STT·데이터베이스는 기관 서버에 설치해야 해서 붙어 있는지만 봐요.',
  ][step];

  return (
    <>
      <PageHeader title="기관 준비" meta={`${step + 1} / ${STEPS.length} 단계`} />
      <div className="info-tabs" role="tablist" aria-label="기관 준비 단계">
        {STEPS.map((label, i) => (
          <button
            type="button"
            role="tab"
            key={label}
            className="wire-step"
            data-active={step === i}
            aria-selected={step === i}
            // 지난 단계로는 돌아갈 수 있다. 앞 단계로 건너뛰지는 못한다. 0단계는 지나면 다시 서지 않는다.
            disabled={i > step || (i === 0 && me.workspace !== null)}
            onClick={() => setStep(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="panel-meta">{hint}</p>

      {step === 0 && (
        <WorkspaceStep
          onCreated={() => {
            onWorkspace();
            setStep(1);
          }}
        />
      )}
      {step === 1 && <OrgPane onSaved={() => setOrgSaved(true)} />}
      {step === 2 && (
        <ProgramsPane onChanged={(rows: Program[]) => setLivePrograms(rows.filter((p) => !p.retired_at).length)} />
      )}
      {step === 3 && <InvitePane />}
      {step === 4 && <ConnectionsPane />}

      {step > 0 && (
        <FormActions>
          {err && <ErrorText>{err}</ErrorText>}
          {step > 1 && <Button onClick={() => setStep(step - 1)}>이전</Button>}
          <Button variant="primary" disabled={busy || !canNext} onClick={() => (last ? void finish() : setStep(step + 1))}>
            {busy ? '마치는 중…' : last ? '마치기' : '다음'}
          </Button>
        </FormActions>
      )}
    </>
  );
}
