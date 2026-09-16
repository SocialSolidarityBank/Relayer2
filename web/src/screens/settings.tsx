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
import { useEffect, useState } from 'react';
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
  listPrograms,
  listRequests,
  listWorkers,
  auditCsvHref,
  retireProgram,
  revokeInvite,
  saveOrg,
  saveProfile,
  workerCases,
  type Connections,
  type ConsentCopy,
  type Invite,
  type Org,
  type Profile,
  type Program,
  type RequestRow,
  type AuditKind,
  type Worker,
  type WorkerCase,
} from '../api.ts';
import {
  Badge,
  Button,
  Card,
  DataRows,
  Empty,
  ErrorText,
  Field,
  FormActions,
  Item,
  PageHeader,
  Select,
} from '../ui.tsx';
import { setTheme, themeChoice, type ThemeChoice } from '../theme.ts';
import { AUDIT_DAYS, AUDIT_KIND_TABS, AuditScreen } from './audit.tsx';

const date = (s: string) => new Date(s).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

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
      { key: 'profile', label: '내 정보', desc: '이름·연락처·이메일을 고쳐요.', admin: false },
      { key: 'theme', label: '화면 테마', desc: '밝게·어둡게·기기 설정 따라.', admin: false },
      { key: 'leave', label: '계정 삭제하기', desc: '로그인을 막아요. 남긴 기록은 그대로 있어요.', admin: false },
    ],
  },
  {
    key: 'staff',
    title: '실무자 관리',
    items: [
      { key: 'assign', label: '담당 배정하기', desc: '올라온 요청을 확정하고, 담당이 바뀔 때 넘겨요.', admin: true },
      { key: 'invite', label: '실무자 초대하기', desc: '초대 링크를 만들어 건네요. 7일 뒤 만료돼요.', admin: true },
      { key: 'workers', label: '실무자 목록', desc: '누가 있고 누구를 맡고 있는지 봐요.', admin: true },
      { key: 'request', label: '담당 배정 요청하기', desc: '내가 맡겠다고 올린 당사자를 봐요.', admin: false },
    ],
  },
  {
    key: 'org',
    title: '기관 정보 관리',
    items: [
      { key: 'org-info', label: '기관 정보', desc: '기관 이름·번호·주소·전화.', admin: true },
      { key: 'programs', label: '사업 목록', desc: '당사자를 등록할 때 고르는 사업이에요.', admin: true },
    ],
  },
  {
    key: 'system',
    title: '시스템',
    // 시스템만 **한 계층 더 들어간다**(2026-09-16 Q). 안의 화면들이 각자 크고
    // 서로 상관이 없어, 한 페이지에 쌓으면 무엇을 보러 왔는지 잃는다.
    nested: true,
    items: [
      { key: 'connections', label: 'API 연결 관리', desc: 'AI·전사·데이터베이스가 붙어 있는지.', admin: true },
      { key: 'audit', label: '열람 기록 관리', desc: '누가 언제 무엇을 열었는지 찾아봐요.', admin: true },
      { key: 'consent', label: '동의서 관리', desc: '지금 쓰는 동의 문안.', admin: true },
      { key: 'download', label: '자료 다운로드', desc: '기간·실무자·종류를 정해 CSV 로 받아요.', admin: true },
    ],
  },
] as const;

export type SettingsItem = { key: string; label: string; desc: string; admin: boolean };
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
  SETTINGS_GROUP_LIST.map((g) => ({ ...g, items: g.items.filter((i) => !i.admin || isAdmin) })).filter(
    (g) => g.items.length > 0,
  );

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
      return <AssignPane />;
    case 'invite':
      return <InvitePane />;
    case 'workers':
      return <WorkersPane />;
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
        <Card title="관리자만 볼 수 있어요">
          <Empty>이 설정은 기관 관리자가 다뤄요. 필요하면 관리자에게 말씀해 주세요.</Empty>
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
        <Card title="무엇을 볼까요">
          {g.items.map((i) => (
            <div className="wire-repeat-card" key={i.key}>
              <Item
                title={i.label}
                desc={i.desc}
                action={<Button onClick={() => (window.location.hash = `#/settings/${i.key}`)}>열기</Button>}
              />
            </div>
          ))}
        </Card>
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
  if (!p) return <Empty>불러오는 중이에요.</Empty>;

  const save = async () => {
    setErr(null);
    try {
      setP(await saveProfile({ name: p.name, phone: p.phone, contact_email: p.contact_email }));
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했어요.');
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
        {saved && !err && <span className="wire-hint">저장했어요.</span>}
        <Button variant="primary" onClick={() => void save()}>
          저장하기
        </Button>
      </FormActions>
    </Card>
  );
}

