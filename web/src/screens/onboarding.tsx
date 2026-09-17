/**
 * 기관 준비 마법사(2026-09-17 Q). 관리자 전용, 단계형.
 *
 *   기관 정보 → 사업 1개 이상 → 실무자 초대(건너뛰기 가능) → API 연결 → 완료
 *
 * 새 화면 부품을 만들지 않는다 — 설정의 기관 정보·사업 목록·초대·API 연결 폼을 그대로 쓴다.
 * 완료가 `POST /settings/onboarding/complete` 로 `onboarded_at` 을 찍고 당사자 등록으로 보낸다.
 * 마치기 전에는 셸이 관리자를 이 화면으로 되돌린다(클라이언트 리다이렉트, 서버 잠금은 없다).
 */
import { useState } from 'react';
import { completeOnboarding, type Program } from '../api.ts';
import { Button, Card, Empty, ErrorText, FormActions, PageHeader } from '../ui.tsx';
import { ConnectionsPane, InvitePane, OrgPane, ProgramsPane } from './settings.tsx';

const STEPS = ['기관 정보', '사업', '실무자 초대', 'API 연결'] as const;

export function OnboardingScreen({ me, onDone }: { me: { role: string }; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [orgSaved, setOrgSaved] = useState(false);
  const [livePrograms, setLivePrograms] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (me.role !== 'admin')
    return (
      <>
        <PageHeader title="기관 준비" />
        <Card title="관리자가 준비하는 중이에요">
          <Empty>기관 준비는 관리자가 마쳐요. 끝나면 당사자 등록부터 함께 쓸 수 있어요.</Empty>
        </Card>
      </>
    );

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await completeOnboarding();
      // 어디로 갈지는 셸이 정한다(당사자 등록). 주소와 onboarded 를 한 번에 바꿔야 튕기지 않는다.
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '마치지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  // 단계마다 다음으로 갈 조건. 초대는 건너뛸 수 있고, API 연결은 확인만 한다.
  const canNext = step === 0 ? orgSaved : step === 1 ? (livePrograms ?? 0) > 0 : true;
  const nextLabel = step === STEPS.length - 1 ? '마치기' : '다음';
  const hint =
    step === 0
      ? '기관 정보를 저장하면 다음으로 갈 수 있어요.'
      : step === 1
        ? '사업이 하나 이상 있어야 당사자를 등록할 수 있어요.'
        : step === 2
          ? '함께 쓸 실무자에게 초대 링크를 건네요. 지금 없으면 건너뛰어도 돼요 — 설정 › 실무자 관리에서 언제든 할 수 있어요.'
          : 'OpenAI 키는 여기서 넣어요. STT·데이터베이스는 기관 서버에 설치해야 해서 붙어 있는지만 봐요.';

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
            // 지난 단계로는 돌아갈 수 있다. 앞 단계로 건너뛰지는 못한다.
            disabled={i > step}
            onClick={() => setStep(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="panel-meta">{hint}</p>

      {step === 0 && <OrgPane onSaved={() => setOrgSaved(true)} />}
      {step === 1 && <ProgramsPane onChanged={(rows: Program[]) => setLivePrograms(rows.filter((p) => !p.retired_at).length)} />}
      {step === 2 && <InvitePane />}
      {step === 3 && <ConnectionsPane />}

      <FormActions>
        {err && <ErrorText>{err}</ErrorText>}
        {step > 0 && <Button onClick={() => setStep(step - 1)}>이전</Button>}
        <Button
          variant="primary"
          disabled={busy || !canNext}
          onClick={() => (step === STEPS.length - 1 ? void finish() : setStep(step + 1))}
        >
          {busy ? '마치는 중…' : nextLabel}
        </Button>
      </FormActions>
    </>
  );
}
