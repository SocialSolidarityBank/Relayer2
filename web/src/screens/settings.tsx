/**
 * 설정하기(2026-09-16 Q). 한 화면 안에서 묶음을 갈아 끼운다.
 *
 * `#/settings/<모듈>` 이 주소다. 사이드바가 모듈별로 링크를 세우므로, 어디에 있는지가
 * 왼쪽에서 늘 보인다 — 화면 안에 또 목록을 두면 메뉴가 두 겹이 된다.
 *
 * 이름 규율(2026-09-16 Q 3차 검토): **역할은 `실무자`, 관계는 `담당`**이다.
 * 정본 D40·ADR-0017 이 `상담사 → 실무자`, `담당자 → 담당 실무자`로 정했다 —
 * 홀로 선 `담당자`는 폐어다. 그 말이 둘을 뭉뚱그리기 때문이다.
 *
 * 기관에 있는 것(`실무자 초대하기`·`실무자 목록`)과 이 사람을 맡은 것(`담당 배정하기`)은
 * 다르다. 방금 초대한 사람은 아무도 안 맡았는데 `담당자`라 부르면 화면이 거짓말한다.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addProgram,
  assignCase,
  createInvite,
  deactivateMe,
  decideRequest,
  getConnections,
  getConsentCopy,
  getOrg,
  getProfile,
  listInvites,
  listAssignmentCases,
  listPrograms,
  listRequests,
  listWorkers,
  auditCsvHref,
  reopenProgram,
  retireProgram,
  revokeInvite,
  saveOrg,
  saveProfile,
  setAiKey,
  setWorkerRole,
  updateProgram,
  Unauthorized,
  workerCases,
  type AssignmentCase,
  type Connections,
  type ConsentCopy,
  type Invite,
  type Org,
  type OrgView,
  type Profile,
  type Program,
  type ProgramInput,
  type RequestRow,
  type RetireWarning,
  type AuditKind,
  type Worker,
  type WorkerCase,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  Choice,
  ChoiceGroup,
  Confirm,
  ConsentDetail,
  DataRows,
  Empty,
  ErrorText,
  Field,
  Fold,
  FormActions,
  Item,
  Meta,
  PageHeader,
} from '../ui.tsx';
import { setTheme, themeChoice, type ThemeChoice } from '../theme.ts';
import { DatePicker } from '../date-picker.tsx';
import { AUDIT_DAYS, AUDIT_KIND_TABS, AuditScreen } from './audit.tsx';

const date = (s: string) => new Date(s).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

/** 주소 뒤 `?program=<id>` — 사업 목록에서 걸개가 걸린 채 건너온 것이다. 없으면 null. */
const programFromHash = (): number | null => {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('program');
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};
/**
 * 설정 묶음(2026-09-16 Q 3차). **묶음마다 사이드바 메뉴 하나**이고, 그 페이지에 항목이
 * 곧바로 펼쳐진다 — `설정하기` 한 칸에 열두 항목을 넣었더니 두 번 눌러야 내용에 닿아
 * 어디 있는지 알 수 없었다(Q: "설정하기가 헷갈린다").
 *
 * `admin: true` 는 관리자만 본다. **관리자는 실무자가 하는 일도 전부 본다**(Q 지시) —
 * 관리자도 당사자를 맡는 사람이지, 남의 일을 구경만 하는 자리가 아니다.
 * 묶음 전체가 관리자 몫이면 실무자 사이드바에서는 그 메뉴 자체가 서지 않는다.
 */
export const SETTINGS_GROUPS = [
  {
    key: 'me',
    title: '내 정보',
    items: [
      { key: 'profile', label: '내 정보', desc: '이름·연락처·이메일 수정', admin: false },
      { key: 'theme', label: '화면 테마', desc: '밝게·어둡게·기기 설정 따라', admin: false },
      { key: 'leave', label: '계정 삭제하기', desc: '로그인 차단, 기록은 유지', admin: false },
    ],
  },
  {
    key: 'staff',
    title: '실무자 관리',
    items: [
      { key: 'workers', label: '실무자 목록', desc: '실무자와 담당 현황', admin: true },
      { key: 'assign', label: '담당 배정하기', desc: '배정 요청 확정, 담당 변경 넘기기', admin: true },
      { key: 'invite', label: '실무자 초대하기', desc: '초대 링크 만들기, 7일 뒤 만료', admin: true },
      // 관리자에게는 `담당 배정하기` 안에 합쳐 두었다. 실무자에게만 따로 선다.
      { key: 'request', label: '담당 배정 요청하기', desc: '내가 올린 배정 요청', admin: false, workerOnly: true },
    ],
  },
  {
    key: 'org',
    title: '기관 정보 관리',
    items: [
      { key: 'org-info', label: '기관 정보', desc: '기관 이름·번호·주소·전화', admin: true },
      { key: 'programs', label: '사업 목록', desc: '당사자 등록 시 고르는 사업', admin: true },
    ],
  },
  {
    key: 'system',
    title: '시스템',
    // 시스템만 **한 계층 더 들어간다**(2026-09-16 Q). 안의 화면들이 각자 크고
    // 서로 상관이 없어, 한 페이지에 쌓으면 무엇을 보러 왔는지 잃는다.
    nested: true,
    items: [
      { key: 'connections', label: '외부 서비스 연결', desc: 'AI 정리·녹음 글로 옮기기·데이터베이스 연결 상태', admin: true },
      { key: 'audit', label: '열람 기록 관리', desc: '누가 언제 무엇을 열었는지 검색', admin: true },
      { key: 'consent', label: '동의서 관리', desc: '지금 쓰는 동의 문안', admin: true },
      { key: 'download', label: '자료 다운로드', desc: '기간·실무자·종류를 정해 CSV 받기', admin: true },
    ],
  },
] as const;