const THEMES: ReadonlyArray<[ThemeChoice, string, string]> = [
  ['light', '밝게', '흰 바탕. 밝은 사무실에서 읽기 좋아요.'],
  ['dark', '어둡게', '어두운 바탕. 밤이나 조명이 낮은 곳에서 눈이 덜 부셔요.'],
  ['system', '기기 설정 따라', '기기가 밤에 어두워지면 같이 어두워져요.'],
];

function ThemePane() {
  const [t, setT] = useState<ThemeChoice>(themeChoice());
  return (
    <Card title="화면 테마">
      {THEMES.map(([key, label, desc]) => (
        <div className="wire-repeat-card" key={key}>
          <Item
            title={label}
            desc={desc}
            action={
              <Button
                variant={t === key ? 'primary' : 'secondary'}
                onClick={() => {
                  setTheme(key);
                  setT(key);
                }}
              >
                {t === key ? '쓰는 중' : '고르기'}
              </Button>
            }
          />
        </div>
      ))}
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
      setErr(e instanceof Error ? e.message : '나가지 못했어요.');
    }
  };
  return (
    <Card
      title="계정 삭제하기"
    >
      <Field label="확인" htmlFor="leave-c" hint="`나가기` 라고 적어 주세요.">
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

function AssignPane() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [who, setWho] = useState<number | null>(null);
  const [cases, setCases] = useState<WorkerCase[]>([]);
  const [moveTo, setMoveTo] = useState<Record<number, string>>({});

  const reload = async () => {
    setWorkers(await listWorkers());
    setReqs(await listRequests());
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (who) void workerCases(who).then(setCases);
    else setCases([]);
  }, [who]);

  const live = (workers ?? []).filter((w) => !w.deactivated_at);
  const pending = reqs.filter((r) => !r.decided_at);

  return (
    <>
      <Card title="올라온 배정 요청">
        {pending.length === 0 ? (
          <Empty>대기 중인 요청이 없어요.</Empty>
        ) : (
          pending.map((r) => (
            <div className="wire-repeat-card" key={r.id}>
              <Item
                title={`${r.pseudonym} · ${r.program_name}`}
                desc={`${r.requester} · ${date(r.created_at)}${r.reason ? ` · ${r.reason}` : ''}`}
                action={
                  <>
                    <Button
                      variant="primary"
                      onClick={() => void decideRequest(r.id, 'approved').then(reload)}
                    >
                      배정하기
                    </Button>
                    <Button onClick={() => void decideRequest(r.id, 'rejected').then(reload)}>거절</Button>
                  </>
                }
              />
            </div>
          ))
        )}
      </Card>

      <Card title="담당이 바뀔 때">
        <Field label="실무자" htmlFor="as-who" control="select">
          <select id="as-who" value={who ?? ''} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)}>
            <option value="">고르기</option>
            {live.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · 맡은 당사자 {w.open_cases}명
              </option>
            ))}
          </select>
        </Field>
        {who !== null &&
          (cases.length === 0 ? (
            <Empty>맡고 있는 당사자가 없어요.</Empty>
          ) : (
            cases.map((c) => (
              <div className="wire-repeat-card" key={c.id}>
                <Item
                  title={`${c.pseudonym} · ${c.program_name}`}
                  desc={c.status === 'open' ? '진행 중' : '종결'}
                  action={
                    <>
                      <Select
                        aria-label="넘길 실무자"
                        value={moveTo[c.id] ?? ''}
                        onChange={(v) => setMoveTo({ ...moveTo, [c.id]: v })}
                      >
                        <option value="">넘길 실무자</option>
                        {live
                          .filter((w) => w.id !== who)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                      </Select>
                      <Button
                        variant="primary"
                        disabled={!moveTo[c.id]}
                        onClick={() =>
                          void assignCase(c.id, Number(moveTo[c.id]))
                            .then(() => workerCases(who))
                            .then(setCases)
                            .then(reload)
                        }
                      >
                        넘기기
                      </Button>
                    </>
                  }
                />
              </div>
            ))
          ))}
      </Card>
    </>
  );
}

