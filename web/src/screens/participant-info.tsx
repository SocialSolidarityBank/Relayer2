// 당사자 정보 — **당사자 카드(HERO)가 머리**이고 그 아래 탭 4개가 화면을 가른다
// (2026-09-17 Q): 당사자 정보 · 회차별 요약 · 회차별 원본 보기 · 목표.
// 15초 다시보기는 폐지했다(2026-09-17 Q) — 화면·탭·버튼 어디에도 두지 않는다.
import { useEffect, useState, type ReactNode } from 'react';
import {
  documentHref,
  getAccess,
  getBriefing,
  getCaseDetail,
  getConsentCopy,
  getConsents,
  issueAccess,
  listDocuments,
  recordConsent,
  revokeAccess,
  updateNextGoal,
  updateOverallGoal,
  uploadDocument,
  type AccessState,
  type Briefing,
  type CaseDetail,
  type ConsentCopy,
  type ConsentView,
  type DocumentRow,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  Choice,
  Confirm,
  DataRows,
  Empty,
  ErrorText,
  FactChanges,
  Field,
  Fold,
  FormActions,
  Item,
  ParticipantHero,
} from '../ui.tsx';
import { Dialog } from '../dialog.tsx';

const TABS = ['당사자 정보', '회차별 요약', '회차별 원본 보기', '목표'] as const;
type Tab = (typeof TABS)[number];

