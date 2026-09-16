// 당사자 정보 — 탭 4(GLOSSARY §6-4): 회차별 요약 · 15초 다시보기 · 목표 · 정보.
// 당사자 카드와 할 일 전체는 두지 않는다(요구 25·28). 종결 버튼은 `정보` 탭에 있다.
import { useEffect, useState } from 'react';
import {
  documentHref,
  getAccess,
  getCaseDetail,
  getConsentCopy,
  getConsents,
  issueAccess,
  listDocuments,
  recordConsent,
  revokeAccess,
  uploadDocument,
  type AccessState,
  type CaseDetail,
  type ConsentCopy,
  type ConsentView,
  type DocumentRow,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  ConsentDetail,
  DataRows,
  Empty,
  ErrorText,
  Field,
  FormActions,
  Item,
  PageHeader,
} from '../ui.tsx';
import { BriefingScreen } from './briefing.tsx';

const TABS = ['회차별 요약', '15초 다시보기', '목표', '정보'] as const;
type Tab = (typeof TABS)[number];

const dateLabel = (iso: string | null): string => {
  if (!iso) return '날짜 없음';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

/** 회차별 요약 — 회차 목록과 원문. 상담 종결은 회차가 아니므로 번호 없이 따로 붙는다(SPEC §4-3). */
function Sessions({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [openIds, setOpenIds] = useState<number[]>([]);
  const done = detail.sessions.filter((s) => s.status === 'done');

  // 아직 아무 기록이 없으면 **여기서 바로 시작할 수 있어야 한다.**
  // 빈 화면만 보여 주고 어디로 가라는 말이 없으면 위 메뉴를 뒤지게 된다.
  if (done.length === 0) {
    const hasIntake = detail.sessions.some((s) => s.kind === 'intake');
    return (
      <Card title="회차별 요약">
        <Empty>아직 기록한 상담이 없어요.</Empty>
        <FormActions>
          {!hasIntake && (
            <Button
              variant="primary"
              onClick={() => (window.location.hash = `#/cases/${caseId}/intake`)}
            >
              인테이크 작성하기
            </Button>
          )}
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/record`)}>
            상담 기록하기
          </Button>
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/schedule`)}>
            상담 일정 등록
          </Button>
        </FormActions>
      </Card>
    );
  }

  return (
    <>
      <Card title="회차별 요약" hint="AI 없이 만든 기록 상태예요. 요약이 아니에요.">
        {done.map((s) => (
          <div className="wire-repeat-card" key={s.id}>
            <Item
              title={`${s.seq}회차 · ${dateLabel(s.held_at)}${s.kind === 'intake' ? ' · 인테이크' : ''}`}
              desc={s.line}
              action={
                <>
                  <Button
                    onClick={() =>
                      setOpenIds((prev) =>
                        prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                      )
                    }
                  >
                    {openIds.includes(s.id) ? '원문 닫기' : '원문 보기'}
                  </Button>
                  <Button
                    onClick={() => (window.location.hash = `#/cases/${caseId}/sessions/${s.id}/review`)}
                  >
                    AI 정리
                  </Button>
                  {s.kind === 'intake' ? (
                    <Button onClick={() => (window.location.hash = `#/cases/${caseId}/intake`)}>
                      고쳐 쓰기
                    </Button>
                  ) : (
                    <Button
                      onClick={() => (window.location.hash = `#/cases/${caseId}/sessions/${s.id}/edit`)}
                    >
                      고쳐 쓰기
                    </Button>
                  )}
                </>
              }
            />
            {openIds.includes(s.id) && <p className="info-original">{s.memo ?? '수기 기록이 없어요.'}</p>}
          </div>
        ))}
      </Card>
      {detail.closure && (
        <Card title="상담 종결" hint="회차가 아니에요. 번호를 받지 않아요.">
          <Item
            title={dateLabel(detail.closure.closed_at)}
            desc={`${detail.closure.close_reason}${
              detail.closure.unfinished_note ? ` · ${detail.closure.unfinished_note}` : ''
            }`}
          />
        </Card>
      )}
    </>
  );
}

/** 목표 — 전체 상담 목표와 그 수정 이력, 회차별 오늘 상담 목표. */
function Goals({ detail }: { detail: CaseDetail }) {
  const withGoal = detail.sessions.filter((s) => s.today_goal_text);
  const history = detail.goal_revisions;
  return (
    <>
      <Card title="전체 상담 목표">
        {detail.case.overall_goal ? (
          <p className="wire-item-title">{detail.case.overall_goal}</p>
        ) : (
          <Empty>아직 정하지 않았어요. 비워 두어도 괜찮아요.</Empty>
        )}
      </Card>
      <Card title="전체 상담 목표 이력" hint="고쳐도 지난 회차에 찍힌 당시 목표는 그대로예요.">
        {history.length === 0 ? (
          <Empty>아직 이력이 없어요.</Empty>
        ) : (
          history.map((r, i) => (
            <Item
              key={`${r.created_at}-${i}`}
              title={r.text ?? '(비움)'}
              desc={`${dateLabel(r.created_at)}${i === 0 ? ' · 처음 정함' : ' · 고침'}`}
            />
          ))
        )}
      </Card>
      <Card title="회차별 오늘 상담 목표">
        {withGoal.length === 0 ? (
          <Empty>이어받은 목표가 아직 없어요.</Empty>
        ) : (
          withGoal.map((s) => (
            <Item key={s.id} title={s.today_goal_text ?? ''} desc={`${s.seq}회차 · ${dateLabel(s.held_at)}`} />
          ))
        )}
      </Card>
    </>
  );
}