function InvitePane() {
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
        title="초대 링크 만들기"
      >
        <Field label="역할" htmlFor="iv-role" control="select">
          <select id="iv-role" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'admin')}>
            <option value="worker">실무자</option>
            <option value="admin">관리자</option>
          </select>
        </Field>
        <Field label="메모" htmlFor="iv-note">
          <input id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormActions>
          <Button variant="primary" onClick={() => void make()}>
            링크 만들기
          </Button>
        </FormActions>
        {link && (
          <div className="wire-repeat-card">
            <p className="wire-hint">
              <strong>지금 한 번만 보여요.</strong> 창을 닫으면 다시 볼 수 없어요.
            </p>
            <code style={{ wordBreak: 'break-all' }}>{link}</code>
            <FormActions>
              <Button onClick={() => void navigator.clipboard.writeText(link)}>복사하기</Button>
            </FormActions>
          </div>
        )}
      </Card>

      <Card title="보낸 초대">
        {rows === null ? (
          <Empty>불러오는 중이에요.</Empty>
        ) : rows.length === 0 ? (
          <Empty>보낸 초대가 없어요.</Empty>
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
                  title={`${v.role === 'admin' ? '관리자' : '실무자'}${v.note ? ` · ${v.note}` : ''}`}
                  desc={`${date(v.created_at)} 만듦 · ${date(v.expires_at)}까지 · ${state}`}
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

function WorkersPane() {
  const [rows, setRows] = useState<Worker[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [cases, setCases] = useState<WorkerCase[]>([]);
  useEffect(() => {
    void listWorkers().then(setRows);
  }, []);
  useEffect(() => {
    if (open) void workerCases(open).then(setCases);
  }, [open]);

  return (
    <Card title="실무자 목록">
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        rows.map((w) => (
          <div className="wire-repeat-card" key={w.id}>
            <Item
              title={
                <>
                  {w.name} {w.role === 'admin' && <Badge tone="lavender">관리자</Badge>}
                  {w.deactivated_at && <Badge>나감</Badge>}
                </>
              }
              desc={`${w.email} · 맡은 당사자 ${w.open_cases}명`}
              action={
                <Button onClick={() => setOpen(open === w.id ? null : w.id)}>
                  {open === w.id ? '접기' : '당사자 보기'}
                </Button>
              }
            />
            {open === w.id &&
              (cases.length === 0 ? (
                <Empty>맡고 있는 당사자가 없어요.</Empty>
              ) : (
                <DataRows
                  rows={cases.map((c) => [
                    c.pseudonym,
                    `${c.program_name} · ${c.status === 'open' ? '진행 중' : '종결'}`,
                  ])}
                />
              ))}
          </div>
        ))
      )}
    </Card>
  );
}

function OrgPane() {
  const [org, setOrg] = useState<Org | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getOrg().then(setOrg);
  }, []);
  if (!org) return <Empty>불러오는 중이에요.</Empty>;

  return (
    <Card title="기관 정보">
      <Field label="기관 이름" htmlFor="og-name">
        <input id="og-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
      </Field>
      <Field label="사업자·고유번호" htmlFor="og-reg">
        <input id="og-reg" value={org.reg_no ?? ''} onChange={(e) => setOrg({ ...org, reg_no: e.target.value })} />
      </Field>
      <Field label="주소" htmlFor="og-addr">
        <input id="og-addr" value={org.address ?? ''} onChange={(e) => setOrg({ ...org, address: e.target.value })} />
      </Field>
      <Field label="대표 전화" htmlFor="og-tel">
        <input id="og-tel" value={org.phone ?? ''} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
      </Field>
      <FormActions>
        {saved && <span className="wire-hint">저장했어요.</span>}
        <Button variant="primary" onClick={() => void saveOrg(org).then(setOrg).then(() => setSaved(true))}>
          저장하기
        </Button>
      </FormActions>
    </Card>
  );
}

/** 사업 목록. 기관 정보와 갈라 두었다(2026-09-16 Q 2차) — 고치는 빈도도 주인도 다르다. */
function ProgramsPane() {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    void listPrograms(true).then(setPrograms);
  }, []);

  return (
    <Card
      title="사업 목록"
    >
      {programs === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        programs.map((p) => (
          <div className="wire-repeat-card" key={p.id}>
            <Item
              title={
                <>
                  {p.name} {p.retired_at && <Badge>내림</Badge>}
                </>
              }
              desc={`당사자 ${p.cases}명`}
              action={
                p.retired_at ? (
                  <Button onClick={() => void addProgram(p.name).then(setPrograms)}>다시 쓰기</Button>
                ) : (
                  <Button onClick={() => void retireProgram(p.id).then(setPrograms)}>내리기</Button>
                )
              }
            />
          </div>
        ))
      )}
      <Field label="새 사업 이름" htmlFor="pg-new">
        <input id="pg-new" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <FormActions>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={() =>
            void addProgram(name.trim())
              .then(setPrograms)
              .then(() => setName(''))
          }
        >
          사업 추가하기
        </Button>
      </FormActions>
    </Card>
  );
}