export type SettingsItem = { key: string; label: string; desc: string; admin: boolean; workerOnly?: boolean };
export type SettingsGroup = {
  key: string;
  title: string;
  /** 참이면 항목을 펼치지 않고 목록으로 세운다. 눌러 들어간다. */
  nested: boolean;
  items: readonly SettingsItem[];
};

export const SETTINGS_GROUP_LIST: readonly SettingsGroup[] = SETTINGS_GROUPS.map((g) => ({
  key: g.key,
  title: g.title,
  nested: 'nested' in g && g.nested === true,
  items: [...g.items],
}));

/** 묶음 전체가 관리자 몫이면 실무자에게는 메뉴를 세우지 않는다. */
export const visibleGroups = (isAdmin: boolean): readonly SettingsGroup[] =>
  SETTINGS_GROUP_LIST.map((g) => ({
    ...g,
    items: g.items.filter((i) => (i.admin ? isAdmin : !(i.workerOnly && isAdmin))),
  })).filter((g) => g.items.length > 0);

export type SettingsModule = string;

/** 항목 하나를 그린다. 열람 기록은 자기 화면을 그대로 쓴다. */
function Pane({ item, me }: { item: SettingsItem; me: { id: number; name: string; role: string } }) {
  switch (item.key) {
    case 'profile':
      return <ProfilePane />;
    case 'theme':
      return <ThemePane />;
    case 'leave':
      return <LeavePane />;
    case 'assign':
      return <AssignPane me={me} />;
    case 'invite':
      return <InvitePane />;
    case 'workers':
      return <WorkersPane me={me} />;
    case 'request':
      return <RequestPane me={me} />;
    case 'org-info':
      return <OrgPane />;
    case 'programs':
      return <ProgramsPane />;
    case 'connections':
      return <ConnectionsPane />;
    case 'consent':
      return <ConsentPane />;
    case 'audit':
      return <AuditScreen embedded />;
    case 'download':
      return <DownloadPane />;
    default:
      return null;
  }
}

/**
 * 설정 한 페이지.
 *
 * 보통은 묶음의 항목이 **그대로 펼쳐진다** — 두 번 눌러야 닿던 것이 헷갈림의 원인이었다.
 * 다만 `nested` 묶음(시스템)은 안의 화면들이 각자 크고 서로 상관이 없어, 목록으로 세우고
 * 눌러 들어간다(2026-09-16 Q). 한 페이지에 쌓으면 무엇을 보러 왔는지 잃는다.
 */
export function SettingsScreen({
  module,
  me,
}: {
  module: SettingsModule;
  me: { id: number; name: string; role: string };
}) {
  const isAdmin = me.role === 'admin';
  const groups = visibleGroups(isAdmin);
  const group = groups.find((g) => g.key === module);
  // `시스템 › 열람 기록 관리`처럼 한 계층 안쪽을 가리키는 주소.
  const nestedItem = groups
    .filter((g) => g.nested)
    .flatMap((g) => g.items.map((i) => ({ group: g, item: i })))
    .find(({ item }) => item.key === module);

  // 관리자 전용을 주소로 직접 열면 여기서 막힌다. 감추기는 안내이지 잠금이 아니다.
  if (!group && !nestedItem) {
    const known =
      SETTINGS_GROUP_LIST.find((g) => g.key === module) ??
      SETTINGS_GROUP_LIST.flatMap((g) => g.items).find((i) => i.key === module);
    return (
      <>
        <PageHeader title={(known && ('title' in known ? known.title : known.label)) ?? '설정'} />
        <Card title="관리자 전용">
          <Empty>기관 관리자가 다루는 설정, 필요하면 관리자에게 문의</Empty>
        </Card>
      </>
    );
  }

  if (nestedItem) {
    return (
      <>
        {/* 되돌이 링크를 따로 두지 않는다 — 셸의 `뒤로`가 그 자리다(2026-09-16 Q). */}
        <PageHeader title={nestedItem.item.label} />
        <Pane item={nestedItem.item} me={me} />
      </>
    );
  }

  const g = group as SettingsGroup;
  if (g.nested) {
    return (
      <>
        <PageHeader title={g.title} meta={isAdmin ? '관리자' : '실무자'} />
        {/* 묶음 카드를 걷고 항목 넷을 **각자 카드로 올린다**(2026-09-17 Q). `무엇을 볼까요`
            한 장 안에 상자 넷을 넣으면 상자가 두 겹이고, 정작 고르는 대상은 안쪽 상자다. */}
        {g.items.map((i) => (
          <Card key={i.key}>
            <Item
              title={i.label}
              desc={i.desc}
              action={<Button onClick={() => (window.location.hash = `#/settings/${i.key}`)}>열기</Button>}
            />
          </Card>
        ))}
      </>
    );
  }

  return (
    <>
      <PageHeader title={g.title} meta={isAdmin ? '관리자' : '실무자'} />
      {g.items.map((item) => (
        <Pane item={item} me={me} key={item.key} />
      ))}
    </>
  );
}

// ── 공통 ──────────────────────────────────────────────────────────────────

function ProfilePane() {
  const [p, setP] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getProfile().then(setP);
  }, []);
  if (!p) return <Empty>불러오는 중</Empty>;

  const save = async () => {
    setErr(null);
    try {
      setP(await saveProfile({ name: p.name, phone: p.phone, contact_email: p.contact_email }));
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    }
  };

  return (
    <Card title="내 정보">
      <DataRows
        rows={[
          ['로그인 아이디', p.email],
          ['역할', p.role === 'admin' ? '관리자' : '실무자'],
        ]}
      />
      <Field label="이름" htmlFor="pf-name">
        <input id="pf-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      </Field>
      <Field label="연락처" htmlFor="pf-phone" hint="예: 010-1234-5678">
        <input id="pf-phone" value={p.phone ?? ''} onChange={(e) => setP({ ...p, phone: e.target.value })} />
      </Field>
      <Field label="이메일" htmlFor="pf-mail" hint="예: minhee@example.org">
        <input
          id="pf-mail"
          value={p.contact_email ?? ''}
          onChange={(e) => setP({ ...p, contact_email: e.target.value })}
        />
      </Field>
      <FormActions>
        {err && <ErrorText>{err}</ErrorText>}
        {saved && !err && <span className="panel-meta">저장됨</span>}
        <Button variant="primary" onClick={() => void save()}>
          저장하기
        </Button>
      </FormActions>
    </Card>
  );
}

