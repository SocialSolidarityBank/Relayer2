// 당사자 정보 — **당사자 카드(HERO)가 머리**이고 그 아래 탭 3개가 화면을 가른다
// (2026-09-18 Q): 기본 정보 · 회차별 요약 · 회차별 원본. 상담 목표 기록은 기본 정보 안 아코디언이다.
// 원본은 큰 팝업 두 열(수기 · 녹음 전사)로 열린다(2026-09-18 Q E2 — 드로어 폐지).
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
  uploadDocument,
  type AccessState,
  type Briefing,
  type CaseDetail,
  type ConsentCopy,
  type ConsentView,
  type DocumentRow,
} from '../api.ts';
import {
  Button,
  Card,
  Choice,
  Confirm,
  ConsentDetail,
  Empty,
  ErrorText,
  FactChanges,
  Fold,
  FormActions,
  Item,
  Meta,
  PageHeader,
  ParticipantHero,
  Chevron,
} from '../ui.tsx';
import { ConsentLinkCard } from '../consent-link.tsx';
import { SessionOriginalDialog } from '../session-original.tsx';
import { dateLabel, timeLabel } from '../date-time.ts';

const TABS = ['기본 정보', '회차별 요약', '회차별 원본'] as const;
type Tab = (typeof TABS)[number];

// 날짜 표기는 `date-time.ts` 의 `dateLabel` 하나다(2026-09-18 Q — `2026.09.18.(금)`).

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

// 요약 수정도 리비전이다(`kind: 'summary'`, L5 §4) — 승인본을 고쳐도 로그로 남는다(F4).
// 저장 뒤 사례 상세를 다시 받는다: 서버가 새 승인본을 쌓아 `ai_summary` 가 그것을 가리킨다.

/** 줄글 여러 개는 불렛이다(F2). 한 줄이면 단락 하나. */
const Lines = ({ text }: { text: string }) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? (
    <ul className="seq-list">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  ) : (
    <p className="seq-text">{text}</p>
  );
};

/** 요약 안 구역의 계열색. §6 라벨 색 그대로다 — 채운 배지 면은 2026-09-18 에 걷었다. */
type SeqTone = 'ai' | 'change' | 'warn' | 'state' | 'risk' | 'done';

/**
 * 요약 안 구역 하나 — **아코디언 카드**다(2026-09-18 Q "모두 아코디언 카드로, 1열 여러 행").
 * 구 테두리 없는 작은 아코디언을 `Fold` 로 바꿨다. 제목은 14px 컬러 텍스트(`data-tone`)이고
 * 펼치면 카드 머리 반전 규칙(app.css L1)이 그대로 뒤집는다. `open` 은 기본 펼침 여부다:
 * 핵심만 펼쳐 두고 나머지는 `desc` 한 줄(건수)로 말한다 — 다섯 카드가 다 펼쳐지면 한 회차가 화면 둘을 먹는다.
 */
function SeqSection({
  title,
  tone,
  desc,
  open = false,
  children,
}: {
  title: string;
  tone: SeqTone;
  desc?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <Fold
      className="seq-section"
      title={<span className="seq-section-title" data-tone={tone}>{title}</span>}
      desc={desc}
      open={open}
    >
      {children}
    </Fold>
  );
}

/**
 * 회차별 요약 — **한 회차가 한 접힘 카드**다(2026-09-17 Q). 상단 `위험 신호` 배너는 걷었다:
 * 본문 중심으로 가고, 위험 신호는 그 신호가 나온 회차 카드가 스스로 말한다(`is-crisis`).
 *
 * 접힌 머리는 `N회차`(16/600) + 날짜(13/400) + 표시(`위험 신호`·`원본 수정됨`)이고 둘째 줄이
 * **이번 상담 목표**다(2026-09-18 Q — 구 `AI` 표시와 행동 넷 `AI 정리 보기`·`수기 원본 보기`·
 * `녹음 전사 기록 보기`·`수정`, 요약문 편집은 걷었다. 원본은 회차별 원본 탭, AI 정리는 검토 화면 것이다).
 * 펼친 본문은 **아코디언 카드 1열 여러 행**이다: 핵심 · 변화 · 완료·해결 · 확인필요 · 기록 상태.
 */