const dateLabel = (iso: string | null): string => {
  if (!iso) return '날짜 없음';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

/** 회차별 요약 — 회차 목록과 원문. 상담 종결은 회차가 아니므로 번호 없이 따로 붙는다(SPEC §4-3). */
const TRANSCRIPT_LABEL: Record<string, string> = {
  pending: '전사 중',
  draft: '전사 초안(확인 전)',
  approved: '전사 확인됨',
  failed: '전사 실패',
  skipped: '전사 건너뜀',
};

const AI_OFF_LABEL: Record<string, string> = {
  ai_disabled: 'AI 확인 안 함',
  pending: '확인 중',
};

/**
 * 위험 신호 배너 — **회차별 요약의 맨 위**다(2026-09-17 Q — 구 15초 다시보기 자리).
 * 비어도 빠지지 않고 상태를 쓴다. 화면에서 유일한 위험색 테두리이고 접히지 않는다.
 * 확정된 위험 카드만 싣는다(`kind='judgment'` + `risk_type`) — 그 판정은 서버가 한다.
 */
/**
 * 회차별 요약 — **한 회차가 한 접힘 카드**다(2026-09-17 Q). 상단 `위험 신호` 배너는 걷었다:
 * 본문 중심으로 가고, 위험 신호는 그 신호가 나온 회차 카드가 스스로 말한다(`is-crisis`).
 *
 * 접힌 머리는 `N회차`(16/600) + 날짜·종류(13/400, 세로선 없이 여백) + 배지(`AI`·`위험 신호`)
 * + 행동(`AI 정리 검토`/`AI 정리 보기`·`수정`)이다. 펼친 본문은 **테두리 없는 텍스트 구역**들이고
 * 카드 안 카드를 만들지 않는다: 핵심 요약 · 지난 회차와 불일치 · 위험 신호 · 상태.
 */
function Sessions({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [risk, setRisk] = useState<Briefing['risk_signals'] | null>(null);
  useEffect(() => {
    void getBriefing(caseId).then((b) => setRisk(b.risk_signals));
  }, [caseId]);

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
      <Card title="회차별 요약">
        {/* 최신순이다(2026-09-17 Q) — 회차 정보 표와 같은 순서다. */}
        {[...done].reverse().map((s) => {
          const risks = (risk?.items ?? []).filter((r) => r.source_session_seq === s.seq);
          const transcriptLabel =
            s.voice.recordings > 0 ? TRANSCRIPT_LABEL[s.voice.transcript] : undefined;
          const state = [
            s.line,
            s.written === false ? '수기 미작성' : null,
            s.voice.recordings > 0 ? `녹음 ${s.voice.recordings}` : null,
            transcriptLabel ?? null,
          ]
            .filter(Boolean)
            .join(' | ');
          return (
            <Fold
              key={s.id}
              group="sessions"
              crisis={risks.length > 0}
              title={
                <>
                  <span className="seq-head-no">{s.seq}회차</span>
                  <span className="seq-head-meta">{dateLabel(s.held_at)}</span>
                  {s.kind === 'intake' && <span className="seq-head-meta">인테이크</span>}
                  {s.ai_summary && <Badge tone="blue">AI</Badge>}
                  {risks.length > 0 && <Badge>위험 신호 {risks.length}</Badge>}
                </>
              }
              action={
                <>
                  {/* 이름이 상태를 말한다(2026-09-17 Q): 승인 전에는 검토, 승인 뒤에는 보기. */}
                  <Button
                    onClick={(event) => {
                      event.stopPropagation();
                      window.location.hash = `#/cases/${caseId}/sessions/${s.id}/review`;
                    }}
                  >
                    {s.ai_summary ? 'AI 정리 보기' : 'AI 정리 검토'}
                  </Button>
                  <Button
                    onClick={(event) => {
                      event.stopPropagation();
                      window.location.hash =
                        s.kind === 'intake'
                          ? `#/cases/${caseId}/intake`
                          : `#/cases/${caseId}/sessions/${s.id}/edit`;
                    }}
                  >
                    수정
                  </Button>
                </>
              }
            >
              <div className="seq-sections">
                {risks.length > 0 && (
                  <section className="seq-section">
                    <h3 className="seq-section-title is-risk">위험 신호</h3>
                    {risks.map((r) => (
                      <p className="wire-item-title" key={r.card_id}>
                        {r.text}
                        {r.last_result === 'unchecked' && <span className="seq-section-note">지난 회차 미확인</span>}
                      </p>
                    ))}
                    <p className="seq-section-note">
                      {risk ? (AI_OFF_LABEL[risk.status.reason ?? 'ai_disabled'] ?? risk.status.state) : '확인 중'}
                    </p>
                  </section>
                )}
                {s.ai_summary ? (
                  <section className="seq-section">
                    <h3 className="seq-section-title">
                      핵심 요약 <Badge tone="blue">AI</Badge>
                    </h3>
                    <p className="seq-section-note">원본에서 핵심 문장만 AI가 정리한 요약본</p>
                    <p className="wire-item-desc">{s.ai_summary.summary}</p>
                    {s.ai_summary.changes.length > 0 && (
                      <p className="wire-item-desc">달라진 것: {s.ai_summary.changes.join(', ')}</p>
                    )}
                  </section>
                ) : null}
                {s.ai_summary && (
                  <section className="seq-section">
                    <h3 className="seq-section-title">지난 회차와 불일치</h3>
                    {s.ai_summary.fact_changes.length === 0 ? (
                      <p className="seq-section-note">어긋나는 사실 없음</p>
                    ) : (
                      <FactChanges items={s.ai_summary.fact_changes} />
                    )}
                  </section>
                )}
                {state && (
                  <section className="seq-section">
                    <h3 className="seq-section-title">기록 상태</h3>
                    <p className="wire-item-desc">{state}</p>
                  </section>
                )}
              </div>
            </Fold>
          );
        })}
      </Card>
      {detail.closure && (
        <Card title="상담 종결" hint="회차가 아니에요. 번호를 받지 않아요.">
          <Item
            title={dateLabel(detail.closure.closed_at)}
            desc={`${detail.closure.close_reason}${
              detail.closure.unfinished_note ? `, ${detail.closure.unfinished_note}` : ''
            }`}
          />
        </Card>
      )}
    </>
  );
}

/**
 * 목표 — 고칠 수 있는 건 둘뿐이다(2026-09-18 Q): 전체 상담 목표(이력 남김)와 아직 이어받지 않은
 * 다음 상담 목표. 지난 회차의 오늘 상담 목표는 그 회차 기록 당시 기준이라 읽기만 한다.
 * 이력과 회차별 목표는 `지난 목표 보기` 모달로 뺀다 — AI·전사 비교 기준이라 남기되 탭을 어지럽히지 않는다.
 */
function Goals({ detail, reload }: { detail: CaseDetail; reload: () => Promise<void> }) {
  const [overall, setOverall] = useState(detail.case.overall_goal ?? '');
  const [next, setNext] = useState(detail.pending_next_goal?.text ?? '');
  const [saving, setSaving] = useState<'overall' | 'next' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const withGoal = detail.sessions.filter((s) => s.today_goal_text);
  const history = detail.goal_revisions;
  const pending = detail.pending_next_goal;

  const save = async (which: 'overall' | 'next') => {
    setSaving(which);
    setError(null);
    try {
      if (which === 'overall') await updateOverallGoal(detail.case.id, overall.trim() || null);
      else if (pending) await updateNextGoal(pending.session_id, next.trim() || null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <Card title="전체 상담 목표" hint="고치면 이전 문구는 이력에 남아요. 비워 두어도 괜찮아요.">
        <Field label="전체 상담 목표" htmlFor="goal-overall" hideLabel>
          <input
            id="goal-overall"
            type="text"
            aria-label="전체 상담 목표"
            value={overall}
            onChange={(e) => setOverall(e.target.value)}
          />
        </Field>
        <FormActions>
          <Dialog id="goal-history" title="지난 목표" trigger="지난 목표 보기">
            {/* 최신순이다(2026-09-17 Q — 회차 정보 표·회차별 요약과 같은 순서).
                `승인`/`수정` 라벨은 원래 순서의 첫 줄(처음 적은 목표)에만 `승인`이 붙는다. */}
            <Card title="전체 상담 목표 이력">
              {history.length === 0 ? (
                <Empty>아직 이력이 없어요.</Empty>
              ) : (
                [...history].reverse().map((r, j) => (
                  <Item
                    key={`${r.created_at}-${j}`}
                    title={r.text ?? '(비움)'}
                    desc={`${dateLabel(r.created_at)}, ${j === history.length - 1 ? '승인' : '수정'}`}
                  />
                ))
              )}
            </Card>
            <Card title="회차별 오늘 상담 목표">
              {withGoal.length === 0 ? (
                <Empty>이어받은 목표가 아직 없어요.</Empty>
              ) : (
                [...withGoal].reverse().map((s) => (
                  <Item
                    key={s.id}
                    title={s.today_goal_text ?? ''}
                    desc={
                      <>
                        <span className="seq-head-no">{s.seq}회차</span>
                        <span className="seq-head-meta">{dateLabel(s.held_at)}</span>
                      </>
                    }
                  />
                ))
              )}
            </Card>
          </Dialog>
          <Button
            variant="primary"
            disabled={saving !== null || overall.trim() === (detail.case.overall_goal ?? '').trim()}
            onClick={() => void save('overall')}
          >
            {saving === 'overall' ? '저장 중…' : '저장'}
          </Button>
        </FormActions>
      </Card>

      <Card
        title="다음 상담 목표"
        hint={
          pending
            ? `${pending.session_seq}회차에서 정함, 다음 회차를 기록하면 그 회차의 오늘 상담 목표가 되고 잠겨요.`
            : '마지막 회차를 기록할 때 적어요. 지금은 고칠 목표가 없어요.'
        }
      >
        {pending ? (
          <>
            <Field label="다음 상담 목표" htmlFor="goal-next" hideLabel>
              <input
                id="goal-next"
                type="text"
                aria-label="다음 상담 목표"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <FormActions>
              <Button
                variant="primary"
                disabled={saving !== null || next.trim() === (pending.text ?? '').trim()}
                onClick={() => void save('next')}
              >
                {saving === 'next' ? '저장 중…' : '저장'}
              </Button>
            </FormActions>
          </>
        ) : (
          <Empty>아직 없어요.</Empty>
        )}
      </Card>
      {error && <ErrorText>{error}</ErrorText>}
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

  /**
   * 체크 하나로 세 결정을 다룬다(2026-09-17 Q). 켜면 `grant`.
   * 끌 때는 이력을 따라 자동으로 갈린다 — 한 번이라도 동의했으면 `withdraw`,
   * 아직 확인 안 된 상태에서 끄면 `decline`. 별도 `철회` 버튼은 걷었다.
   */
  const toggle = async (row: ConsentView[number]) => {
    setBusy(true);
    try {
      const decision =
        row.status === 'granted' ? (row.decided_at ? 'withdraw' : 'decline') : 'grant';
      setRows(await recordConsent(caseId, { domain: row.domain, decision }));
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
    <Card title="개인 정보 및 민감 정보 처리 동의">
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        rows.map((row) => {
          const copy = copies[row.domain];
          // 접힌 머리 한 행: 항목 이름 · 설명 · 날짜 · 동의 여부. 이중 접힘(항목 + `자세히 보기`)은
          // 하나로 좁혔다 — 펼치면 동의문 전문이 바로 선다(2026-09-17 Q).
          const head = [row.copy, row.decided_at ? dateLabel(row.decided_at) : '날짜 없음', STATUS[row.status] ?? row.status]
            .join(' | ');
          return (
            <Fold
              key={row.domain}
              group="consents"
              title={row.label}
              desc={<span title={head}>{head}</span>}
            >
              {copy ? (
                <DataRows
                  rows={[
                    ['동의문', copy.body],
                    ['무엇을 받나', copy.items.join(' · ')],
                    ['왜 받나', copy.purpose_text],
                    ['얼마나 두나', copy.retention_text],
                    ...(copy.recipient ? ([['어디로 가나', copy.recipient]] as Array<[string, ReactNode]>) : []),
                    ['거부할 수 있나', copy.refusal_text],
                    ['문안 판', `${copy.version}, 지문 ${copy.hash}`],
                  ]}
                />
              ) : (
                <Empty>문안을 불러오는 중이에요.</Empty>
              )}
              {/* 체크는 **왼쪽**이고 아래 설명문은 두지 않는다(2026-09-17 Q).
                  끄면 철회로 기록된다는 것은 상태 값(`동의함`/`동의 없음`)이 이미 말한다. */}
              <div className="consent-toggle">
                <Choice
                  type="checkbox"
                  label="이 항목에 동의함"
                  checked={row.status === 'granted'}
                  disabled={busy}
                  onChange={() => void toggle(row)}
                />
              </div>
            </Fold>
          );
        })
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
      /**
       * 이 카드가 하는 일(2026-09-17 Q): 당사자 등록에서 초대로 동의를 받는 것이 기본이고,
       * 실무자가 직접 작성해 버린 경우에 **동의를 받으려고 보내는 링크**를 만드는 자리다.
       * 그래서 이름과 안내를 동의 쪽 말로 바꿨다. 열람 동선 설명은 걷었다.
       */
      title="개인정보 및 민감정보 처리 동의 링크"
      hint="개인 정보 및 민감 정보 처리 동의 받기 링크를 생성하세요"
      // 만들기 버튼은 제목과 같은 행 오른쪽 끝이다(2026-09-17 Q). `링크 끊기` 는 링크가
      // 살아 있을 때만 본문 아래에 남는다 — 위험 행동을 제목 줄에 함께 세우지 않는다.
      action={
        state && (
          <Button variant="primary" disabled={busy} onClick={() => void issue()}>
            {state.active ? '새로 만들기' : '링크 만들기'}
          </Button>
        )
      }
    >
      {state === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        <>
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
          {state.active && (
            <FormActions>
              {/* `잠그기` 는 무엇이 잠기는지 읽히지 않았다(2026-09-17 Q). 서버는 링크를
                  폐기 표시(`revoked_at`)만 하고 기록은 남기므로 `삭제` 도 사실이 아니다 —
                  링크가 더는 안 열린다는 뜻의 `링크 끊기` 로 적는다. */}
              <Button disabled={busy} onClick={() => void revoke()}>
                링크 끊기
              </Button>
            </FormActions>
          )}
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
    <Card title="파일 업로드">
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : rows.length === 0 ? null : (
        rows.map((d) => (
          <div className="wire-repeat-card" key={d.id}>
            <Item
              title={d.label}
              desc={`${size(d.bytes)}, ${dateLabel(d.created_at)} 받음, ${dateLabel(d.delete_after)}에 지워요${
                d.deleted_at ? ', 지워짐' : ''
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

      {/* 한 행이다(2026-09-17 Q): [파일 선택 | 문서 이름] 입력칸 + 업로드.
          **파일 선택 버튼은 입력칸 안에 든다**(전역 통일, 2026-09-17 Q) — 버튼이 칸 밖에
          따로 서면 어디까지가 한 입력인지 읽히지 않는다. 안내는 카드 hint 한 줄뿐이다. */}
      <div className="doc-upload-row">
        <div className="wire-input-box doc-upload-box">
          <label className="wire-button doc-upload-pick" data-variant="secondary">
            <span className="wire-button-text">파일 선택</span>
            <input
              id="doc-file"
              type="file"
              className="doc-upload-input"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.docx,.hwp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <input
            id="doc-label"
            aria-label="문서 이름"
            placeholder={file ? '문서 이름 (예: 채무 내역서)' : '파일을 고른 뒤 이름을 적어요'}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button variant="primary" disabled={busy || !file || !label.trim()} onClick={() => void add()}>
          {busy ? '올리는 중…' : '업로드'}
        </Button>
      </div>
      {/* 안내는 파일 선택 줄 **아래**다(2026-09-17 Q). 가로선을 하나 두고 카드 아래 여백과
          같은 24를 위아래로 준다 — 제목 줄의 구분선과 같은 리듬이다. */}
      <div className="doc-upload-note">
        <p className="panel-meta">{file ? `${file.name}, ${size(file.size)}` : '보존기간 30일, 20MB 제한'}</p>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

/**
 * 회차별 원본 보기 탭 — 회차를 골라 **수기·음성 전문**으로 간다(2026-09-17 Q).
 * 전문 자체는 `상담 내용 원본 보기` 화면이 그린다. 두 벌로 만들지 않는다.
 */
function Fulls({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const done = detail.sessions.filter((s) => s.status === 'done');
  if (done.length === 0) {
    return (
      <Card title="회차별 원본 보기">
        <Empty>아직 기록한 상담이 없어요.</Empty>
      </Card>
    );
  }
  return (
    <Card title="회차별 원본 보기">
      {/* 최신순이다(2026-09-17 Q). 머리 타이포는 회차별 요약과 같다: 회차 크게, 날짜·종류는
          작고 볼드 아님, 세로선 없이 여백으로 가른다. AI 가 만든 전사문이 있으면 `AI` 배지. */}
      {[...done].reverse().map((s) => (
        <div className="wire-repeat-card" key={s.id}>
          <Item
            title={
              <>
                <span className="seq-head-no">{s.seq}회차</span>
                <span className="seq-head-meta">{dateLabel(s.held_at)}</span>
                {s.kind === 'intake' && <span className="seq-head-meta">인테이크</span>}
                {s.voice.transcript !== 'none' && s.voice.transcript !== 'skipped' && (
                  <Badge tone="blue">AI</Badge>
                )}
              </>
            }
            desc={
              [
                s.written ? '수기 있음' : '수기 미작성',
                s.voice.recordings > 0 ? `녹음 ${s.voice.recordings}` : null,
                s.voice.recordings > 0 ? TRANSCRIPT_LABEL[s.voice.transcript] : null,
              ]
                .filter(Boolean)
                .join(' | ')
            }
            action={
              <Button
                onClick={() => (window.location.hash = `#/cases/${caseId}/sessions/${s.id}/full`)}
              >
                원본 보기
              </Button>
            }
          />
        </div>
      ))}
    </Card>
  );
}

/**
 * 회차 정보(2026-09-17 Q). 구 `기본 정보` 카드는 걷었다 — 이름·연락처·이메일·가명·사업이
 * 당사자 카드(HERO)와 글자 하나까지 같은 값이었다.
 *
 * 카드는 **접힘 카드**이고 본문은 회차×상태 표다(C안 확정, 2026-09-17 Q). 표는 **최신순**으로
 * 쌓고 접힌 머리는 현황 한 줄로 말한다 — 카드가 맡는 것은 현황이고 회차별 내용은
 * `회차별 요약` 탭 것이다. 원본 값은 `sessions[].written` 과 `sessions[].voice` 다.
 */
const SEQ_TRANSCRIPT: Record<string, string> = {
  none: '전사 없음',
  pending: '전사 중',
  draft: '초안',
  approved: '승인',
  failed: '실패',
  skipped: '건너뜀',
};

function SessionStatus({ detail }: { detail: CaseDetail }) {
  const done = detail.sessions.filter((s) => s.status === 'done');
  const intake = detail.sessions.find((s) => s.kind === 'intake');
  const now = Date.now();
  const next = detail.sessions
    .filter((s) => s.status === 'planned' && s.scheduled_at && Date.parse(s.scheduled_at) >= now)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))[0];
  const planned = detail.case.sessions_planned;
  // 최신순으로 쌓는다 — 지금 상태가 맨 위다.
  const rows = [...detail.sessions].sort((a, b) => b.seq - a.seq);
  const head = [
    intake ? (intake.status === 'done' ? '인테이크 작성함' : '인테이크 예정만') : '인테이크 없음',
    planned ? `${done.length} / ${planned}회차` : `${done.length}회차`,
    `수기 ${done.filter((s) => s.written).length}`,
    `전사 승인 ${done.filter((s) => s.voice.transcript === 'approved').length}`,
    next?.scheduled_at ? `다음 ${next.seq}회차 ${dateLabel(next.scheduled_at)}` : '다음 일정 없음',
  ].join(' | ');

  return (
    <Fold title="회차 정보" desc={<span title={head}>{head}</span>}>
      {/* 좁은 화면에서는 표가 카드 안에서만 가로로 넘어간다 — 페이지 폭을 밀지 않는다
          (390 실측: 표 최소폭 385px 가 문서를 401px 로 늘렸다). */}
      <div className="seq-scroll" role="region" aria-label="회차별 상태" tabIndex={0}>
        <table className="seq-table">
        <thead>
          <tr>
            <th scope="col">회차</th>
            <th scope="col">일시</th>
            <th scope="col">상태</th>
            <th scope="col">수기</th>
            <th scope="col">녹음</th>
            <th scope="col">전사</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.kind === 'intake' ? '인테이크' : `${row.seq}회차`}</th>
              <td>{(row.held_at ?? row.scheduled_at) ? dateLabel((row.held_at ?? row.scheduled_at) as string) : '일시 없음'}</td>
              <td>{row.status === 'done' ? '기록됨' : '예정'}</td>
              <td>{row.written ? '있음' : '없음'}</td>
              <td>{row.voice.recordings || '—'}</td>
              <td>{row.voice.recordings ? (SEQ_TRANSCRIPT[row.voice.transcript] ?? row.voice.transcript) : '—'}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </Fold>
  );
}

/**
 * 상담 종결 경고(2026-09-17 Q). 종결은 되돌리기 어려워서 무엇이 남았는지 먼저 세어 보여 준다.
 * - 미완료 과제가 남았는가(`open_cards` 의 `promise`)
 * - 기록 회차가 예정 회차보다 적은가(`sessions_planned`)
 * - 앞으로의 예정 회차가 남았는가(그 일정이 어떻게 되는지도 적는다)
 * 확인하면 **기록 화면(종결 체크 ON)** 으로 간다 — 종결 상담도 상담이라 기록이 먼저다.
 */
const closeWarnings = (detail: CaseDetail): string[] => {
  const promises = detail.open_cards.filter((c) => c.kind === 'promise').length;
  const done = detail.sessions.filter((s) => s.status === 'done').length;
  const planned = detail.case.sessions_planned;
  const future = detail.sessions.filter(
    (s) => s.status === 'planned' && s.scheduled_at && Date.parse(s.scheduled_at) >= Date.now(),
  );
  const lines: string[] = [];
  if (promises > 0) lines.push(`확인하지 못한 과제가 ${promises}건 남아 있어요.`);
  if (planned && done < planned) lines.push(`예정 ${planned}회차 가운데 ${done}회차만 기록했어요.`);
  if (future.length > 0)
    lines.push(
      `앞으로 잡힌 상담이 ${future.length}건 있어요(${future
        .map((s) => `${s.seq}회차 ${dateLabel(s.scheduled_at as string)}`)
        .join(', ')}). 종결하면 그 일정은 그대로 남으니 따로 지워야 해요.`,
    );
  return lines;
};

/** 정보 — 회차 현황과 동의·문서·열람·종결. */
function Info({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <SessionStatus detail={detail} />
      <Consents caseId={caseId} />

      <Documents caseId={caseId} />

      <Access caseId={caseId} />

      {/* 한 행이다(2026-09-17 Q): 제목, 짧은 메시지, 버튼. 자세한 경고는 확인 창이 말한다. */}
      <Card>
        <Item
          title="상담 종결"
          desc={
            detail.closure
              ? `${dateLabel(detail.closure.closed_at)} 종결, ${detail.closure.close_reason}`
              : `미완료 ${detail.open_cards.filter((c) => c.kind === 'promise').length}건, 상담 종결시 기록 작성 필요`
          }
          action={
            detail.closure ? undefined : <Button onClick={() => setAsking(true)}>상담 종결</Button>
          }
        />
        <Confirm
          open={asking}
          title="이 사례를 종결할까요?"
          lines={closeWarnings(detail)}
          confirmLabel="종결 기록 쓰기"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            window.location.hash = `#/cases/${caseId}/record?closing=1`;
          }}
        />
      </Card>
    </>
  );
}

export function ParticipantInfoScreen({ caseId, initialTab = '당사자 정보' }: { caseId: number; initialTab?: Tab }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    void getCaseDetail(caseId).then(setDetail);
  }, [caseId]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, caseId]);

  if (!detail) return <p className="empty">불러오는 중이에요.</p>;

  const done = detail.sessions.filter((s) => s.status === 'done');
  // 당사자 카드 정보 넷(2026-09-17 Q): ID · 사업과 회차 · 연락처 · 이메일. 없는 값은 빠진다.
  // 실무자가 동명이인을 구분하는 단서가 연락처·이메일이라 머리에 올린다.
  const heroDetails: Array<[string, string]> = [
    ['당사자 ID', detail.pseudonym],
    [
      '참여 사업',
      `${detail.case.program_name}${done.length > 0 ? `, ${Math.max(...done.map((s) => s.seq))}회차까지 기록` : ', 기록 없음'}`,
    ],
    ['연락처', detail.participant.phone ?? ''],
    ['이메일', detail.participant.email ?? ''],
  ];


  return (
    <>
      {/* 여기가 이 사람의 카드다(CCC D38). 화면 용도는 아래 탭이 말하고, 머리는 사람을 말한다. */}
      <ParticipantHero
        name={detail.participant.name}
        pseudonym={detail.pseudonym}
        details={heroDetails}
        actions={
          <>
            {/* 행동 둘(2026-09-17 Q): 기록과 이 사람의 일정. 종결은 아래 `상담 종결` 카드 것이다. */}
            <Button variant="primary" onClick={() => (window.location.hash = `#/cases/${caseId}/record`)}>
              상담 기록하기
            </Button>
            <Button onClick={() => (window.location.hash = `#/schedule?case=${caseId}`)}>상담 일정 보기</Button>
          </>
        }
      />
      <div className="wire-container">
        {/* 탭은 카드 아래에서 이 사람의 화면을 가른다(2026-09-17 Q 최종 4탭). */}
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

        {tab === '당사자 정보' && <Info detail={detail} caseId={caseId} />}
        {tab === '회차별 요약' && <Sessions detail={detail} caseId={caseId} />}
        {tab === '회차별 원본 보기' && <Fulls detail={detail} caseId={caseId} />}
        {tab === '목표' && (
          <Goals
            key={`${detail.case.overall_goal ?? ''}|${detail.pending_next_goal?.text ?? ''}`}
            detail={detail}
            reload={() => getCaseDetail(caseId).then(setDetail)}
          />
        )}
      </div>
    </>
  );
}