// 설명은 보기 안에서 끝낸다(2026-09-17 Q "설명은 짧게 선택창 안에서") — 세 줄 카드로
// 늘어놓으면 고르는 일보다 읽는 일이 커진다(§13 설명형 글은 기본으로 두지 않는다).
const THEMES: ReadonlyArray<[ThemeChoice, string]> = [
  ['light', '밝게, 흰 바탕'],
  ['dark', '어둡게, 어두운 바탕'],
  ['system', '기기 설정 따라, 기기가 어두워지면 같이'],
];

function ThemePane() {
  const [t, setT] = useState<ThemeChoice>(themeChoice());
  return (
    <Card title="화면 테마">
      {/* 고르는 즉시 칠한다 — 저장 버튼을 두면 이미 바뀐 화면을 두고 한 번 더 누르게 된다. */}
      <Field label="테마" htmlFor="theme" control="select">
        <select
          id="theme"
          value={t}
          onChange={(e) => {
            const choice = e.target.value as ThemeChoice;
            setTheme(choice);
            setT(choice);
          }}
        >
          {THEMES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </Card>
  );
}

function LeavePane() {
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    try {
      await deactivateMe();
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '계정 삭제 실패');
    }
  };
  return (
    <Card title="계정 삭제하기" tone="warn">
      <Field label="확인" htmlFor="leave-c" tone="warn" hint="`나가기` 입력">
        <input id="leave-c" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <FormActions>
        {err && <ErrorText>{err}</ErrorText>}
        <Button variant="danger" disabled={confirm !== '나가기'} onClick={() => void go()}>
          계정 삭제하기
        </Button>
      </FormActions>
    </Card>
  );
}

// ── 관리자 ────────────────────────────────────────────────────────────────