function Sessions({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [brief, setBrief] = useState<Briefing | null>(null);
  useEffect(() => {
    void getBriefing(caseId).then(setBrief);
  }, [caseId]);
  const risk = brief?.risk_signals ?? null;

  const done = detail.sessions.filter((s) => s.status === 'done');
  const count = (n: number, unit: string) => (n === 0 ? '없음' : `${n}${unit}`);

  // 아직 아무 기록이 없으면 **여기서 바로 시작할 수 있어야 한다.**
  // 빈 화면만 보여 주고 어디로 가라는 말이 없으면 위 메뉴를 뒤지게 된다.
  if (done.length === 0) {
    const hasIntake = detail.sessions.some((s) => s.kind === 'intake');
    return (
      <Card title="회차별 요약">
        <Empty>기록한 상담 없음</Empty>
        <FormActions>
          {!hasIntake && (
            <Button
              variant="primary"
              onClick={() => (window.location.hash = `#/cases/${caseId}/intake`)}
            >
              인테이크 작성하기
            </Button>
          )}
          {/* 기록은 늘 일정 예약 화면을 거친다(2026-09-18 Q D1) — 예정 회차가 없으면 지금 일시가 기본이다. */}
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/schedule?then=record`)}>
            상담 기록하기
          </Button>
        </FormActions>
      </Card>
    );
  }

  return (
    <>
      <Card title="회차별 요약">
        {/* 최신순이다(2026-09-17 Q) — 상담 참여 내역 표와 같은 순서다. */}
        {[...done].reverse().map((s) => {
          const risks = (risk?.items ?? []).filter((r) => r.source_session_seq === s.seq);
          const transcriptLabel =
            s.voice.recordings > 0 ? TRANSCRIPT_LABEL[s.voice.transcript] : undefined;
          // 확인필요·완료는 브리핑의 과제·질문을 **그 회차가 낳은 것**으로 갈라 담는다
          // (`source_session_seq`). 서버를 새로 부르지 않는다 — 이미 받은 자료다.
          const mine = <T extends { source_session_seq: number }>(rows: T[]) =>
            rows.filter((r) => r.source_session_seq === s.seq);
          const pending = [
            ...mine(brief?.open_tasks?.items ?? []).map((item) => ({ kind: 'task', item })),
            ...mine(brief?.today_questions ?? []).map((item) => ({ kind: 'question', item })),
          ];
          const settled = [
            ...mine(brief?.closed_tasks ?? []).map((item) => ({ kind: 'task', item })),
            ...mine(brief?.closed_questions ?? []).map((item) => ({ kind: 'question', item })),
          ];
          const state = [
            s.line,
            s.written === false && '수기 미작성',
            s.voice.recordings > 0 && `녹음 ${s.voice.recordings}건`,
            transcriptLabel,
          ];
          const summary = s.ai_summary?.summary ?? null;
          const isStale = s.stale.ai_summary || s.stale.mismatch;
          const changes = (s.ai_summary?.changes.length ?? 0) + (s.ai_summary?.fact_changes.length ?? 0);
          return (
            <Fold
              key={s.id}
              className="seq-card"
              group="sessions"
              crisis={risks.length > 0}
              title={
                <>
                  <span className="seq-head-no">{s.seq}회차</span>
                  <span className="seq-head-meta">{dateLabel(s.held_at)}</span>
                  {s.kind === 'intake' && <span className="seq-head-meta">인테이크</span>}
                  {/* 배지 면을 걷고 14px 컬러 텍스트로 붙인다(2026-09-18 Q) — 채운 면이 줄을 밀었다. */}
                  {risks.length > 0 && <span className="seq-flag" data-tone="risk">위험 신호 {risks.length}</span>}
                  {isStale && <span className="seq-flag" data-tone="warn">원본 수정됨, 재정리 필요</span>}
                </>
              }
              // 접힌 머리의 둘째 줄은 **이번 상담 목표**다(2026-09-18 Q) — 기록 당시의 오늘 상담 목표.
              desc={s.today_goal_text ? `이번 상담 목표, ${s.today_goal_text}` : '이번 상담 목표 없음'}
            >
              {/* 팀 목업 넷(2026-09-18 검토)이 공통으로 쓰는 구역들이다: 핵심 · 변화 · 완료·해결 ·
                  확인필요 · 기록 상태. 전부 **아코디언 카드**이고 1열 여러 행이다(2026-09-18 Q). */}
              <div className="seq-sections">
                {risks.length > 0 && (
                  <SeqSection title="위험 신호" tone="risk" open>
                    <ul className="seq-list">
                      {risks.map((r) => (
                        <li key={r.card_id}>
                          {r.text}
                          {r.last_result === 'unchecked' && <span className="seq-section-note">지난 회차 미확인</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="seq-section-note">
                      {risk ? (AI_OFF_LABEL[risk.status.reason ?? 'ai_disabled'] ?? risk.status.state) : '확인 중'}
                    </p>
                  </SeqSection>
                )}
                <SeqSection title="이번 상담의 핵심" tone="ai" open>
                  {summary !== null ? (
                    <>
                      {isStale && <p className="seq-section-note">원본 수정됨, 재정리 필요</p>}
                      <Lines text={summary} />
                    </>
                  ) : (
                    <p className="seq-section-note">AI 정리 없음</p>
                  )}
                </SeqSection>
                <SeqSection title="확인된 변화" tone="change" desc={s.ai_summary ? count(changes, '건') : 'AI 정리 없음'}>
                  {isStale && <p className="seq-section-note">원본 수정됨, 재정리 필요</p>}
                  {s.ai_summary && s.ai_summary.changes.length > 0 && (
                    <ul className="seq-list">
                      {s.ai_summary.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {s.ai_summary && s.ai_summary.fact_changes.length > 0 ? (
                    <FactChanges items={s.ai_summary.fact_changes} />
                  ) : (
                    s.ai_summary != null &&
                    s.ai_summary.changes.length === 0 && <p className="seq-section-note">달라진 사실 없음</p>
                  )}
                  {!s.ai_summary && <p className="seq-section-note">AI 정리 없음</p>}
                </SeqSection>
                <SeqSection title="확인필요" tone="warn" desc={count(pending.length, '건')}>
                  {pending.length === 0 ? (
                    <p className="seq-section-note">확인할 것 없음</p>
                  ) : (
                    <ul className="seq-list">
                      {pending.map((i) => (
                        <li key={`${i.kind}-${i.item.card_id}`}>
                          {i.item.text}
                          {i.item.last_result === 'unchecked' && (
                            <span className="seq-section-note">지난 회차 미확인</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </SeqSection>
                <SeqSection title="완료·해결" tone="done" desc={count(settled.length, '건')}>
                  {settled.length === 0 ? (
                    <p className="seq-section-note">완료된 것 없음</p>
                  ) : (
                    <ul className="seq-list">
                      {settled.map((i) => (
                        <li key={`${i.kind}-${i.item.card_id}`}>{i.item.text}</li>
                      ))}
                    </ul>
                  )}
                </SeqSection>
                {state.some(Boolean) && (
                  <SeqSection title="기록 상태" tone="state" desc={<Meta parts={state} />}>
                    <p className="seq-text"><Meta parts={state} /></p>
                  </SeqSection>
                )}
              </div>
            </Fold>
          );
        })}
      </Card>
      {detail.closure && (
        <Card title="상담 종결">
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
 * 상담 목표 기록 — **읽기만 하는 아코디언**이다(2026-09-18 Q — 구 넷째 탭을 걷고 기본 정보 탭의
 * `상담 참여 내역` 아래로 내렸다. 로그뿐이라 탭 하나를 차지할 일이 아니다). 전체 상담 목표는
 * HERO 2행이 보여 주고 고치는 자리는 인테이크뿐이다. 두 묶음이다:
 *   - 지난 상담 목표: 회차마다 기록 당시의 오늘 상담 목표(`today_goal_text`), 최신순
 *   - 변경 기록: 전체 상담 목표 리비전(`goal_revisions`), 최신순 — 원래 순서의 첫 줄만 `승인`
 */
function GoalHistory({ detail }: { detail: CaseDetail }) {
  const withGoal = detail.sessions.filter((s) => s.today_goal_text);
  const history = detail.goal_revisions;
  return (
    <Fold
      title="상담 목표 기록"
      desc={<Meta parts={[`지난 상담 목표 ${withGoal.length}회`, `변경 기록 ${history.length}건`]} />}
    >
      <div className="goal-history">
        <section>
          <h3 className="wire-subhead">지난 상담 목표</h3>
          {withGoal.length === 0 ? (
            <Empty>기록된 상담 목표 없음</Empty>
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
        </section>
        <section>
          <h3 className="wire-subhead">변경 기록</h3>
          {history.length === 0 ? (
            <Empty>변경 기록 없음</Empty>
          ) : (
            [...history].reverse().map((r, j) => (
              <Item
                key={`${r.created_at}-${j}`}
                title={r.text ?? '(비움)'}
                desc={`${dateLabel(r.created_at)}, ${j === history.length - 1 ? '승인' : '수정'}`}
              />
            ))
          )}
        </section>
      </div>
    </Fold>
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
        <Empty>불러오는 중</Empty>
      ) : (
        rows.map((row) => {
          const copy = copies[row.domain];
          // 접힌 머리 한 행: 항목 이름 · 동의 항목(명사구 한 줄, E5) · 날짜 · 동의 여부.
          // 펼치면 표준 양식 표(`ConsentDetail` — 등록·설정과 같은 부품)가 바로 선다.
          return (
            <Fold
              key={row.domain}
              group="consents"
              title={row.label}
              desc={
                <Meta
                  parts={[
                    copy?.items.join(', '),
                    row.decided_at ? dateLabel(row.decided_at) : '날짜 없음',
                    STATUS[row.status] ?? row.status,
                  ]}
                />
              }
            >
              {copy ? <ConsentDetail copy={copy} /> : <Empty>문안 불러오는 중</Empty>}
              {/* 체크는 **왼쪽**이고 아래 설명문은 두지 않는다(2026-09-17 Q).
                  끄면 철회로 기록된다는 것은 상태 값(`동의함`/`동의 없음`)이 이미 말한다. */}
              <div className="consent-toggle">
                <Choice
                  type="checkbox"
                  label="동의"
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
 * 카드는 당사자 등록과 같은 부품이다(`consent-link.tsx`) — 여기는 발급과 끊기만 맡는다.
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
    <ConsentLinkCard
      status={state === null ? 'loading' : state.active ? 'active' : 'none'}
      link={link}
      code={issued?.code ?? null}
      busy={busy}
      makeLabel="링크 만들기"
      onMake={() => void issue()}
    >
      {state?.active && (
        <FormActions>
          {/* `잠그기` 는 무엇이 잠기는지 읽히지 않았다(2026-09-17 Q). 서버는 링크를
              폐기 표시(`revoked_at`)만 하고 기록은 남기므로 `삭제` 도 사실이 아니다 —
              링크가 더는 안 열린다는 뜻의 `링크 끊기` 로 적는다. */}
          <Button disabled={busy} onClick={() => void revoke()}>
            링크 끊기
          </Button>
        </FormActions>
      )}
    </ConsentLinkCard>
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
      setError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setBusy(false);
    }
  };

  const size = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

  return (
    <Card title="파일 업로드">
      {rows === null ? (
        <Empty>불러오는 중</Empty>
      ) : rows.length === 0 ? null : (
        rows.map((d) => (
          <div className="wire-repeat-card" key={d.id}>
            <Item
              title={d.label}
              desc={`${size(d.bytes)}, ${dateLabel(d.created_at)} 받음, ${dateLabel(d.delete_after)} 삭제 예정${
                d.deleted_at ? ', 삭제됨' : ''
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
            placeholder={file ? '문서 이름 (예: 채무 내역서)' : '파일 선택 후 이름 입력'}
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
 * 상담 참여 내역(2026-09-18 Q — 구 `회차 정보`). 구 `기본 정보` 카드는 걷었다 — 이름·연락처·이메일·가명·사업이
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

// 일시는 날짜와 시각 두 칸이다(E4). 두 표기 모두 `date-time.ts` 것이다.


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
  // 부제는 얇은 안내문 크기이고 숫자만 굵다(E3). **단위는 GLOSSARY 규칙**(2026-09-18 Q 결정 D14):
  // 회차·기록은 `회`, 문서·녹음·전사는 `건`. 수를 단위 없이 두면 무엇을 센 것인지 읽히지 않는다.
  const head = [
    intake ? (intake.status === 'done' ? '인테이크 작성함' : '인테이크 예정만') : '인테이크 없음',
    planned ? (
      <>
        <strong>{done.length}</strong> / <strong>{planned}</strong>회차
      </>
    ) : (
      <>
        <strong>{done.length}</strong>회차
      </>
    ),
    <>
      수기 기록 <strong>{done.filter((s) => s.written).length}</strong>회
    </>,
    <>
      전사 승인 <strong>{done.filter((s) => s.voice.transcript === 'approved').length}</strong>건
    </>,
    next?.scheduled_at ? (
      <>
        다음 <strong>{next.seq}</strong>회차 {dateLabel(next.scheduled_at)}
      </>
    ) : (
      '다음 일정 없음'
    ),
  ];

  return (
    <Fold title="상담 참여 내역" desc={<Meta parts={head} />}>
      {/* 좁은 화면에서는 표가 카드 안에서만 가로로 넘어간다 — 페이지 폭을 밀지 않는다
          (390 실측: 표 최소폭 385px 가 문서를 401px 로 늘렸다). */}
      <div className="seq-scroll" role="region" aria-label="회차별 상태" tabIndex={0}>
        <table className="seq-table">
        <thead>
          <tr>
            <th scope="col">회차</th>
            <th scope="col">일시</th>
            <th scope="col">시간</th>
            <th scope="col">소요</th>
            <th scope="col">상태</th>
            <th scope="col">수기</th>
            <th scope="col">녹음</th>
            <th scope="col">전사</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const at = row.held_at ?? row.scheduled_at;
            return (
              <tr key={row.id}>
                <th scope="row">{row.kind === 'intake' ? '인테이크' : `${row.seq}회차`}</th>
                <td>{at ? dateLabel(at) : '일시 없음'}</td>
                <td>{at ? timeLabel(at) : '—'}</td>
                <td>{row.duration_min ? `${row.duration_min}분` : '—'}</td>
                <td>{row.status === 'done' ? '기록됨' : '예정'}</td>
                <td>{row.written ? '있음' : '없음'}</td>
                <td>{row.voice.recordings || '—'}</td>
                <td>{row.voice.recordings ? (SEQ_TRANSCRIPT[row.voice.transcript] ?? row.voice.transcript) : '—'}</td>
              </tr>
            );
          })}
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
  if (promises > 0) lines.push(`미확인 과제 ${promises}건`);
  if (planned && done < planned) lines.push(`예정 ${planned}회차 중 ${done}회차 기록`);
  if (future.length > 0)
    lines.push(`예정 상담 ${future.length}건 유지, 종결 후 직접 삭제 필요`);
  return lines;
};

/**
 * 회차별 원본 탭 — 회차 한 줄이 한 행이고 **행 전체가 누를 자리**다(2026-09-18 Q — 구 `원본 보기`
 * 버튼 대신 오른쪽 끝 꺽쇠). 누르면 큰 팝업(수기 · 녹음 전사)이 열리고 수기는 거기서 고친다.
 */
function Fulls({
  detail,
  caseId,
  reload,
}: {
  detail: CaseDetail;
  caseId: number;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState<{ sessionId: number; seq: number } | null>(null);
  const done = detail.sessions.filter((x) => x.status === 'done');
  if (done.length === 0) {
    return (
      <Card title="회차별 원본">
        <Empty>기록한 상담 없음</Empty>
      </Card>
    );
  }
  return (
    <Card title="회차별 원본">
      {/* 최신순이다. 한 행에 회차·날짜·종류·상태를 다 싣는다. 머리 타이포는 회차별 요약과 같다. */}
      <div className="seq-rows">
        {[...done].reverse().map((x) => (
          <button
            type="button"
            className="seq-row"
            key={x.id}
            aria-label={`${x.seq}회차 원본 보기`}
            onClick={() => setOpen({ sessionId: x.id, seq: x.seq })}
          >
            <span className="seq-head-no">{x.seq}회차</span>
            <span className="seq-head-meta">{dateLabel(x.held_at)}</span>
            {x.kind === 'intake' && <span className="seq-head-meta">인테이크</span>}
            <span className="seq-row-state">
              <Meta
                parts={[
                  x.written ? '수기 있음' : '수기 미작성',
                  x.voice.recordings > 0 && `녹음 ${x.voice.recordings}건`,
                  x.voice.recordings > 0 ? TRANSCRIPT_LABEL[x.voice.transcript] : undefined,
                ]}
              />
            </span>
            <span className="wire-chevron-button seq-row-chevron" aria-hidden="true">
              <Chevron dir="right" />
            </span>
          </button>
        ))}
      </div>
      {open && (
        <SessionOriginalDialog
          caseId={caseId}
          sessionId={open.sessionId}
          seq={open.seq}
          onClose={() => setOpen(null)}
          onSaved={() => void reload()}
        />
      )}
    </Card>
  );
}

/** 기본 정보 — 상담 참여 내역·목표 기록과 동의·문서·열람·종결. */
function Info({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      {/* 상담 참여 내역이 한 줄을 다 쓰고 바로 아래가 상담 목표 기록 아코디언이다(2026-09-18 Q —
          구 넷째 탭). 아래 순서: 동의 → 열람 링크 → 파일(E9). */}
      <SessionStatus detail={detail} />
      <GoalHistory detail={detail} />
      <Consents caseId={caseId} />

      <Access caseId={caseId} />

      <Documents caseId={caseId} />

      {/* 제목은 카드 제목 `h2` 16px 이다(2026-09-18 Q — 구 항목 제목 14px). 버튼은 제목 줄 오른쪽 끝. */}
      <Card
        title="상담 종결"
        action={detail.closure ? undefined : <Button onClick={() => setAsking(true)}>상담 종결</Button>}
      >
        <p className="seq-text">
          {detail.closure
            ? `${dateLabel(detail.closure.closed_at)} 종결, ${detail.closure.close_reason}`
            : `미완료 ${detail.open_cards.filter((c) => c.kind === 'promise').length}건, 상담 종결시 기록 작성 필요`}
        </p>
        <Confirm
          open={asking}
          title="사례 종결 확인"
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

export function ParticipantInfoScreen({ caseId, initialTab = '기본 정보' }: { caseId: number; initialTab?: Tab }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  // 원본·요약 리비전 뒤에는 사례 상세를 다시 받는다 — `stale`(D3)·새 요약은 서버 값이다.
  const reload = () => getCaseDetail(caseId).then(setDetail);

  useEffect(() => {
    void getCaseDetail(caseId).then(setDetail);
  }, [caseId]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, caseId]);

  if (!detail) return <p className="empty">불러오는 중</p>;

  const done = detail.sessions.filter((s) => s.status === 'done');
  // 당사자 정보 다섯 칸(2026-09-18 Q): ID · 참여중인 사업(회차) · 연락처 · 이메일이 1행,
  // **전체 상담 목표**가 2행 전폭이다. 없는 값은 빠진다. 동명이인 단서(연락처·이메일)를 머리에 올린다.
  const heroDetails: Array<[string, string]> = [
    ['ID', detail.pseudonym],
    [
      '참여중인 사업',
      `${detail.case.program_name}${done.length > 0 ? `, ${Math.max(...done.map((s) => s.seq))}회차까지 기록` : ', 기록 없음'}`,
    ],
    ['연락처', detail.participant.phone ?? ''],
    ['이메일', detail.participant.email ?? ''],
    ['전체 상담 목표', detail.case.overall_goal ?? ''],
  ];


  return (
    <>
      {/* 페이지 제목은 HERO 바로 위 `h1` 이다(2026-09-18 Q). 머리 카드는 사람을 말하고
          화면 이름은 이 줄이 말한다. */}
      <PageHeader title="당사자 정보" />
      {/* 여기가 이 사람의 카드다(CCC D38). 화면 용도는 아래 탭이 말한다. */}
      <ParticipantHero
        name={detail.participant.name}
        pseudonym={detail.pseudonym}
        details={heroDetails}
        actions={
          <>
            {/* 행동은 둘이다(2026-09-18 Q — `상담 일정 보기` 는 걷었다. 일정 묶음 메뉴가 그 자리다).
                왼쪽이 일정 등록, 오른쪽 끝이 기록하기(주 행동)다. 종결은 아래 `상담 종결` 카드 것이다. */}
            <Button onClick={() => (window.location.hash = `#/cases/${caseId}/schedule`)}>상담 일정 등록</Button>
            <Button variant="primary" onClick={() => (window.location.hash = `#/cases/${caseId}/schedule?then=record`)}>
              상담 기록하기
            </Button>
          </>
        }
      />
      {/* 탭·본문의 열 수는 창 폭이 아니라 **이 열의 폭**이 정한다(2026-09-18 Q 7). */}
      <div className="wire-container info-screen">
        {/* 탭은 카드 아래에서 이 사람의 화면을 가른다(2026-09-18 Q 3탭 — 목표는 기본 정보 안 아코디언). */}
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

        {tab === '기본 정보' && <Info detail={detail} caseId={caseId} />}
        {tab === '회차별 요약' && <Sessions detail={detail} caseId={caseId} />}
        {tab === '회차별 원본' && <Fulls detail={detail} caseId={caseId} reload={reload} />}
      </div>
    </>
  );
}
