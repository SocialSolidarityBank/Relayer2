/**
 * 기관 워크스페이스 설정하기(2026-09-17 Q). 관리자 전용, 단계형.
 *
 *   1 기관 워크스페이스 → 2 기관 정보 → 3 사업 → 4 실무자 초대 → 5 AI/STT/DB 연결
 *
 * 1단계는 워크스페이스(기관 이름)가 아직 없을 때만 선다 — 계정 가입과 기관 만들기를 갈라 둔 자리다(ASTRA 검토 B).
 * 설정 화면의 부품(기관 정보 칸·사업 목록·초대·연결)을 그대로 쓴다. 문구는 명사형이고 설명 문장은 두지 않는다.
 * `다음` 이 곧 저장이다(기관 정보). 완료가 `POST /settings/onboarding/complete` 로 `onboarded_at` 을 찍고, 그 뒤는 셸이 정한다
 * (기관 요약 `#/workspace?done=1` → 상담 일정). 마치기 전에는 셸이 관리자를 이 화면으로 되돌린다.
 */
import { Fragment, useEffect, useState } from 'react';
import { completeOnboarding, getOrg, saveOrg, type Me, type Org, type Program } from '../api.ts';
import { Button, Card, Empty, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';
import { ConnectionsPane, InvitePane, OrgForm, orgPayload, ProgramsPane } from './settings.tsx';

const STEPS = ['기관 워크스페이스', '기관 정보', '사업', '실무자 초대', 'AI/STT/DB 연결'] as const;

/** 1단계. 기관명 · 주소 이름 한 줄. 만들기 버튼은 제목 줄 오른쪽 끝이다. */
function WorkspaceStep({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // 배포 설정(RELAYER_SLUG)이 있으면 그 값이 기본이다.
    void getOrg().then((org) => setSlug(org.slug ?? ''));
  }, []);
  const slugOk = slug === '' || /^[a-z0-9-]+$/.test(slug);
  const create = async () => {
    if (!name.trim() || !slugOk || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await saveOrg({ name: name.trim(), reg_no: null, address: null, phone: null, slug: slug.trim() || null });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="기관 정보 입력"
      actions={
        <Button variant="primary" disabled={busy || !name.trim() || !slugOk} onClick={() => void create()}>
          {busy ? '만드는 중…' : '기관 워크스페이스 만들기'}
        </Button>
      }
    >
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
        <div className="wire-col-6">
          <Field label="주소 이름" htmlFor="ws-slug">
            <input id="ws-slug" value={slug} onChange={(e) => setSlug(e.target.value.trim())} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

/** 2단계. 기관 정보 네 칸(2행 2열). `다음` 이 저장한다. */
function OrgStep({ slug, onNext }: { slug: string | null; onNext: () => void }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getOrg().then(setOrg);
  }, []);
  if (!org) return <Empty>불러오는 중이에요.</Empty>;
  const next = async () => {
    if (!org.name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await saveOrg(orgPayload(org));
      onNext();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title="기관 정보" badge={slug ?? undefined}>
        {err && <ErrorText>{err}</ErrorText>}
        <OrgForm value={org} onChange={setOrg} />
      </Card>
      <FormActions>
        <Button variant="primary" disabled={busy || !org.name.trim()} onClick={() => void next()}>
          {busy ? '저장 중…' : '다음'}
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
  // 워크스페이스가 있으면 1단계는 지났다.
  const [step, setStep] = useState(me.workspace ? 1 : 0);
  const [livePrograms, setLivePrograms] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (me.role !== 'admin')
    return (
      <>
        <PageHeader title="기관 워크스페이스 설정하기" />
        <Card title="관리자가 설정 중">
          <Empty>설정이 끝나면 상담 일정부터 쓸 수 있어요.</Empty>
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
                onClick={() => setStep(i)}
              >
                {i + 1} {label}
              </button>
            </li>
          </Fragment>
        ))}
      </ol>

      {step === 0 && (
        <WorkspaceStep
          onCreated={() => {
            onWorkspace();
            setStep(1);
          }}
        />
      )}
      {step === 1 && <OrgStep slug={me.workspace?.slug ?? null} onNext={() => setStep(2)} />}
      {step === 2 && (
        <ProgramsPane onChanged={(rows: Program[]) => setLivePrograms(rows.filter((p) => !p.retired_at).length)} />
      )}
      {step === 3 && <InvitePane />}
      {step === 4 && <ConnectionsPane />}

      {step >= 2 && (
        <FormActions>
          {err && <ErrorText>{err}</ErrorText>}
          <Button onClick={() => setStep(step - 1)}>이전</Button>
          <Button variant="primary" disabled={busy || !canNext} onClick={() => (last ? void finish() : setStep(step + 1))}>
            {busy ? '마치는 중…' : last ? '마치기' : '다음'}
          </Button>
        </FormActions>
      )}
    </>
  );
}