/** 동의 — 영역마다 현재 상태와 그 자리에서 받기·철회. 사건은 쌓이기만 한다. */
function Consents({ caseId }: { caseId: number }) {
  const [rows, setRows] = useState<ConsentView | null>(null);
  const [copies, setCopies] = useState<Record<string, ConsentCopy>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getConsents(caseId).then(setRows);
    // 문안 전체를 서버에서 받는다. 받는 자리마다 같은 것을 보여 줘야 한다(2026-09-16 검수).
    void getConsentCopy().then((list) => setCopies(Object.fromEntries(list.map((c) => [c.domain, c]))));
  }, [caseId]);

  const decide = async (domain: ConsentView[number]['domain'], decision: 'grant' | 'withdraw') => {
    setBusy(true);
    try {
      setRows(await recordConsent(caseId, { domain, decision }));
    } finally {
      setBusy(false);
    }
  };

  const STATUS: Record<string, string> = {
    granted: '동의함',
    not_granted: '동의 없음',
    unconfirmed: '확인 필요',
  };

  return (
    <Card title="동의">
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        rows.map((row) => (
          <div className="wire-repeat-card" key={row.domain}>
            <Item
              title={`${row.label} · ${STATUS[row.status] ?? row.status}`}
              desc={row.copy}
              action={
                row.status === 'granted' ? (
                  <Button disabled={busy} onClick={() => void decide(row.domain, 'withdraw')}>
                    철회
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => void decide(row.domain, 'grant')}>
                    동의 받기
                  </Button>
                )
              }
            />
            {row.decided_at && <p className="panel-meta">{dateLabel(row.decided_at)}</p>}
            {copies[row.domain] && <ConsentDetail copy={copies[row.domain]} />}
          </div>
        ))
      )}
    </Card>
  );
}

/**
 * 당사자 열람 링크(P2). 당사자는 로그인하지 않는다 — 링크와 코드를 전해 준다.
 * **코드는 발급 직후 한 번만 보인다.** 저장해 두지 않는다(해시만 남는다).
 */
