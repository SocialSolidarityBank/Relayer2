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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { encode as encodeQr } from 'uqr';
import {
  ASSIGN_PAGE_SIZE,
  addProgram,
  createInvite,
  deactivateMe,
  decideRequest,
  getConnections,
  getConsentCopy,
  getOrg,
  getProfile,
  listAssignCases,
  listInvites,
  listPrograms,
  listRequests,
  listWorkers,
  auditCsvHref,
  putConsentCopy,
  reopenProgram,
  retireProgram,
  revokeInvite,
  saveOrg,
  saveProfile,
  setAiKey,
  setAssignments,
  setWorkerRole,
  updateProgram,
  Unauthorized,
  workerCaseRows,
  type AssignCase,
  type Connections,
  type ConsentCopy,
  type ConsentCopyInput,
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
  type WorkerCaseRow,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  Chevron,
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
  Select,
} from '../ui.tsx';
import { setTheme, themeChoice, type ThemeChoice } from '../theme.ts';
import { DatePicker } from '../date-picker.tsx';
import { Dialog } from '../dialog.tsx';
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
      { key: 'profile', label: '내 정보', desc: '이름, 연락처, 이메일', admin: false },
      { key: 'theme', label: '테마', desc: '밝게, 어둡게, 기기 설정', admin: false },
      { key: 'leave', label: '계정 삭제', desc: '로그인 차단, 기록은 유지', admin: false },
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
      { key: 'connections', label: '외부 서비스 연결', desc: 'AI 정리, 녹음 글로 옮기기, 데이터베이스 연결 상태', admin: true },
      { key: 'audit', label: '열람 기록 관리', desc: '누가 언제 무엇을 열었는지 검색', admin: true },
      { key: 'consent', label: '동의서 관리', desc: '지금 쓰는 동의 문안, 수정' , admin: true },
      { key: 'download', label: '자료 다운로드', desc: '기간, 실무자, 종류별 CSV 내려받기', admin: true },
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
    // 실무자에게 이 묶음의 내용은 `내가 올린 배정 요청` 하나뿐이다 — `실무자 관리`라
    // 부르면 없는 것을 기대하게 한다(2026-09-18). 사이드바·페이지 제목이 같은 값을 쓴다.
    title: g.key === 'staff' && !isAdmin ? '담당 배정 요청' : g.title,
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
            한 장 안에 상자 넷을 넣으면 상자가 두 겹이고, 정작 고르는 대상은 안쪽 상자다.
            한 항목은 **한 행**이다(2026-09-18 L1): 제목 · 설명(남는 폭) · 버튼, 세로 가운데. */}
        {g.items.map((i) => (
          <Card key={i.key}>
            <div className="system-row">
              <span className="wire-item-title" title={i.label}>{i.label}</span>
              <span className="wire-item-desc" title={i.desc}>{i.desc}</span>
              <Button onClick={() => (window.location.hash = `#/settings/${i.key}`)}>열기</Button>
            </div>
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

/**
 * 판이 처음 부르는 값 하나(2026-09-18 QA — 연결 판과 같은 규율). 실패하면 `불러오는 중` 에 갇히지 않고
 * `LoadError`(`다시 불러오기`)로 되돌아온다. 401 은 로그인 만료라 셸이 로그인 화면으로 바꾸게 다시 읽는다(routes.tsx 와 같은 경로).
 * `deps` 가 바뀌면 다시 부른다. 늦게 온 응답은 버린다(`live`).
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (e instanceof Unauthorized) {
          window.location.reload();
          return;
        }
        if (live) setError(e instanceof Error ? e.message : '불러오기 실패');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retry]);
  return { data, setData, error, reload: () => setRetry((n) => n + 1) };
}

/** `useLoad` 실패 자리. 까닭 한 줄과 `다시 불러오기`. */
export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <FormActions>
        <Button onClick={onRetry}>다시 불러오기</Button>
      </FormActions>
    </>
  );
}

/**
 * 내 정보(2026-09-18 L4 I1·I2). 읽는 값(아이디·역할·기관)은 한 행, 고치는 칸(이름·연락처·이메일)도
 * 한 행이다. `저장` 은 카드 머리 오른쪽 끝 — 본문 맨 아래까지 내려가 찾을 일이 없다.
 */
function ProfilePane() {
  const view = useLoad(async () => {
    const [profile, org] = await Promise.all([getProfile(), getOrg()]);
    return { profile, orgName: org.name };
  });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (view.error) return <Card title="내 정보"><LoadError error={view.error} onRetry={view.reload} /></Card>;
  if (!view.data) return <Empty>불러오는 중</Empty>;
  const { profile: p, orgName } = view.data;
  const setP = (next: Profile) => view.setData({ profile: next, orgName });

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
    <Card
      title="내 정보"
      className="me-profile"
      action={
        <span className="wire-card-action">
          <Button variant="primary" disabled={!p.name.trim()} onClick={() => void save()}>
            저장
          </Button>
        </span>
      }
    >
      {err && <ErrorText>{err}</ErrorText>}
      {saved && !err && <p className="panel-meta">저장됨</p>}
      <dl className="wire-data-rows me-facts">
        {([
          ['로그인 아이디', p.email],
          ['역할', p.role === 'admin' ? '관리자' : '실무자'],
          ['기관', orgName || '기관 이름 없음'],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div className="wire-data-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="form-row" data-cols="3">
        <Field label="이름" htmlFor="pf-name" required>
          <input id="pf-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field label="연락처" htmlFor="pf-phone">
          <input
            id="pf-phone"
            placeholder="010-1234-5678"
            value={p.phone ?? ''}
            onChange={(e) => setP({ ...p, phone: e.target.value })}
          />
        </Field>
        <Field label="이메일" htmlFor="pf-mail">
          <input
            id="pf-mail"
            placeholder="minhee@example.org"
            value={p.contact_email ?? ''}
            onChange={(e) => setP({ ...p, contact_email: e.target.value })}
          />
        </Field>
      </div>
    </Card>
  );
}

// 설명은 보기 안에서 끝낸다(2026-09-17 Q "설명은 짧게 선택창 안에서") — 세 줄 카드로
// 늘어놓으면 고르는 일보다 읽는 일이 커진다(§13 설명형 글은 기본으로 두지 않는다).
const THEMES: ReadonlyArray<[ThemeChoice, string]> = [
  ['light', '밝게'],
  ['dark', '어둡게'],
  ['system', '기기 설정'],
];

/** 테마(2026-09-18 L4 I3). 제목 줄 없는 카드 한 행 — 이름 왼쪽, 선택창 오른쪽. 고르는 즉시 칠한다. */
function ThemePane() {
  const [t, setT] = useState<ThemeChoice>(themeChoice());
  return (
    <Card>
      <Item
        title="테마"
        action={
          <Select
            id="theme"
            aria-label="테마"
            value={t}
            onChange={(v) => {
              const choice = v as ThemeChoice;
              setTheme(choice);
              setT(choice);
            }}
          >
            {THEMES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        }
      />
    </Card>
  );
}

/**
 * 계정 삭제(2026-09-18 L4 I4). 접힌 카드 한 행 — 제목 왼쪽, `삭제` 오른쪽 끝. 펼치면 확인 칸 하나가
 * 있고 `나가기` 를 적어야 버튼이 열린다. 설명 문장은 두지 않는다 — 칸의 placeholder 가 그 말이다.
 */
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
    <div className="leave-fold">
      <Fold
        title={<span className="fold-title">계정 삭제</span>}
        action={
          <Button
            variant="danger"
            disabled={confirm !== '나가기'}
            onClick={(e) => {
              e.stopPropagation();
              void go();
            }}
          >
            삭제
          </Button>
        }
      >
        <Field label="확인" htmlFor="leave-c" tone="warn" hideLabel>
          <input
            id="leave-c"
            aria-label="확인"
            placeholder="나가기 입력"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {err && <ErrorText>{err}</ErrorText>}
      </Fold>
    </div>
  );
}

// ── 관리자 ────────────────────────────────────────────────────────────────

/**
 * 담당 배정(2026-09-18 L4 J2·J3). 위는 요청 두 카드가 나란히(승인할 것 · 내 것), 아래는 당사자
 * 한 사람이 **한 행**인 배정 목록이다 — 찾기·사업 걸개·열 장씩 쪽 넘기기. `실무자 배정` 을
 * 누르면 오른쪽 드로어에서 여러 명을 더하고 빼고 저장한다(D7: 담당은 모두 같은 권한).
 * 목록 모양은 L5 계약(`GET /assign/cases`)이고 채우는 일은 `api.ts` 가 한다.
 */
function AssignPane({ me }: { me: { id: number } }) {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [q, setQ] = useState('');
  const [program, setProgram] = useState('all');
  const [page, setPage] = useState(1);
  const [dir, setDir] = useState<{ items: AssignCase[]; total: number } | null>(null);
  const [dirError, setDirError] = useState('');
  const [editing, setEditing] = useState<AssignCase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 늦게 온 목록 응답이 새 것을 덮지 못하게 번호를 매긴다.
  const dirSeq = useRef(0);

  const loadDir = async () => {
    const seq = ++dirSeq.current;
    try {
      const out = await listAssignCases({ q, program: program === 'all' ? null : Number(program), page });
      if (seq === dirSeq.current) {
        setDir(out);
        setDirError('');
      }
    } catch (e) {
      if (seq === dirSeq.current) setDirError(e instanceof Error ? e.message : '불러오기 실패');
    }
  };

  const reload = async () => {
    try {
      const [staff, requests, progs] = await Promise.all([listWorkers(), listRequests(), listPrograms(true)]);
      setWorkers(staff);
      setReqs(requests);
      setPrograms(progs);
      await loadDir();
    } catch (e) {
      setDirError(e instanceof Error ? e.message : '배정 정보 불러오기 실패');
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 찾기·걸개를 바꾸면 첫 쪽으로. 쪽만 바꾸면 그 쪽을 다시 부른다.
  useEffect(() => {
    setPage(1);
  }, [q, program]);
  useEffect(() => {
    void loadDir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, program, page]);

  const live = (workers ?? []).filter((w) => !w.deactivated_at);
  const toApprove = reqs.filter((r) => !r.decided_at && r.requester_id !== me.id);
  const mine = reqs.filter((r) => r.requester_id === me.id);
  const pages = Math.max(1, Math.ceil((dir?.total ?? 0) / ASSIGN_PAGE_SIZE));

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

  const save = async (caseId: number, userIds: number[]) => {
    setSaving(true);
    setSaveError('');
    try {
      await setAssignments(caseId, userIds);
      setEditing(null);
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const request = (r: RequestRow, action: ReactNode) => (
    <div className="wire-repeat-card" key={r.id}>
      <Item
        title={<Meta parts={[r.pseudonym, r.program_name]} />}
        desc={`${r.requester}, ${date(r.created_at)}${r.reason ? `, ${r.reason}` : ''}`}
        action={action}
      />
    </div>
  );

  return (
    <>
      {/* 승인할 것과 내가 올린 것을 한자리에 둔다(2026-09-16 Q) — 관리자도 당사자를 맡는 사람이라
          둘이 같이 있어야 흐름이 끊기지 않는다. 두 카드는 나란히 서고 위를 맞춘다(J2). */}
      <div className="card-grid assign-requests" data-align="start">
        <Card title="승인할 배정 요청">
          {saveError && <ErrorText>{saveError}</ErrorText>}
          {toApprove.length === 0 ? (
            <Empty>대기 중인 요청 없음</Empty>
          ) : (
            toApprove.map((r) =>
              request(
                r,
                <>
                  <Button variant="primary" disabled={saving} onClick={() => void decide(r.id, 'approved')}>
                    배정
                  </Button>
                  <Button disabled={saving} onClick={() => void decide(r.id, 'rejected')}>
                    거절
                  </Button>
                </>,
              ),
            )
          )}
        </Card>
        <Card title="내 배정 요청">
          {mine.length === 0 ? (
            <Empty>내가 올린 요청 없음</Empty>
          ) : (
            mine.map((r) =>
              request(
                r,
                r.decided_at ? (
                  <Badge tone={r.decision === 'approved' ? 'mint' : undefined}>
                    {r.decision === 'approved' ? '배정됨' : '거절됨'}
                  </Badge>
                ) : (
                  <>
                    <Badge tone="blue">기다리는 중</Badge>
                    <Button disabled={saving} onClick={() => void decide(r.id, 'approved')}>
                      배정 확정
                    </Button>
                    <Button disabled={saving} onClick={() => void decide(r.id, 'rejected')}>
                      요청 취소
                    </Button>
                  </>
                ),
              ),
            )
          )}
        </Card>
      </div>

      {/* 당사자 한 사람이 한 행이다. 목록에는 가명·사업·담당 이름만 온다 — 관리자라도 맡지 않은
          사례의 임상 내용은 서버가 안 준다. 연락처·이메일은 L5 가 주면 그대로 선다. */}
      <Card title="담당 실무자 배정">
        <div className="work-toolbar assign-toolbar">
          <div className="wire-input-box assign-toolbar-search">
            <input
              id="assign-q"
              type="search"
              aria-label="찾기"
              placeholder="이름, 아이디, 사업 이름, 실무자"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select id="assign-program" aria-label="사업 걸개" value={program} onChange={setProgram}>
            <option value="all">사업 전체</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.retired_at ? ' (종료됨)' : ''}
              </option>
            ))}
          </Select>
        </div>
        {dirError ? (
          <>
            <ErrorText>{dirError}</ErrorText>
            <FormActions>
              <Button onClick={() => void reload()}>다시 불러오기</Button>
            </FormActions>
          </>
        ) : dir === null || workers === null ? (
          <Empty>불러오는 중</Empty>
        ) : dir.total === 0 ? (
          <Empty>{q || program !== 'all' ? '검색 결과 없음' : '등록된 사례 없음'}</Empty>
        ) : (
          <div className="assign-case-list">
            {dir.items.map((c) => (
              <div className="assign-case-row" key={c.case_id}>
                <span className="assign-case-name">{c.name ?? c.login}</span>
                <Meta
                  parts={[
                    c.name ? c.login : null,
                    c.seq ? `${c.program} ${c.seq}회차` : c.program,
                    c.phone,
                    c.email,
                  ]}
                />
                <span className="assign-case-workers">
                  {c.assignees.length > 0 ? `담당 ${c.assignees.map((a) => a.name).join(', ')}` : '담당 없음'}
                </span>
                <Button
                  disabled={saving}
                  aria-label={`${c.name ?? c.login} 실무자 배정`}
                  onClick={() => {
                    setSaveError('');
                    setEditing(c);
                  }}
                >
                  실무자 배정
                </Button>
              </div>
            ))}
          </div>
        )}
        {pages > 1 && (
          <nav className="assign-pager" aria-label="쪽 넘기기">
            <Button aria-label="이전 쪽" disabled={page === 1} onClick={() => setPage(page - 1)}>
              <Chevron dir="left" />
            </Button>
            <p className="assign-pager-label" aria-live="polite">
              {page} / {pages} 쪽
            </p>
            <Button aria-label="다음 쪽" disabled={page === pages} onClick={() => setPage(page + 1)}>
              <Chevron dir="right" />
            </Button>
          </nav>
        )}
      </Card>

      {editing && (
        <AssignDrawer
          row={editing}
          workers={live}
          saving={saving}
          error={saveError}
          onSave={(ids) => void save(editing.case_id, ids)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/**
 * 담당 실무자 드로어(J3). 지금 담당은 `담당 실무자` 배지를 달고 서 있고, 선택창에서 골라 `+` 로
 * 더하고 행의 `−` 로 뺀다. `저장` 이 목록 전체를 그 사례의 담당으로 치환한다 — 빈 채로 저장하면
 * 담당이 전부 거둬지므로 같은 자리에서 한 번 더 묻는다.
 */
function AssignDrawer({
  row,
  workers,
  saving,
  error,
  onSave,
  onClose,
}: {
  row: AssignCase;
  workers: Worker[];
  saving: boolean;
  error: string;
  onSave: (userIds: number[]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<number[]>(row.assignees.map((a) => a.id));
  const [choice, setChoice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const current = new Set(row.assignees.map((a) => a.id));
  const byId = new Map(workers.map((w) => [w.id, w]));
  const rest = workers.filter((w) => !picked.includes(w.id));
  const chosen = choice ? Number(choice) : rest[0]?.id;

  const add = () => {
    if (!chosen) return;
    setPicked((p) => [...p, chosen]);
    setChoice('');
    setConfirmClear(false);
  };
  const trySave = () => {
    if (picked.length === 0 && row.assignees.length > 0 && !confirmClear) {
      setConfirmClear(true);
      return;
    }
    onSave(picked);
  };

  return (
    <dialog
      ref={dialog}
      className="side-drawer assign-drawer"
      aria-labelledby="assign-drawer-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="side-drawer-head">
        <h2 id="assign-drawer-title">{row.name ?? row.login} 담당 실무자</h2>
        <Button onClick={() => dialog.current?.close()}>닫기</Button>
      </div>
      <div className="side-drawer-body">
        <p className="panel-meta">
          <Meta parts={[row.name ? row.login : null, row.program, '진행 중']} />
        </p>
        {picked.length === 0 ? (
          <Empty>담당 없음</Empty>
        ) : (
          <div className="assign-pick-list">
            {picked.map((id) => {
              const w = byId.get(id);
              const name = w?.name ?? row.assignees.find((a) => a.id === id)?.name;
              if (!name) return null;
              return (
                <div className="assign-pick-row" key={id}>
                  <span className="assign-case-name">{name}</span>
                  {w && <Meta parts={[w.role === 'admin' ? '관리자' : '실무자', w.email]} />}
                  {current.has(id) && <Badge tone="mint">담당 실무자</Badge>}
                  <Button
                    aria-label={`${name} 제외`}
                    disabled={saving}
                    onClick={() => {
                      setPicked((p) => p.filter((x) => x !== id));
                      setConfirmClear(false);
                    }}
                  >
                    −
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <div className="inline-action-row assign-add-row">
          <Select id="assign-pick" aria-label="실무자 선택" value={chosen ? String(chosen) : ''} onChange={setChoice}>
            {rest.length === 0 && <option value="">더할 실무자 없음</option>}
            {rest.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}, {w.role === 'admin' ? '관리자' : '실무자'}
              </option>
            ))}
          </Select>
          <Button aria-label="실무자 추가" disabled={saving || !chosen} onClick={add}>
            +
          </Button>
        </div>
        {confirmClear && <ErrorText>아무도 고르지 않으면 담당 모두 해제</ErrorText>}
        {error && <ErrorText>{error}</ErrorText>}
        <FormActions>
          <Button disabled={saving} onClick={() => dialog.current?.close()}>
            닫기
          </Button>
          <Button variant="primary" disabled={saving} onClick={trySave}>
            {confirmClear ? '모두 제외' : '저장'}
          </Button>
        </FormActions>
      </div>
    </dialog>
  );
}

/**
 * 초대 링크 QR(2026-09-18 온보딩 후속 3). 링크 아래, 역할 열 안에 선다. 모듈을 `<path>` 하나로 그린다 —
 * 화면 테마와 무관하게 늘 검정 위 흰색이어야 카메라가 읽는다. `uqr`(무의존, 7KB)이 부호화만 맡는다.
 */
function InviteQr({ link }: { link: string }) {
  const { size, data } = encodeQr(link, { border: 1 });
  let d = '';
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return (
    <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="초대 링크 QR" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

export function InvitePane() {
  const sent = useLoad(listInvites);
  const [role, setRole] = useState<'worker' | 'admin'>('worker');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const make = async () => {
    setErr(null);
    try {
      const { token } = await createInvite(role, note.trim() || null);
      setLink(`${window.location.origin}${window.location.pathname}#/invite/${token}`);
      setNote('');
      sent.setData(await listInvites());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '링크 만들기 실패');
    }
  };
  const revoke = async (id: number) => {
    setErr(null);
    try {
      sent.setData(await revokeInvite(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '취소 실패');
    }
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
            {/* 역할 아래는 만든 링크와 QR 이 서는 자리다. 링크는 지금 한 번만 보인다 — 표에는 해시만 남는다. */}
            <div className="invite-link-slot" aria-live="polite">
              {err && <ErrorText>{err}</ErrorText>}
              {link && (
                <div className="wire-form-field">
                  <span className="wire-form-label">초대 링크</span>
                  <div className="inline-action-row invite-link-row">
                    <div className="invite-link-card">
                      <code>{link}</code>
                    </div>
                    <Button onClick={() => void navigator.clipboard.writeText(link)}>복사하기</Button>
                  </div>
                  <InviteQr link={link} />
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
        {sent.error ? (
          <LoadError error={sent.error} onRetry={sent.reload} />
        ) : sent.data === null ? (
          <Empty>불러오는 중</Empty>
        ) : sent.data.length === 0 ? (
          <Empty>보낸 초대 없음</Empty>
        ) : (
          sent.data.map((v) => {
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
                      <Button onClick={() => void revoke(v.id)}>취소하기</Button>
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
 * 실무자 목록(2026-09-18 L4 J1). **한 사람이 접힌 카드 하나**다 — 가로선 표를 걷었다. 접힌 머리에
 * 이름·역할·아이디·맡은 수가 한 줄로 서고, 펼치면 역할 바꾸기와 `담당 중인 당사자`(팝업 표)가 있다.
 * `#/settings/staff?program=<id>` 로 오면 그 사업의 열린 사례를 맡은 사람만 보인다(2026-09-17 Q).
 * 마지막 관리자를 내리는 것은 서버가 막는다.
 */
function WorkersPane({ me }: { me: { id: number } }) {
  const progs = useLoad(() => listPrograms(true));
  const [programId, setProgramId] = useState<number | null>(programFromHash);
  const staff = useLoad(() => listWorkers(programId ?? undefined), [programId]);
  const [viewing, setViewing] = useState<Worker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const programs = progs.data ?? [];
  const rows = staff.data;

  const changeRole = async (w: Worker, role: 'worker' | 'admin') => {
    setErr(null);
    try {
      await setWorkerRole(w.id, role);
      staff.setData(await listWorkers(programId ?? undefined));
      // 자기 자신을 내렸으면 다음 요청부터 실무자다 — 셸이 알아야 하니 다시 읽게 한다.
      if (w.id === me.id) window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '역할 변경 실패');
    }
  };

  const picked = programs.find((p) => p.id === programId);
  return (
    <Card title="실무자 목록">
      <Field label="사업" htmlFor="wk-program" control="select">
        <select
          id="wk-program"
          value={programId ?? ''}
          onChange={(e) => setProgramId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">사업 전체</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.retired_at ? ' (종료됨)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {err && <ErrorText>{err}</ErrorText>}
      {progs.error || staff.error ? (
        <LoadError error={progs.error ?? staff.error ?? ''} onRetry={progs.error ? progs.reload : staff.reload} />
      ) : rows === null ? (
        <Empty>불러오는 중</Empty>
      ) : rows.length === 0 ? (
        <Empty>{picked ? `${picked.name} 진행 중 사례 담당 실무자 없음` : '실무자 없음'}</Empty>
      ) : (
        <div className="worker-list">
          {rows.map((w) => (
            <Fold
              key={w.id}
              group="workers"
              title={w.name}
              desc={
                <Meta
                  parts={[
                    w.deactivated_at ? '나감' : w.role === 'admin' ? '관리자' : '실무자',
                    w.email,
                    `맡은 당사자 ${w.open_cases}명`,
                  ]}
                />
              }
            >
              <FormActions>
                {!w.deactivated_at && (
                  <Button
                    aria-label={`${w.name} ${w.role === 'admin' ? '실무자로 내리기' : '관리자로 올리기'}`}
                    onClick={() => void changeRole(w, w.role === 'admin' ? 'worker' : 'admin')}
                  >
                    {w.role === 'admin' ? '실무자로' : '관리자로'}
                  </Button>
                )}
                <Button aria-haspopup="dialog" onClick={() => setViewing(w)}>
                  담당 중인 당사자
                </Button>
              </FormActions>
            </Fold>
          ))}
        </div>
      )}
      {viewing && <AssigneeDialog worker={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

/**
 * 한 실무자가 맡은 당사자 표(J1). 팝업 모달이다 — 목록 안에서 줄을 펼치면 표가 표를 밀어 견줄 수
 * 없었다. 열은 L5 계약(`GET /users/:id/cases`) 그대로 이름·사업·회차·다음 상담이다.
 */
function AssigneeDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<WorkerCaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    void workerCaseRows(worker.id)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'));
  }, [worker.id]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <dialog ref={dialog} className="assignee-dialog" aria-labelledby="assignee-title" onClose={onClose}>
      <h2 id="assignee-title">{worker.name} 담당 중인 당사자</h2>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : rows === null ? (
        <Empty>불러오는 중</Empty>
      ) : rows.length === 0 ? (
        <Empty>맡고 있는 당사자 없음</Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>사업</th>
                <th>회차</th>
                <th>다음 상담</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.case_id}>
                  <td>{c.name ?? ''}</td>
                  <td>{c.program}</td>
                  <td>{c.seq ? `${c.seq}회차` : '기록 없음'}</td>
                  <td>{c.next_at ? when(c.next_at) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormActions>
        <Button onClick={() => dialog.current?.close()}>닫기</Button>
      </FormActions>
    </dialog>
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
  const { data: org, setData: setOrg, error, reload } = useLoad(getOrg);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Card title="기관 정보"><LoadError error={error} onRetry={reload} /></Card>;
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
      className="org-card"
      badge={org.public_address ?? undefined}
      action={
        <span className="wire-card-action">
          <Button variant="primary" disabled={!org.name.trim()} onClick={() => void save()}>
            저장
          </Button>
        </span>
      }
    >
      {err && <ErrorText>{err}</ErrorText>}
      {saved && !err && <p className="panel-meta">저장됨</p>}
      <OrgForm value={org} onChange={(next) => setOrg({ ...org, ...next })} />
    </Card>
  );
}

const period = (p: Program) => (p.starts_on || p.ends_on ? `${p.starts_on ?? '…'} ~ ${p.ends_on ?? '…'}` : '기간 없음');

/** 펼친 사업 한 장 — 파생 정보(담당 실무자·당사자 수)와 고치기 칸. 종료·복구는 접힌 머리의 버튼이다(K1). */
function ProgramDetail({ program: p, onChanged }: { program: Program; onChanged: () => Promise<void> }) {
  const staff = useLoad(() => listWorkers(p.id), [p.id]);
  const [draft, setDraft] = useState<ProgramInput>({
    name: p.name,
    starts_on: p.starts_on,
    ends_on: p.ends_on,
    description: p.description,
  });
  const [err, setErr] = useState<string | null>(null);

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
          <dd>
            {staff.error ? (
              <>
                {staff.error}{' '}
                <Button onClick={staff.reload}>다시 불러오기</Button>
              </>
            ) : staff.data === null ? (
              '불러오는 중'
            ) : staff.data.length === 0 ? (
              '없음'
            ) : (
              staff.data.map((w) => w.name).join(', ')
            )}
          </dd>
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
      {!p.retired_at && (
        <FormActions>
          <Button variant="primary" disabled={!draft.name.trim()} onClick={() => void save()}>
            저장
          </Button>
        </FormActions>
      )}
    </>
  );
}

/**
 * 사업 목록(2026-09-17 Q). 최신이 위, 한 사업이 아코디언 한 장. 추가는 목록 위 한 줄(입력칸 + `사업 추가`)에서
 * 바로 한다(2026-09-18 K2). 접힌 머리가 **한 행**이다: 이름 · 기간 · 당사자 수 · 설명 · `사업 종료`(K1).
 * 사업은 id 를 가진 실체다: 이름을 바꿔도 사례가 따라오고, 종료는 잠금이지 삭제가 아니며, 다시 열 수 있다.
 * 마법사의 사업 단계도 이 화면이다(`onChanged`).
 */
export function ProgramsPane({ onChanged }: { onChanged?: (programs: Program[]) => void } = {}) {
  const [name, setName] = useState('');
  /** 방금 만든 사업. 그 아코디언을 펼쳐 놓아 바로 정보를 적게 한다. */
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [warning, setWarning] = useState<{ program: Program; counts: RetireWarning } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchPrograms = async () => {
    const rows = await listPrograms(true);
    onChanged?.(rows);
    return rows;
  };
  const list = useLoad(fetchPrograms);
  const programs = list.data;
  const reload = async () => list.setData(await fetchPrograms());

  const add = async () => {
    if (!name.trim()) return;
    setErr(null);
    try {
      const made = await addProgram({ name: name.trim(), starts_on: null, ends_on: null, description: null });
      setName('');
      setJustAdded(made.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '추가 실패');
    }
  };

  // `사업 종료` 는 지우기가 아니라 내리기다(retired_at). 사례가 붙어 있어 지울 수 없고, 복구할 수 있다.
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
      setErr(e instanceof Error ? e.message : '사업 종료 실패');
    }
  };
  const reopen = async (p: Program) => {
    setErr(null);
    try {
      await reopenProgram(p.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '복구 실패');
    }
  };

  return (
    <>
      <Card title="사업 목록">
        <div className="inline-action-row program-add-row">
          <div className="wire-input-box">
            <input
              id="pg-new-name"
              aria-label="새 사업 이름"
              placeholder="새 사업 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
            />
          </div>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void add()}>
            사업 추가
          </Button>
        </div>
        {err && <ErrorText>{err}</ErrorText>}
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : programs === null ? (
          <Empty>불러오는 중</Empty>
        ) : programs.length === 0 ? (
          <Empty>사업 없음</Empty>
        ) : (
          programs.map((p) => (
            <Fold
              key={p.id}
              group="programs"
              open={p.id === justAdded}
              title={
                <span className="program-row">
                  <span className="program-row-name">{p.retired_at ? `${p.name} (종료됨)` : p.name}</span>
                  <Meta parts={[period(p), `당사자 ${p.cases}명`, p.description]} />
                  {p.retired_at ? (
                    <Button
                      aria-label={`${p.name} 복구`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void reopen(p);
                      }}
                    >
                      복구
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      aria-label={`${p.name} 사업 종료`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void retire(p, false);
                      }}
                    >
                      사업 종료
                    </Button>
                  )}
                </span>
              }
            >
              <ProgramDetail program={p} onChanged={reload} />
            </Fold>
          ))
        )}
      </Card>

      {warning && (
        <Confirm
          open
          title={`${warning.program.name} 사업 종료`}
          lines={[
            `진행 중 사례 ${warning.counts.open_cases}건, 예정 회차 ${warning.counts.planned_sessions}건`,
            '종료 후 이 사업의 사례는 종결, 열람 링크 회수, 담당 배정만 가능, 새 기록 잠김, 기록은 보존',
            '종료 전 scripts/backup.sh 백업 권장',
            '복구 가능',
          ]}
          confirmLabel="사업 종료"
          onConfirm={() => void retire(warning.program, true)}
          onCancel={() => setWarning(null)}
        />
      )}
    </>
  );
}

/**
 * 동의서 관리(2026-09-18 L4 L3, Q 결정 D6). 당사자 정보 탭의 동의 카드와 같은 구성 — 영역 하나가 접힌
 * 카드 하나이고, 읽기는 공용 `ConsentDetail` 이다. 판·지문은 **여기에만** 보인다(D9, 내규 번호 역할).
 *
 * **관리자가 고칠 수 있다.** 저장하면 새 판이 되고(L5 `PUT /consent-copy/:domain`), 그 영역에 동의한
 * 모든 당사자가 `확인 필요` 로 떨어진다 — 저장 앞에서 그 사실을 한 번 더 묻는다. 실사용 중이면
 * 이메일 등 정해진 방식으로 고지하고 다시 받아야 한다.
 */
function ConsentPane() {
  const { data: rows, setData: setRows, error, reload } = useLoad(getConsentCopy);
  const [editing, setEditing] = useState<ConsentCopy | null>(null);

  return (
    <>
      <Card title="동의서 문안">
        {error ? (
          <LoadError error={error} onRetry={reload} />
        ) : rows === null ? (
          <Empty>불러오는 중</Empty>
        ) : (
          rows.map((r) => (
            <Fold
              key={r.domain}
              group="consent-copy"
              title={r.label}
              desc={<Meta parts={[r.body, `판 ${r.version}`, `지문 ${r.hash}`]} />}
            >
              <ConsentDetail copy={r} />
              {r.editable && (
                <FormActions>
                  <Button aria-label={`${r.label} 문안 수정`} onClick={() => setEditing(r)}>
                    수정
                  </Button>
                </FormActions>
              )}
            </Fold>
          ))
        )}
      </Card>
      {editing && (
        <ConsentEditor
          copy={editing}
          onSaved={(next) => {
            setRows((rs) => (rs ?? []).map((r) => (r.domain === next.domain ? next : r)));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/**
 * 문안 수정 드로어(L3). 표준 양식 다섯 칸 — 동의 내용, 동의 항목(줄 하나가 항목 하나), 동의 목적,
 * 보유·이용 기간, 동의 거부권과 불이익. `저장` 은 경고창(D6)을 거친다.
 */
function ConsentEditor({
  copy,
  onSaved,
  onClose,
}: {
  copy: ConsentCopy;
  onSaved: (next: ConsentCopy) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ConsentCopyInput>({
    copy: copy.body,
    items: copy.items,
    purpose_text: copy.purpose_text,
    retention_text: copy.retention_text,
    refusal_text: copy.refusal_text,
  });
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const items = draft.items.map((s) => s.trim()).filter(Boolean);
  const ready =
    draft.copy.trim() && items.length > 0 && draft.purpose_text.trim() && draft.retention_text.trim() && draft.refusal_text.trim();

  const save = async () => {
    setAsking(false);
    setSaving(true);
    setErr(null);
    try {
      onSaved(
        await putConsentCopy(copy.domain, {
          copy: draft.copy.trim(),
          items,
          purpose_text: draft.purpose_text.trim(),
          retention_text: draft.retention_text.trim(),
          refusal_text: draft.refusal_text.trim(),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const area = (label: string, key: 'purpose_text' | 'retention_text' | 'refusal_text', rows = 3) => (
    <Field label={label} htmlFor={`cc-${key}`} control="textarea" required>
      <textarea id={`cc-${key}`} rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </Field>
  );

  return (
    <dialog
      ref={dialog}
      className="side-drawer consent-editor"
      aria-labelledby="consent-editor-title"
      // React 는 `close` 를 부모로 올린다 — 안의 경고창이 닫힐 때 드로어까지 닫히지 않게 자기 것만 받는다.
      onClose={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="side-drawer-head">
        <h2 id="consent-editor-title">{copy.label} 문안 수정</h2>
        <Button onClick={() => dialog.current?.close()}>닫기</Button>
      </div>
      <div className="side-drawer-body">
        <p className="panel-meta">
          <Meta parts={[`판 ${copy.version}`, `지문 ${copy.hash}`, '저장하면 새 판']} />
        </p>
        <Field label="동의 내용" htmlFor="cc-copy" control="textarea" required>
          <textarea id="cc-copy" rows={6} value={draft.copy} onChange={(e) => setDraft({ ...draft, copy: e.target.value })} />
        </Field>
        <Field label="동의 항목" htmlFor="cc-items" control="textarea" required>
          <textarea
            id="cc-items"
            rows={4}
            placeholder="한 줄에 항목 하나"
            value={draft.items.join('\n')}
            onChange={(e) => setDraft({ ...draft, items: e.target.value.split('\n') })}
          />
        </Field>
        {area('동의 목적', 'purpose_text')}
        {area('보유·이용 기간', 'retention_text', 2)}
        {area('동의 거부권과 불이익', 'refusal_text')}
        {copy.recipient && <DataRows rows={[['제공받는 자', copy.recipient]]} />}
        {err && <ErrorText>{err}</ErrorText>}
        <FormActions>
          <Button disabled={saving} onClick={() => dialog.current?.close()}>
            닫기
          </Button>
          <Button variant="primary" disabled={saving || !ready} onClick={() => setAsking(true)}>
            저장
          </Button>
        </FormActions>
      </div>
      <Confirm
        open={asking}
        title={`${copy.label} 문안 저장`}
        lines={[
          '저장하면 새 판, 모든 당사자의 이 항목 동의가 `확인 필요` 로 변경',
          '실사용 중이면 이메일 등 정해진 방식으로 고지 후 재동의 필요',
          '다시 받기 전까지 이 항목이 필요한 기능 잠김',
        ]}
        confirmLabel="저장"
        onConfirm={() => void save()}
        onCancel={() => setAsking(false)}
      />
    </dialog>
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
  const staff = useLoad(() => listWorkers());
  const workers = staff.data ?? [];

  const href = auditCsvHref(
    { days, kind: kind === '전부' ? undefined : kind, actor: actor ? Number(actor) : undefined },
    withNames,
  );

  return (
    <>
      <Card
        title="열람 기록 내려받기"
        className="download-card"
        action={
          <span className="wire-card-action">
            <a className="wire-button" data-variant="primary" href={href}>
              <span className="wire-button-text">CSV 내려받기</span>
            </a>
          </span>
        }
      >
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
      </Card>
      {/* 경고는 카드 **밖 아래** 코랄 한 줄이다(2026-09-18 L4). 카드 안에 넣으면 입력 칸 사이에 묻힌다. */}
      <p className="wire-note" data-tone="warn">
        내려받기도 열람 기록에 남음, 이름 포함 파일은 기관 밖 반출 금지
      </p>
    </>
  );
}

/**
 * 외부 서비스 연결(2026-09-17 Q, 이름은 2026-09-18 QA). 아코디언 셋 — AI 정리·녹음 글로 옮기기·데이터베이스. 접힌 줄에 상태·제공자·출처가 한 줄로 서고,
 * 펼치면 설정 자리다: 셋 다 `설정 가이드` 알약(누르면 팝업), AI 는 그 아래 키 넣기.
 * OpenAI 키는 서버가 검증한 뒤 암호문으로 저장하고 값은 다시 보여 주지 않는다 — 저장돼 있으면 `••••••••` 로만 말한다.
 * 마법사의 5단계와 설정이 같은 화면이다.
 */
export function ConnectionsPane() {
  const { data: c, setData: setC, error, reload } = useLoad(getConnections);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (error) {
    return (
      <Card title="API 연결 관리">
        <LoadError error={error} onRetry={reload} />
      </Card>
    );
  }
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
  /**
   * 설정 가이드 — 설치 순서와 안내(무엇을 어디서, AI(이 도구)가 어디까지 돕는지). 아코디언 안에서는 `설정 가이드`
   * 알약 하나이고 누르면 팝업이다(2026-09-18 온보딩 후속 2) — 본문에 펼쳐 두면 키 칸이 안내문 아래로 밀렸다.
   */
  const guide = (id: string, title: string, steps: Array<[string, ReactNode]>) => (
    // 카드 본문이 grid 라 알약이 폭을 다 차지한다 — flex 한 겹으로 제 크기를 지킨다.
    <div className="connection-guide-row">
      <Dialog id={`guide-${id}`} title={`${title} 설정 가이드`} trigger="설정 가이드" className="connection-guide-dialog">
        <ol className="connection-guide">
          {steps.map(([label, body]) => (
            <li key={label}>
              <strong>{label}</strong>
              <span>{body}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    </div>
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
          {guide('ai', 'AI 정리', [
            ['키 발급', <>{ext('https://platform.openai.com/api-keys', 'OpenAI API keys')} → Create new secret key → 복사(한 번만 표시)</>],
            ['결제', <>{ext('https://platform.openai.com/settings/organization/billing', 'Billing')} 카드 등록 — 미등록이면 호출 거절</>],
            ['여기 입력', 'AI 정리 칸의 OpenAI API 키에 붙여 넣고 저장 — 서버가 OpenAI 확인 후 암호문 저장'],
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
                  {busy ? '확인 중' : '저장'}
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
          {guide('stt', '녹음 글로 옮기기', [
            ['리소스 만들기', <>{ext('https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices', 'Azure Speech 리소스 만들기')} — 리전 Korea Central, 요금제 S0</>],
            ['키·리전 확인', 'Azure 포털 › 리소스 › Keys and Endpoint 에서 KEY 1 과 Location/Region'],
            ['서버에 넣기', <>기관 서버 <code>.env</code> 의 <code>AZURE_SPEECH_KEY</code>·<code>AZURE_SPEECH_REGION</code> 입력 후 앱 재시작(<code>docs/deploy.md</code>)</>],
            ['AI가 돕는 범위', '연결 상태 확인·전사 실패 이유 안내 — Azure 가입·결제·리소스 생성·서버 파일 수정은 사람'],
          ])}
        </Fold>
        <Fold title="3. 데이터베이스" group="connections" desc={row(c.db.connected, `Postgres · 서버 ${c.db.env}`)}>
          {guide('db', '데이터베이스', [
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
  const { data: rows, error, reload } = useLoad(listRequests, [me.id]);
  return (
    <Card
      title="내가 올린 배정 요청"
    >
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : rows === null ? (
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