/**
 * 동의서 관리 — 문안은 코드에 박혀 있다(`api/src/consent.ts`).
 *
 * **문안을 화면에서 고치게 하지 않는다.** 동의는 문안 해시에 묶여 있어, 글자 하나가 바뀌면
 * 이미 받은 동의가 전부 `확인 필요`로 떨어진다. 그 일이 실수로 일어나서는 안 된다.
 * 여기서는 지금 쓰는 문안이 무엇인지 보여 준다.
 */
function ConsentPane() {
  const [rows, setRows] = useState<ConsentCopy[] | null>(null);
  useEffect(() => {
    void getConsentCopy().then(setRows);
  }, []);
  return (
    <Card
      title="동의서 관리"
    >
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : rows.length === 0 ? (
        <Empty>문안을 불러오지 못했어요.</Empty>
      ) : (
        rows.map((r) => (
          <div className="wire-repeat-card" key={r.domain}>
            <Item title={r.label} desc={`${r.body} · 문안 지문 ${r.hash}`} />
          </div>
        ))
      )}
    </Card>
  );
}

/**
 * 자료 다운로드(2026-09-16 Q). 화면에서 찾는 것과 파일로 받는 것을 갈랐다 —
 * 찾기는 한 건을 짚는 일이고, 받기는 기간 전체를 통째로 옮기는 일이라 고를 것이 다르다.
 *
 * **이름을 실을지 여기서 고르고, 그 선택이 열람 기록에 남는다.** 실명이 든 파일은
 * 기관 밖으로 나가는 순간 우리 보유기간도 삭제 장치도 닿지 않는다.
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
    {
      days,
      kind: kind === '전부' ? undefined : kind,
      actor: actor ? Number(actor) : undefined,
    },
    withNames,
  );

  return (
    <Card
      title="열람 기록 내려받기"
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

      <Field
        label="당사자 표기"
        htmlFor="dl-names"
        control="select"
      >
        <select
          id="dl-names"
          value={withNames ? 'name' : 'pseudonym'}
          onChange={(e) => setWithNames(e.target.value === 'name')}
        >
          <option value="pseudonym">가명만 — 외부 제출용</option>
          <option value="name">이름 포함 — 기관 안에서만</option>
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

function ConnectionsPane() {
  const [c, setC] = useState<Connections | null>(null);
  useEffect(() => {
    void getConnections().then(setC);
  }, []);
  if (!c) return <Empty>불러오는 중이에요.</Empty>;

  const row = (title: string, ok: boolean, desc: string, env: string) => (
    <div className="wire-repeat-card">
      <Item
        title={
          <>
            {title} {ok ? <Badge tone="mint">붙어 있어요</Badge> : <Badge>안 붙었어요</Badge>}
          </>
        }
        desc={`${desc} · 기관 서버의 ${env} 로 넣어요`}
      />
    </div>
  );

  return (
    <Card
      title="API 연결 관리"
    >
      {row('AI 연결', c.ai.connected, `${c.ai.provider} · ${c.ai.model}`, c.ai.env)}
      {row('STT 연결', c.stt.connected, `${c.stt.provider}${c.stt.region ? ` · ${c.stt.region}` : ''}`, c.stt.env)}
      {row('데이터베이스 연결', c.db.connected, `방금 확인함 · ${new Date(c.db.checked_at).toLocaleString('ko-KR')}`, c.db.env)}
    </Card>
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
        <Empty>불러오는 중이에요.</Empty>
      ) : rows.length === 0 ? (
        <Empty>올린 요청이 없어요.</Empty>
      ) : (
        rows.map((r) => (
          <div className="wire-repeat-card" key={r.id}>
            <Item
              title={`${r.pseudonym} · ${r.program_name}`}
              desc={`${date(r.created_at)} 올림${r.reason ? ` · ${r.reason}` : ''}`}
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