function Access({ caseId }: { caseId: number }) {
  const [state, setState] = useState<AccessState | null>(null);
  const [issued, setIssued] = useState<{ token: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAccess(caseId).then(setState);
  }, [caseId]);

  const link = issued ? `${window.location.origin}/#/access/${issued.token}` : null;

  const issue = async () => {
    setBusy(true);
    try {
      const next = await issueAccess(caseId);
      setIssued({ token: next.token, code: next.code });
      setState(await getAccess(caseId));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await revokeAccess(caseId);
      setIssued(null);
      setState(await getAccess(caseId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="당사자 열람"
      hint="당사자는 로그인하지 않아요. 링크와 여섯 자리 숫자를 전해 주면 자기 정보와 일정만 봐요."
    >
      {state === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        <>
          <Item
            title={state.active ? '열람 링크가 살아 있어요' : '열람 링크가 없어요'}
            desc={
              state.active
                ? [
                    state.expires_at ? `${dateLabel(state.expires_at)}까지` : null,
                    state.last_opened_at ? `마지막 열람 ${dateLabel(state.last_opened_at)}` : '아직 연 적 없음',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '새로 만들면 이전 링크는 잠겨요.'
            }
          />
          {issued && link && (
            <div className="wire-repeat-card">
              <p className="panel-meta">이 화면을 닫으면 코드는 다시 볼 수 없어요. 지금 전해 주세요.</p>
              <DataRows
                rows={[
                  ['링크', link],
                  ['확인 코드', issued.code],
                ]}
              />
            </div>
          )}
          <FormActions>
            {state.active && (
              <Button disabled={busy} onClick={() => void revoke()}>
                잠그기
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void issue()}>
              {state.active ? '새로 만들기' : '열람 링크 만들기'}
            </Button>
          </FormActions>
        </>
      )}
    </Card>
  );
}

/**
 * 서면 문서 — 상담 중 받은 종이·파일을 사례에 붙인다(2026-09-16 Q).
 * 올리려면 `서면 문서 보관` 동의가 있어야 하고, **내려받으면 감사에 남는다.**
 */
function Documents({ caseId }: { caseId: number }) {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listDocuments(caseId).then(setRows);
  }, [caseId]);

  const add = async () => {
    if (!file || !label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocument(caseId, file, label.trim());
      setRows(await listDocuments(caseId));
      setLabel('');
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const size = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

  return (
    <Card
      title="서면 문서"
      hint="상담에서 받은 종이·파일이에요. 기관 안에만 두고 1년 뒤 지워요. 누가 열었는지 기록에 남아요."
    >
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : rows.length === 0 ? (
        <Empty>받은 문서가 없어요.</Empty>
      ) : (
        rows.map((d) => (
          <div className="wire-repeat-card" key={d.id}>
            <Item
              title={d.label}
              desc={`${size(d.bytes)} · ${dateLabel(d.created_at)} 받음 · ${dateLabel(d.delete_after)}에 지워요${
                d.deleted_at ? ' · 지워짐' : ''
              }`}
              action={
                d.deleted_at ? undefined : (
                  <a className="wire-button" data-variant="secondary" href={documentHref(d.id)}>
                    <span className="wire-button-text">내려받기</span>
                  </a>
                )
              }
            />
          </div>
        ))
      )}

      <Field label="문서 이름" htmlFor="doc-label" hint="예: 채무 내역서, 진단서. 파일 이름은 쓰지 않아요.">
        <input id="doc-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="파일" htmlFor="doc-file" hint="PDF·이미지·문서 파일, 20MB 까지.">
        <input
          id="doc-file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.docx,.hwp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <FormActions>
        {error && <ErrorText>{error}</ErrorText>}
        <Button variant="primary" disabled={busy || !file || !label.trim()} onClick={() => void add()}>
          {busy ? '올리는 중…' : '문서 올리기'}
        </Button>
      </FormActions>
    </Card>
  );
}

/**
 * 15초 다시보기 탭 — **회차를 골라 그때 화면을 본다**(2026-09-16 Q).
 * 기본은 `지금`이다. 다음 상담을 준비하는 화면이고 그것이 이 제품의 본래 쓰임이다.
 * 지난 회차를 고르면 그 회차까지 쌓여 있던 것이 그대로 선다.
 */
function BriefingTab({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const done = detail.sessions.filter((s) => s.status === 'done');
  const [seq, setSeq] = useState<number | undefined>(undefined);

  return (
    <>
      {done.length > 0 && (
        <Card title="언제 시점으로 볼까요" hint="지난 회차를 고르면 그때까지 쌓여 있던 것만 보여요.">
          <div className="info-tabs">
            <button
              type="button"
              className="wire-step"
              data-active={seq === undefined}
              onClick={() => setSeq(undefined)}
            >
              지금
            </button>
            {done.map((s) => (
              <button
                key={s.id}
                type="button"
                className="wire-step"
                data-active={seq === s.seq}
                onClick={() => setSeq(s.seq)}
              >
                {s.seq}회차
              </button>
            ))}
          </div>
        </Card>
      )}
      <BriefingScreen caseId={caseId} hideHeader seq={seq} />
    </>
  );
}

/** 정보 — 기본 정보와 상담 종결 버튼. */
function Info({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const rows: Array<[string, string]> = [
    ['이름', detail.participant.name ?? '—'],
    ['연락처', detail.participant.phone ?? '—'],
    ['이메일', detail.participant.email ?? '—'],
    ['가명', detail.pseudonym],
    ['참여 사업', detail.case.program_name],
    ['예정 회차', detail.case.sessions_planned ? `${detail.case.sessions_planned}회` : '정하지 않음'],
  ];
  return (
    <>
      <Card title="기본 정보" hint="이름·연락처·이메일은 금고에서 꺼내 보여 줘요. 상담 기록에는 남지 않아요.">
        <DataRows rows={rows} />
      </Card>
      <Consents caseId={caseId} />

      <Documents caseId={caseId} />

      <Access caseId={caseId} />

      <Card title="상담 종결">
        {detail.closure ? (
          <Empty>{`${dateLabel(detail.closure.closed_at)}에 종결했어요. · ${detail.closure.close_reason}`}</Empty>
        ) : (
          <>
            <p className="panel-meta">
              미완료 과제 {detail.open_cards.filter((c) => c.kind === 'promise').length}건이 남아 있어요. 종결
              화면에서 함께 확인해요.
            </p>
            <FormActions>
              <Button onClick={() => (window.location.hash = `#/cases/${caseId}/close`)}>상담 종결</Button>
            </FormActions>
          </>
        )}
      </Card>
    </>
  );
}

export function ParticipantInfoScreen({ caseId }: { caseId: number }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<Tab>('회차별 요약');

  useEffect(() => {
    void getCaseDetail(caseId).then(setDetail);
  }, [caseId]);

  if (!detail) return <p className="empty">불러오는 중이에요.</p>;

  return (
    <>
      <PageHeader
        title="당사자 정보"
        meta={
          <>
            {`${detail.participant.name ?? detail.pseudonym} · ${detail.case.program_name}`}
            {detail.case.status === 'closed' && <Badge>종결</Badge>}
          </>
        }
      />
      <div className="wire-container">
        <div className="info-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className="wire-step"
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '회차별 요약' && <Sessions detail={detail} caseId={caseId} />}
        {tab === '목표' && <Goals detail={detail} />}
        {tab === '정보' && <Info detail={detail} caseId={caseId} />}
      </div>
      {/* 15초 다시보기는 같은 화면을 그대로 쓴다. 두 벌로 만들지 않는다. */}
      {tab === '15초 다시보기' && <BriefingTab detail={detail} caseId={caseId} />}
    </>
  );
}
