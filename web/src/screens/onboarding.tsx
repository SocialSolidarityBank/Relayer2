/**
 * 기관 워크스페이스 설정하기(2026-09-17 Q). 관리자 전용, 단계형.
 *
 *   1 기관 워크스페이스 → 2 기관 정보 → 3 사업 → 4 실무자 초대 → 5 외부 서비스 연결
 *
 * 1단계는 워크스페이스(기관 이름)가 아직 없을 때만 선다 — 계정 가입과 기관 만들기를 갈라 둔 자리다(ASTRA 검토 B).
 * 설정 화면의 부품(기관 정보 칸·사업 목록·초대·연결)을 그대로 쓴다. 문구는 명사형이고 설명 문장은 두지 않는다.
 * `다음` 이 곧 저장이다(기관 정보). 완료가 `POST /settings/onboarding/complete` 로 `onboarded_at` 을 찍고, 그 뒤는 셸이 정한다
 * (기관 요약 `#/workspace?done=1` → 상담 일정). 마치기 전에는 셸이 관리자를 이 화면으로 되돌린다.
 * 단계를 옮길 때마다 `PUT /settings/onboarding/step` 에 적어, 세션이 끊겨도 `me.onboarding_step` 자리에서 다시 선다(QA P2 #9).
 */
import { Fragment, useState } from 'react';
import { completeOnboarding, getOrg, saveOnboardingStep, saveOrg, type Me, type Org, type Program } from '../api.ts';
import { Button, Card, DataRows, Empty, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';
import { ConnectionsPane, InvitePane, LoadError, OrgForm, orgPayload, ProgramsPane, useLoad } from './settings.tsx';

const STEPS = ['기관 워크스페이스', '기관 정보', '사업', '실무자 초대', '외부 서비스 연결'] as const;

/** 1단계. 기관명 한 칸. 주소는 배포 설정(읽기 전용) — 있을 때만 값으로 보인다. 만들기 버튼은 제목 줄 오른쪽 끝이다. */
function WorkspaceStep({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const org = useLoad(getOrg);
  const address = org.data?.public_address ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await saveOrg({ name: name.trim(), reg_no: null, address: null, phone: null });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들기 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="기관 정보 입력"
      action={
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? '만드는 중' : '기관 워크스페이스 만들기'}
        </Button>
      }
    >
      {org.error && <LoadError error={org.error} onRetry={org.reload} />}
      {err && <ErrorText>{err}</ErrorText>}
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6">
          <Field label="기관명" htmlFor="ws-name" required>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          </Field>
        </div>
        {/* 주소는 입력칸이 아니라 값이다(2026-09-18 Q). 배포 설정이 없으면 행 자체를 두지 않는다 — 빈 칸 금지. */}
        {address && (
          <div className="wire-col-6">
            <DataRows rows={[['주소', address]]} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** 2단계. 기관 정보 네 칸(2행 2열). `다음` 이 저장한다. */
function OrgStep({ address, onNext }: { address: string | null; onNext: () => void }) {
  const { data: org, setData: setOrg, error, reload } = useLoad(getOrg);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Card title="기관 정보"><LoadError error={error} onRetry={reload} /></Card>;
  if (!org) return <Empty>불러오는 중</Empty>;
  const next = async () => {
    if (!org.name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await saveOrg(orgPayload(org));
      onNext();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title="기관 정보" badge={address ?? undefined}>
        {err && <ErrorText>{err}</ErrorText>}
        <OrgForm value={org} onChange={(next) => setOrg({ ...org, ...next })} />
      </Card>
      <FormActions>
        <Button variant="primary" disabled={busy || !org.name.trim()} onClick={() => void next()}>
          {busy ? '저장 중' : '다음'}
        </Button>
      </FormActions>
    </>
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
  // 워크스페이스가 있으면 1단계는 지났다. 그 뒤는 서버가 적어 둔 단계다(재진입).
  const [step, setStep] = useState(me.workspace ? Math.max(1, me.onboarding_step) : 0);
  // 단계를 옮기면 서버에도 적는다. 실패해도 진행은 막지 않는다 — 재진입 자리가 한 단계 뒤일 뿐이다.
  const go = (i: number) => {
    setStep(i);
    saveOnboardingStep(i).catch(() => undefined);
  };
  const [livePrograms, setLivePrograms] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (me.role !== 'admin')
    return (
      <>
        <PageHeader title="기관 워크스페이스 설정하기" />
        <Card title="관리자가 설정 중">
          <Empty>설정 완료 후 상담 일정부터 이용 가능</Empty>
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
      setErr(e instanceof Error ? e.message : '완료 실패');
    } finally {
      setBusy(false);
    }
  };

  const last = step === STEPS.length - 1;
  // 사업 단계만 조건이 있다(하나 이상). 초대는 건너뛸 수 있고, 연결은 확인만 한다.
  const canNext = step === 2 ? (livePrograms ?? 0) > 0 : true;

  return (
    <>
      <PageHeader title="기관 워크스페이스 설정하기" meta={`${step + 1} / ${STEPS.length}`} />
      <ol className="schedule-wizard-steps" role="tablist" aria-label="설정 단계">
        {STEPS.map((label, i) => (
          <Fragment key={label}>
            {i > 0 && (
              <li aria-hidden="true" className="schedule-wizard-arrow">
                →
              </li>
            )}
            <li>
              <button
                type="button"
                role="tab"
                className={`wire-step${step === i ? ' wire-step-current' : i < step ? ' wire-step-done' : ''}`}
                aria-selected={step === i}
                // 지난 단계로는 돌아갈 수 있다. 앞 단계로 건너뛰지는 못한다. 1단계는 지나면 다시 서지 않는다.
                disabled={i > step || (i === 0 && me.workspace !== null)}
                onClick={() => go(i)}
              >
                {i + 1}. {label}
              </button>
            </li>
          </Fragment>
        ))}
      </ol>

      {step === 0 && (
        <WorkspaceStep
          onCreated={() => {
            onWorkspace();
            go(1);
          }}
        />
      )}
      {step === 1 && <OrgStep address={me.workspace?.public_address ?? null} onNext={() => go(2)} />}
      {step === 2 && (
        <ProgramsPane onChanged={(rows: Program[]) => setLivePrograms(rows.filter((p) => !p.retired_at).length)} />
      )}
      {step === 3 && <InvitePane />}
      {step === 4 && <ConnectionsPane />}

      {step >= 2 && (
        <FormActions>
          {err && <ErrorText>{err}</ErrorText>}
          <Button onClick={() => go(step - 1)}>이전</Button>
          <Button variant="primary" disabled={busy || !canNext} onClick={() => (last ? void finish() : go(step + 1))}>
            {busy ? '완료 중' : last ? '완료' : '다음'}
          </Button>
        </FormActions>
      )}
    </>
  );
}