function AssignPane({ me }: { me: { id: number } }) {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [dir, setDir] = useState<AssignmentCase[] | null>(null);
  const [dirError, setDirError] = useState('');
  const [openCase, setOpenCase] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 늦게 온 목록 응답이 새 것을 덮지 못하게 번호를 매긴다.
  const dirSeq = useRef(0);

  const loadDir = async () => {
    const seq = ++dirSeq.current;
    try {
      const rows = await listAssignmentCases();
      if (seq === dirSeq.current) {
        setDir(rows);
        setDirError('');
      }
    } catch (e) {
      if (seq === dirSeq.current)
        setDirError(e instanceof Error ? e.message : '불러오기 실패')
    }
  };

  const reload = async () => {
    try {
      const [staff, requests] = await Promise.all([listWorkers(), listRequests()]);
      setWorkers(staff);
      setReqs(requests);
      await loadDir();
    } catch (e) {
      setDirError(e instanceof Error ? e.message : '배정 정보 불러오기 실패');
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  const live = (workers ?? []).filter((w) => !w.deactivated_at);
  const toApprove = reqs.filter((r) => !r.decided_at && r.requester_id !== me.id);
  const mine = reqs.filter((r) => r.requester_id === me.id);

  const decide = async (id: number, decision: 'approved' | 'rejected') => {
    setSaving(true);
    setSaveError('');
    try {
      await decideRequest(id, decision);
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '배정 요청 처리 실패');
    } finally {
      setSaving(false);
    }
  };

  const openEditor = (c: AssignmentCase) => {
    if (openCase === c.id) {
      setOpenCase(null);
      return;
    }
    setOpenCase(c.id);
    setPicked(c.assignees.map((a) => a.id));
    setConfirmClear(false);
    setSaveError('');
  };

  const toggle = (id: number) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setConfirmClear(false);
  };

  const save = async (caseId: number, userIds: number[]) => {
    setSaving(true);
    setSaveError('');
    try {
      await assignCase(caseId, userIds);
      if (openCase === caseId) setOpenCase(null);
      setConfirmClear(false);
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const trySave = (c: AssignmentCase) => {
    // 아무도 고르지 않은 채 저장하면 담당이 전부 거둬진다 — 되돌릴 수 없으니
    // 같은 자리에서 한 번 더 묻는다(브라우저 confirm 은 이 화면에 없다).
    if (picked.length === 0 && c.assignees.length > 0 && !confirmClear) {
      setConfirmClear(true);
      return;
    }
    void save(c.id, picked);
  };

  return (
    <>
      {/* 승인할 것과 내가 올린 것을 한자리에 둔다(2026-09-16 Q) —
          관리자도 당사자를 맡는 사람이라 둘이 같이 있어야 흐름이 끊기지 않는다. */}
      <Card title="담당 배정 요청">
        {saveError && <ErrorText>{saveError}</ErrorText>}
        <h3 className="wire-subhead">승인할 배정 요청 목록</h3>
        {toApprove.length === 0 ? (
          <Empty>대기 중인 요청 없음</Empty>
        ) : (
          toApprove.map((r) => (
            <div className="wire-repeat-card" key={r.id}>
              <Item
                title={<Meta parts={[r.pseudonym, r.program_name]} />}
                desc={`${r.requester}, ${date(r.created_at)}${r.reason ? `, ${r.reason}` : ''}`}
                action={
                  <>
                    <Button
                      variant="primary"
                      disabled={saving}
                      onClick={() => void decide(r.id, 'approved')}
                    >
                      배정하기
                    </Button>
                    <Button disabled={saving} onClick={() => void decide(r.id, 'rejected')}>거절</Button>
                  </>
                }
              />
            </div>
          ))
        )}

        <h3 className="wire-subhead">내 요청</h3>
        {mine.length === 0 ? (
          <Empty>내가 올린 요청 없음</Empty>
        ) : (
          mine.map((r) => (
            <div className="wire-repeat-card" key={r.id}>
              <Item
                title={<Meta parts={[r.pseudonym, r.program_name]} />}
                desc={`${date(r.created_at)} 올림${r.reason ? `, ${r.reason}` : ''}`}
                action={
                  r.decided_at ? (
                    <Badge tone={r.decision === 'approved' ? 'mint' : undefined}>
                      {r.decision === 'approved' ? '배정됨' : '거절됨'}
                    </Badge>
                  ) : (
                    <>
                      <Badge tone="blue">기다리는 중</Badge>
                      <Button disabled={saving} onClick={() => void decide(r.id, 'approved')}>배정 확정</Button>
                      <Button disabled={saving} onClick={() => void decide(r.id, 'rejected')}>요청 취소</Button>
                    </>
                  )
                }
              />
            </div>
          ))
        )}
      </Card>

      {/* 사례를 먼저 고르고, 그 안에서 담당을 여럿 고른다. 목록에는 가명·사업·담당
          이름만 온다 — 관리자라도 맡지 않은 사례의 임상 내용은 서버가 안 준다. */}
      <Card title="담당 실무자 배정">
        {dirError ? (
          <>
            <ErrorText>{dirError}</ErrorText>
            <FormActions>
              <Button onClick={() => void reload()}>다시 불러오기</Button>
            </FormActions>
          </>
        ) : dir === null || workers === null ? (
          <Empty>불러오는 중</Empty>
        ) : dir.length === 0 ? (
          <Empty>등록된 사례 없음</Empty>
        ) : (
          dir.map((c) => (
            <div className="wire-repeat-card" key={c.id}>
              <Item
                title={<Meta parts={[c.pseudonym, c.program_name]} />}
                desc={`${c.status === 'open' ? '진행 중' : '종결'}, ${
                  c.assignees.length > 0 ? `담당 ${c.assignees.map((a) => a.name).join(', ')}` : '담당 없음'
                }`}
                action={
                  <Button disabled={saving} onClick={() => openEditor(c)}>
                    {openCase === c.id ? '접기' : '담당 고르기'}
                  </Button>
                }
              />
              {openCase === c.id && (
                <>
                  <ChoiceGroup legend="담당할 사람">
                    {live.map((w) => (
                      <Choice
                        key={w.id}
                        type="checkbox"
                        label={`${w.name}, ${w.email}`}
                        hint={w.role === 'admin' ? '관리자' : undefined}
                        checked={picked.includes(w.id)}
                        onChange={() => toggle(w.id)}
                      />
                    ))}
                  </ChoiceGroup>
                  {confirmClear && (
                    <ErrorText>아무도 고르지 않으면 담당 모두 해제</ErrorText>
                  )}
                  {saveError && <ErrorText>{saveError}</ErrorText>}
                  <FormActions>
                    <Button variant="primary" disabled={saving} onClick={() => trySave(c)}>
                      {confirmClear ? '모두 제외하기' : '저장하기'}
                    </Button>
                    <Button disabled={saving} onClick={() => setOpenCase(null)}>
                      닫기
                    </Button>
                  </FormActions>
                </>
              )}
            </div>
          ))
        )}
      </Card>
    </>
  );
}

export function InvitePane() {
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [role, setRole] = useState<'worker' | 'admin'>('worker');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    void listInvites().then(setRows);
  }, []);

  const make = async () => {
    const { token } = await createInvite(role, note.trim() || null);
    setLink(`${window.location.origin}${window.location.pathname}#/invite/${token}`);
    setNote('');
    setRows(await listInvites());
  };

  return (
    <>
      <Card
        title="실무자 초대"
        action={
          <Button variant="primary" onClick={() => void make()}>
            링크 만들기
          </Button>
        }
      >
        <div className="wire-container" data-grid="true">
          <div className="wire-col-6">
            <Field label="역할" htmlFor="iv-role" control="select">
              <select id="iv-role" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'admin')}>
                <option value="worker">실무자</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            {/* 역할 아래는 만든 링크(뒤에 QR)가 서는 자리다. 링크는 지금 한 번만 보인다 — 표에는 해시만 남는다. */}
            <div className="invite-link-slot" aria-live="polite">
              {link && (
                <div className="wire-form-field">
                  <span className="wire-form-label">초대 링크</span>
                  <div className="inline-action-row invite-link-row">
                    <div className="invite-link-card">
                      <code>{link}</code>
                    </div>
                    <Button onClick={() => void navigator.clipboard.writeText(link)}>복사하기</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="wire-col-6">
            <Field label="메모" htmlFor="iv-note" control="textarea">
              <textarea id="iv-note" rows={6} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="보낸 초대">
        {rows === null ? (
          <Empty>불러오는 중</Empty>
        ) : rows.length === 0 ? (
          <Empty>보낸 초대 없음</Empty>
        ) : (
          rows.map((v) => {
            const state = v.accepted_at
              ? '들어옴'
              : v.revoked_at
                ? '취소함'
                : new Date(v.expires_at) < new Date()
                  ? '기한 지남'
                  : '기다리는 중';
            return (
              <div className="wire-repeat-card" key={v.id}>
                <Item
                  title={`${v.role === 'admin' ? '관리자' : '실무자'}${v.note ? `, ${v.note}` : ''}`}
                  desc={`${date(v.created_at)} 만듦, ${date(v.expires_at)}까지, ${state}`}
                  action={
                    state === '기다리는 중' ? (
                      <Button onClick={() => void revokeInvite(v.id).then(setRows)}>취소하기</Button>
                    ) : undefined
                  }
                />
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}

/**
 * 실무자 목록. **한 사람이 한 줄이다**(2026-09-16 Q) — 두 층으로 쌓으면 열 명만 넘어도
 * 누가 몇 명을 맡았는지 견줄 수 없다. 맨 오른쪽이 `당사자 보기`다.
 * `#/settings/staff?program=<id>` 로 오면 그 사업의 열린 사례를 맡은 사람만 보인다(2026-09-17 Q).
 * 역할 바꾸기도 이 줄에서 한다 — 마지막 관리자는 서버가 막는다.
 */
function WorkersPane({ me }: { me: { id: number } }) {
  const [rows, setRows] = useState<Worker[] | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<number | null>(programFromHash);
  const [open, setOpen] = useState<number | null>(null);
  const [cases, setCases] = useState<WorkerCase[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void listPrograms(true).then(setPrograms);
  }, []);
  useEffect(() => {
    setRows(null);
    void listWorkers(programId ?? undefined).then(setRows);
  }, [programId]);
  useEffect(() => {
    if (open) void workerCases(open).then(setCases);
  }, [open]);

  const changeRole = async (w: Worker, role: 'worker' | 'admin') => {
    setErr(null);
    try {
      await setWorkerRole(w.id, role);
      setRows(await listWorkers(programId ?? undefined));
      // 자기 자신을 내렸으면 다음 요청부터 실무자다 — 셸이 알아야 하니 다시 읽게 한다.
      if (w.id === me.id) window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '역할 변경 실패');
    }
  };

  const picked = programs.find((p) => p.id === programId);
  return (
    <Card title="실무자 목록">
      <Field label="사업" htmlFor="wk-program" control="select" hint="선택한 사업의 진행 중 사례 담당자만 표시">
        <select
          id="wk-program"
          value={programId ?? ''}
          onChange={(e) => setProgramId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">사업 전체</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.retired_at ? ' (삭제됨)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {err && <ErrorText>{err}</ErrorText>}
      {rows === null ? (
        <Empty>불러오는 중</Empty>
      ) : rows.length === 0 ? (
        <Empty>{picked ? `${picked.name} 진행 중 사례 담당 실무자 없음` : '실무자 없음'}</Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>역할</th>
                <th>아이디</th>
                <th>맡은 당사자</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <Fragment key={w.id}>
                  <tr>
                    <td>{w.name}</td>
                    <td>{w.deactivated_at ? '나감' : w.role === 'admin' ? '관리자' : '실무자'}</td>
                    <td>{w.email}</td>
                    <td>{w.open_cases}명</td>
                    <td>
                      <div className="wire-form-actions">
                        {!w.deactivated_at && (
                          <Button
                            aria-label={`${w.name} ${w.role === 'admin' ? '실무자로 내리기' : '관리자로 올리기'}`}
                            onClick={() => void changeRole(w, w.role === 'admin' ? 'worker' : 'admin')}
                          >
                            {w.role === 'admin' ? '실무자로' : '관리자로'}
                          </Button>
                        )}
                        <Button onClick={() => setOpen(open === w.id ? null : w.id)}>
                          {open === w.id ? '접기' : '당사자 보기'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {open === w.id && (
                    <tr>
                      <td colSpan={5}>
                        {cases.length === 0 ? (
                          <Empty>맡고 있는 당사자 없음</Empty>
                        ) : (
                          cases.map((c) => (
                            <div key={c.id}>
                              <Meta parts={[c.pseudonym, c.program_name, c.status === 'open' ? '진행 중' : '종결']} />
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 기관 정보 네 칸 — 2행 2열. 필수는 이름 하나다(2026-09-17 Q). 설정과 마법사가 같은 칸을 쓴다. */
export function OrgForm({ value, onChange }: { value: Org; onChange: (next: Org) => void }) {
  return (
    <div className="wire-container" data-grid="true">
      <div className="wire-col-6">
        <Field label="기관 이름" htmlFor="og-name" required>
          <input id="og-name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </Field>
      </div>
      <div className="wire-col-6">
        <Field label="사업자·고유번호" htmlFor="og-reg">
          <input id="og-reg" value={value.reg_no ?? ''} onChange={(e) => onChange({ ...value, reg_no: e.target.value })} />
        </Field>
      </div>
      <div className="wire-col-6">
        <Field label="주소" htmlFor="og-addr">
          <input id="og-addr" value={value.address ?? ''} onChange={(e) => onChange({ ...value, address: e.target.value })} />
        </Field>
      </div>
      <div className="wire-col-6">
        <Field label="대표 전화" htmlFor="og-tel">
          <input id="og-tel" value={value.phone ?? ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

/** 빈 칸은 null 로 보낸다. */
export const orgPayload = (o: Org): Org => ({
  name: o.name.trim(),
  reg_no: o.reg_no?.trim() || null,
  address: o.address?.trim() || null,
  phone: o.phone?.trim() || null,
});

/** 설정 › 기관 정보. 접속 주소는 제목 옆 배지다(읽기 전용, 배포 설정) — 없으면 배지도 없다. */
export function OrgPane() {
  const [org, setOrg] = useState<OrgView | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getOrg().then(setOrg);
  }, []);
  if (!org) return <Empty>불러오는 중</Empty>;

  const save = async () => {
    setErr(null);
    try {
      setOrg(await saveOrg(orgPayload(org)));
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    }
  };

  return (
    <Card
      title="기관 정보"
      badge={org.public_address ?? undefined}
      action={
        <Button variant="primary" disabled={!org.name.trim()} onClick={() => void save()}>
          저장하기
        </Button>
      }
    >
      {err && <ErrorText>{err}</ErrorText>}
      {saved && !err && <p className="panel-meta">저장됨</p>}
      <OrgForm value={org} onChange={(next) => setOrg({ ...org, ...next })} />
    </Card>
  );
}

const period = (p: Program) => (p.starts_on || p.ends_on ? `${p.starts_on ?? '…'} ~ ${p.ends_on ?? '…'}` : '기간 없음');

/** 펼친 사업 한 장 — 파생 정보(담당 실무자·당사자 수)와 고치기 칸, 목록 링크, 삭제(내리기)/복구. */
function ProgramDetail({
  program: p,
  onChanged,
  onRetire,
}: {
  program: Program;
  onChanged: () => Promise<void>;
  onRetire: (p: Program, confirm: boolean) => Promise<void>;
}) {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [draft, setDraft] = useState<ProgramInput>({
    name: p.name,
    starts_on: p.starts_on,
    ends_on: p.ends_on,
    description: p.description,
  });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void listWorkers(p.id).then(setWorkers);
  }, [p.id]);

  const save = async () => {
    setErr(null);
    try {
      await updateProgram(p.id, { ...draft, name: draft.name.trim() });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    }
  };

  return (
    <>
      {/* 파생 정보 — 라벨은 민트 글자, 줄 사이 선 없음(2026-09-17 Q). 입력 칸 라벨과 구분한다. */}
      <dl className="wire-data-rows program-facts">
        <div className="wire-data-row">
          <dt>참여 당사자</dt>
          <dd>{`${p.cases}명, 진행 중 ${p.open_cases}명`}</dd>
        </div>
        <div className="wire-data-row">
          <dt>담당 실무자</dt>
          <dd>{workers === null ? '불러오는 중' : workers.length === 0 ? '없음' : workers.map((w) => w.name).join(', ')}</dd>
        </div>
      </dl>
      {!p.retired_at && (
        <div className="wire-container" data-grid="true">
          <div className="wire-col-6">
            <Field label="사업 이름" htmlFor={`pg-${p.id}-name`} required>
              <input id={`pg-${p.id}-name`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
          </div>
          <div className="wire-col-6">
            <Field label="한 줄 설명" htmlFor={`pg-${p.id}-desc`}>
              <input
                id={`pg-${p.id}-desc`}
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
              />
            </Field>
          </div>
          <div className="wire-col-6">
            <DatePicker
              id={`pg-${p.id}-start`}
              fieldLabel="시작"
              title="시작일 선택"
              required={false}
              hint=""
              value={draft.starts_on ?? ''}
              onChange={(v) => setDraft({ ...draft, starts_on: v || null })}
            />
          </div>
          <div className="wire-col-6">
            <DatePicker
              id={`pg-${p.id}-end`}
              fieldLabel="끝"
              title="종료일 선택"
              required={false}
              hint=""
              value={draft.ends_on ?? ''}
              onChange={(v) => setDraft({ ...draft, ends_on: v || null })}
            />
          </div>
        </div>
      )}
      {err && <ErrorText>{err}</ErrorText>}
      <FormActions>
        {p.retired_at ? (
          <Button aria-label={`${p.name} 복구`} onClick={() => void reopenProgram(p.id).then(onChanged)}>
            복구
          </Button>
        ) : (
          <>
            <Button variant="danger" aria-label={`${p.name} 삭제`} onClick={() => void onRetire(p, false)}>
              삭제
            </Button>
            <Button variant="primary" disabled={!draft.name.trim()} onClick={() => void save()}>
              저장하기
            </Button>
          </>
        )}
      </FormActions>
    </>
  );
}

/**
 * 사업 목록(2026-09-17 Q). 최신이 위, 한 사업이 아코디언 한 장. 추가는 목록 맨 위 한 줄에서 바로 한다.
 * 사업은 id 를 가진 실체다: 이름을 바꿔도 사례가 따라오고, 종료는 잠금이지 삭제가 아니며, 다시 열 수 있다.
 * 마법사의 사업 단계도 이 화면이다(`onChanged`).
 */
export function ProgramsPane({ onChanged }: { onChanged?: (programs: Program[]) => void } = {}) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  /** 방금 만든 사업. 그 아코디언을 펼쳐 놓아 바로 정보를 적게 한다. */
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [warning, setWarning] = useState<{ program: Program; counts: RetireWarning } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    const rows = await listPrograms(true);
    setPrograms(rows);
    onChanged?.(rows);
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setErr(null);
    try {
      const made = await addProgram({ name: name.trim(), starts_on: null, ends_on: null, description: null });
      setName('');
      setAdding(false);
      setJustAdded(made.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '추가 실패');
    }
  };

  // `삭제` 는 지우기가 아니라 내리기다(retired_at). 사례가 붙어 있어 지울 수 없고, 복구할 수 있다.
  const retire = async (p: Program, confirm: boolean) => {
    setErr(null);
    try {
      const out = await retireProgram(p.id, confirm);
      if ('warning' in out) {
        setWarning({ program: p, counts: out.warning });
        return;
      }
      setWarning(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  return (
    <>
      <Card
        title="사업 목록"
        action={
          <Button variant="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            사업 추가
          </Button>
        }
      >
        {adding && (
          <div className="inline-action-row">
            <Field label="새 사업 이름" htmlFor="pg-new-name" required>
              <input
                id="pg-new-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
              />
            </Field>
            <div className="wire-form-actions">
              <Button onClick={() => setAdding(false)}>취소</Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => void add()}>
                추가하기
              </Button>
            </div>
          </div>
        )}
        {err && <ErrorText>{err}</ErrorText>}
        {programs === null ? (
          <Empty>불러오는 중</Empty>
        ) : programs.length === 0 ? (
          <Empty>사업 없음</Empty>
        ) : (
          programs.map((p) => (
            <Fold
              key={p.id}
              group="programs"
             
              open={p.id === justAdded}
              title={p.retired_at ? `${p.name} (삭제됨)` : p.name}
              desc={<Meta parts={[period(p), `당사자 ${p.cases}명`, p.description]} />}
            >
              <ProgramDetail program={p} onChanged={reload} onRetire={retire} />
            </Fold>
          ))
        )}
      </Card>

      {warning && (
        <Confirm
          open
          title={`${warning.program.name} 삭제`}
          lines={[
            `진행 중 사례 ${warning.counts.open_cases}건, 예정 회차 ${warning.counts.planned_sessions}건`,
            '삭제 후 이 사업의 사례는 종결·열람 링크 회수·담당 배정만 가능, 새 기록 잠김, 기록은 보존',
            '삭제 전 scripts/backup.sh 백업 권장',
            '복구 가능',
          ]}
          confirmLabel="삭제하기"
          onConfirm={() => void retire(warning.program, true)}
          onCancel={() => setWarning(null)}
        />
      )}
    </>
  );
}

/**
 * 동의서 관리 — **읽기만 한다.** 문안은 코드가 정본이다(`api/src/consent.ts`).
 *
 * 화면에서 고치게 하지 않는 이유는 글자 하나가 바뀌면 이미 받은 동의가 전부
 * `확인 필요`로 떨어지기 때문이다. 그때는 **동의하신 분들께 다시 알리고 받아야 한다.**
 * 고치는 장치는 그 절차가 정해진 뒤에 붙인다(2026-09-16 Q).
 */
function ConsentPane() {
  const [rows, setRows] = useState<ConsentCopy[] | null>(null);
  useEffect(() => {
    void getConsentCopy().then(setRows);
  }, []);

  return (
    <>
      <Card title="동의서 문안">
        {rows === null ? (
          <Empty>불러오는 중</Empty>
        ) : (
          rows.map((r) => (
            <div className="wire-repeat-card" key={r.domain}>
              <Item title={r.label} desc={r.body} />
              <ConsentDetail copy={r} />
            </div>
          ))
        )}
      </Card>

      <Card title="문안을 고칠 때">
        <DataRows
          rows={[
            ['지금', '화면에서 수정 불가, 문안은 코드에 있음'],
            ['고치면', '그 영역에 동의한 모든 분이 `확인 필요`로 변경'],
            ['해야 할 일', '변경 내용 알림 후 재동의 필요, 받기 전까지 기능 멈춤'],
            ['고치는 버튼', '알리는 절차를 정한 뒤 추가'],
          ]}
        />
      </Card>
    </>
  );
}

/**
 * 자료 다운로드(2026-09-16 Q). 화면에서 찾는 것과 파일로 받는 것을 갈랐다 —
 * 찾기는 한 건을 짚는 일이고, 받기는 기간 전체를 통째로 옮기는 일이라 고를 것이 다르다.
 */
function DownloadPane() {
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState<'전부' | AuditKind>('전부');
  const [actor, setActor] = useState('');
  const [withNames, setWithNames] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    void listWorkers().then(setWorkers);
  }, []);

  const href = auditCsvHref(
    { days, kind: kind === '전부' ? undefined : kind, actor: actor ? Number(actor) : undefined },
    withNames,
  );

  return (
    <Card title="열람 기록 내려받기">
      <Field label="기간" htmlFor="dl-days">
        <div className="info-tabs" id="dl-days">
          {AUDIT_DAYS.map(([d, label]) => (
            <button type="button" key={d} className="wire-step" data-active={days === d} onClick={() => setDays(d)}>
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="실무자" htmlFor="dl-actor" control="select">
        <select id="dl-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">모두</option>
          {workers
            .filter((w) => !w.deactivated_at)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>
      </Field>

      <Field label="기록 종류" htmlFor="dl-kind">
        <div className="info-tabs" id="dl-kind">
          {AUDIT_KIND_TABS.map((k) => (
            <button
              type="button"
              key={k}
              className="wire-step"
              data-active={kind === k}
              onClick={() => setKind(k as '전부' | AuditKind)}
            >
              {k}
            </button>
          ))}
        </div>
      </Field>

      <Field label="당사자 표기" htmlFor="dl-names" control="select">
        <select
          id="dl-names"
          value={withNames ? 'name' : 'pseudonym'}
          onChange={(e) => setWithNames(e.target.value === 'name')}
        >
          <option value="pseudonym">가명만, 외부 제출용</option>
          <option value="name">이름 포함, 기관 안에서만</option>
        </select>
      </Field>

      <FormActions>
        <a className="wire-button" data-variant="primary" href={href}>
          <span className="wire-button-text">CSV 로 내려받기</span>
        </a>
      </FormActions>
    </Card>
  );
}

/**
 * 외부 서비스 연결(2026-09-17 Q, 이름은 2026-09-18 QA). 아코디언 셋 — AI 정리·녹음 글로 옮기기·데이터베이스. 접힌 줄에 상태·제공자·출처가 한 줄로 서고,
 * 펼치면 설정 자리다: AI 는 키 넣기, STT·DB 는 설정 가이드(랜딩의 가이드를 팝업으로 — 다음 세션).
 * OpenAI 키는 서버가 검증한 뒤 암호문으로 저장하고 값은 다시 보여 주지 않는다 — 저장돼 있으면 `••••••••` 로만 말한다.
 * 마법사의 5단계와 설정이 같은 화면이다.
 */
export function ConnectionsPane() {
  const [c, setC] = useState<Connections | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void getConnections().then(setC);
  }, []);
  if (!c) return <Empty>불러오는 중</Empty>;

  const submit = async (value: string | null) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await setAiKey(value);
      setKey('');
      setNote(value === null ? '키 삭제됨' : '키 확인 후 저장됨');
      setC(await getConnections());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  };

  const status = (ok: boolean) => (ok ? <Badge tone="mint">연결됨</Badge> : <Badge tone="coral">연결 안 됨</Badge>);
  const aiSource = c.ai.source === 'db' ? '저장된 키 ••••••••' : c.ai.source === 'env' ? `서버 ${c.ai.env}` : '키 없음';
  const row = (ok: boolean, text: string) => (
    <span className="connection-summary">
      {status(ok)}
      <span>{text}</span>
    </span>
  );
  /** 설치 순서와 안내. 무엇을 어디서, 그리고 AI(이 도구)가 어디까지 돕는지. */
  const guide = (steps: Array<[string, ReactNode]>) => (
    <ol className="connection-guide">
      {steps.map(([label, body]) => (
        <li key={label}>
          <strong>{label}</strong>
          <span>{body}</span>
        </li>
      ))}
    </ol>
  );
  const ext = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );

  return (
    <>
      <p className="panel-meta">AI 정리 · 녹음 글로 옮기기 · 데이터베이스 — 순서대로 연결, AI 정리 먼저</p>
      <div className="connection-list">
        <Fold title="1. AI 정리" group="connections" desc={row(c.ai.connected, `${c.ai.provider} · ${c.ai.model} · ${aiSource}`)}>
          {guide([
            ['키 발급', <>{ext('https://platform.openai.com/api-keys', 'OpenAI API keys')} → Create new secret key → 복사(한 번만 표시)</>],
            ['결제', <>{ext('https://platform.openai.com/settings/organization/billing', 'Billing')} 카드 등록 — 미등록이면 호출 거절</>],
            ['여기 입력', '아래 칸에 붙여 넣고 저장 — 서버가 OpenAI 확인 후 암호문 저장'],
            ['AI가 돕는 범위', '키 검증·저장·연결 상태 확인·요약 생성 — 계정 가입·결제·키 발급은 사람'],
          ])}
          {c.ai.provider === 'openai' && (
            <>
              <Field label="OpenAI API 키" htmlFor="ai-key">
                <input id="ai-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
              <FormActions>
                {err && <ErrorText>{err}</ErrorText>}
                {note && !err && <span className="panel-meta">{note}</span>}
                {c.ai.source === 'db' && (
                  <Button disabled={busy} onClick={() => void submit(null)}>
                    키 지우기
                  </Button>
                )}
                <Button variant="primary" disabled={busy || !key.trim()} onClick={() => void submit(key.trim())}>
                  {busy ? '확인하는 중…' : '저장하기'}
                </Button>
              </FormActions>
            </>
          )}
        </Fold>
        <Fold
          title="2. 녹음 글로 옮기기"
          group="connections"
         
          desc={row(c.stt.connected, `${c.stt.provider}${c.stt.region ? ` · ${c.stt.region}` : ''} · 서버 ${c.stt.env}`)}
        >
          {guide([
            ['리소스 만들기', <>{ext('https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices', 'Azure Speech 리소스 만들기')} — 리전 Korea Central, 요금제 S0</>],
            ['키·리전 확인', 'Azure 포털 › 리소스 › Keys and Endpoint 에서 KEY 1 과 Location/Region'],
            ['서버에 넣기', <>기관 서버 <code>.env</code> 의 <code>AZURE_SPEECH_KEY</code>·<code>AZURE_SPEECH_REGION</code> 입력 후 앱 재시작(<code>docs/deploy.md</code>)</>],
            ['AI가 돕는 범위', '연결 상태 확인·전사 실패 이유 안내 — Azure 가입·결제·리소스 생성·서버 파일 수정은 사람'],
          ])}
        </Fold>
        <Fold title="3. 데이터베이스" group="connections" desc={row(c.db.connected, `Postgres · 서버 ${c.db.env}`)}>
          {guide([
            ['DB 준비', <>{ext('https://supabase.com/dashboard', 'Supabase')} 프로젝트(서울 리전) 또는 기관 서버의 Postgres 17</>],
            ['연결 문자열', <>Supabase › Project Settings › Database 의 URI(<code>postgres://…</code>) → 기관 서버 <code>.env</code> 의 <code>DATABASE_URL</code></>],
            ['표 만들기', <><code>node api/src/migrate.ts</code> 로 스키마 적용 후 앱 재시작 — 백업은 <code>scripts/backup.sh</code></>],
            ['AI가 돕는 범위', '마이그레이션·백업·복구 실행과 상태 확인 — 계정 가입·결제·비밀번호 보관은 사람'],
          ])}
        </Fold>
      </div>
    </>
  );
}

// ── 실무자 ────────────────────────────────────────────────────────────────

function RequestPane({ me }: { me: { id: number } }) {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  useEffect(() => {
    void listRequests().then(setRows);
  }, [me.id]);
  return (
    <Card
      title="내가 올린 배정 요청"
    >
      {rows === null ? (
        <Empty>불러오는 중</Empty>
      ) : rows.length === 0 ? (
        <Empty>올린 요청 없음</Empty>
      ) : (
        rows.map((r) => (
          <div className="wire-repeat-card" key={r.id}>
            <Item
              title={<Meta parts={[r.pseudonym, r.program_name]} />}
              desc={`${date(r.created_at)} 올림${r.reason ? `, ${r.reason}` : ''}`}
              action={
                r.decided_at ? (
                  <Badge tone={r.decision === 'approved' ? 'mint' : undefined}>
                    {r.decision === 'approved' ? '배정됨' : '거절됨'}
                  </Badge>
                ) : (
                  <Badge tone="blue">기다리는 중</Badge>
                )
              }
            />
          </div>
        ))
      )}
    </Card>
  );
}
