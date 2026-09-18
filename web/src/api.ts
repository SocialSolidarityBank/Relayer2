/** 과제 수행 주체(2026-09-18). 서버 `CARD_OWNERS` 와 같다. */
export type CardOwner = 'participant' | 'worker';
export const OWNER_LABEL: Record<CardOwner, string> = { participant: '당사자', worker: '담당 실무자' };

export type BriefingItem = {
  card_id: number;
  text: string;
  source_session_seq: number;
  last_result: string | null;
  owner: CardOwner;
  closed_session_seq?: number;
  last_follow?: string | null;
};

export type Briefing = {
  case_id: number;
  risk_signals: { items: BriefingItem[]; status: { state: string; reason: string | null } };
  participant_card: {
    pseudonym: string;
    name: string | null;
    program_name: string;
    session_seq: number | null;
    sessions_planned: number | null;
    scheduled_at: string | null;
    method: string | null;
  };
  goals: { overall: string | null; today: { text: string; from_session_seq: number | null } | null } | null;
  last_session_summary: {
    session_seq: number | null;
    line: string | null;
    summary: string | null;
    changes: string[];
    summary_state: 'none' | 'approved';
  };
  today_questions: BriefingItem[] | null;
  open_tasks: { items: BriefingItem[]; unchecked_carried_over: number } | null;
  closed_tasks: BriefingItem[];
  closed_questions: BriefingItem[];
};

export type CaseView = {
  case: { id: number; program_name: string; overall_goal: string | null };
  pseudonym: string;
  sessions: Array<{
    id: number;
    seq: number;
    status: string;
    method: string | null;
    place: string | null;
    scheduled_at: string | null;
    /** 예정 회차에 적어 둔 메모. 일정 예약 화면이 그 회차를 다시 보여 줄 때 쓴다. */
    plan_memo: string | null;
    is_closing: boolean;
  }>;
};

/** 401 은 로그인 만료다. 화면이 각자 처리하지 않고 한 곳에서 구분한다. */
export class Unauthorized extends Error {}
/** 403 은 열람 권한 없음이다. 원본 팝업처럼 그 자리에서 말해야 하는 화면이 구분한다. */
export class Forbidden extends Error {}

/** 개발은 vite 프록시(`/api`), 배포는 한 프로세스라 같은 출처 그대로다. */
const BASE = import.meta.env.DEV ? '/api' : '';

/**
 * 부르다 실패한 사실을 셸에 알린다(2026-09-16 검수).
 *
 * 화면 스무 곳이 `void getX().then(setX)` 꼴이라 실패하면 `setX` 가 안 불리고
 * **`불러오는 중이에요` 에서 영원히 멈춘다.** 화면마다 catch 를 다는 것이 정석이지만,
 * 그 전에 **무엇이 잘못됐는지 사람이 알 수 있어야 한다** — 멈춘 화면은 고장과 구별되지 않는다.
 *
 * 로그인 만료(401)는 여기서 알리지 않는다. 그건 셸이 로그인 화면으로 바꿔 답한다.
 */
export const API_FAILED = 'relayer:api-failed';

const announce = (message: string): void => {
  window.dispatchEvent(new CustomEvent(API_FAILED, { detail: message }));
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      // 부르는 쪽이 정한 형식을 이긴 적이 있었다(2026-09-16 검수) — 문서 올리기가
      // `content-type: application/pdf` 를 주는데 여기서 JSON 으로 덮어써 **업로드가 전부 막혔다.**
      // 형식을 안 주면 그때만 JSON 으로 본다.
      headers: init?.headers ?? (init?.body ? { 'content-type': 'application/json' } : undefined),
    });
  } catch {
    // 네트워크가 끊겼거나 서버가 죽었다. 둘 다 사람이 할 일은 같다 — 잠시 뒤 다시.
    announce('서버 연결 실패, 잠시 뒤 다시 시도');
    throw new Error('서버 연결 실패');
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error;
    // 401 의 사연은 서버가 안다(만료인지, 당사자 계정인지). 화면이 문구를 지어내지 않는다.
    if (res.status === 401) throw new Unauthorized(message ?? '로그인 필요');
    // **화면이 알아들을 수 있는 거절은 배너를 띄우지 않는다.** 동의가 없어 막힌 것(409)이나
    // 잘못 적은 것(400)은 그 자리에서 무엇을 해야 하는지 말해 주고, 배너가 같은 말을 또 하면
    // 한 사실이 두 번 보인다. 배너는 **까닭을 화면이 모르는 실패**만 맡는다.
    if (res.status >= 500 || res.status === 403 || res.status === 404) {
      announce(message ?? `요청 실패 (${res.status})`);
    }
    if (res.status === 403) throw new Forbidden(message ?? '열람 권한 없음');
    throw new Error(message ?? `${res.status}`);
  }
  return (await res.json()) as T;
}

/** 기관 워크스페이스 — 기관 이름이 적히면 생긴다. `public_address` 는 읽기 전용 접속 주소(배포 설정), 없으면 null → 행 숨김. */
export type Workspace = { name: string; slug: string | null; public_address: string | null };
/**
 * `workspace` 가 없거나 `onboarded` 가 거짓이면 관리자는 마법사(#/onboarding)에, 실무자는 기관 준비 중(#/setup-pending)에
 * 머문다. 서버 잠금은 없다 — 안내용 리다이렉트다. `onboarding_step` 은 마법사가 마지막으로 서 있던 단계(0~4)다 — 재진입 자리.
 */
export type Me = {
  id: number;
  name: string;
  role: 'worker' | 'admin';
  onboarded: boolean;
  onboarding_step: number;
  workspace: Workspace | null;
};

export const getMe = () => json<Me>('/me');
export const login = (email: string, password: string) =>
  json<Me>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const logout = () => json<{ ok: true }>('/auth/logout', { method: 'POST' });

/** 담당 한 사람. 사례마다 여럿일 수 있다(2026-09-16 다중 담당). */
export type Assignee = { id: number; name: string };

export type ParticipantRow = {
  case_id: number;
  /** 배정되지 않은 사례는 null 로 비워 온다. */
  participant_id: number | null;
  pseudonym: string;
  /** 배정된 사람에게만 온다. 아니면 null — 가명만 보인다. */
  name: string | null;
  program_id: number;
  program_name: string;
  status: 'open' | 'closed';
  assignees: Assignee[];
  /** 거짓이면 이름·회차·일정은 null 로 비워 온다. */
  can_access: boolean;
  last_session_seq: number | null;
  next_scheduled_at: string | null;
};

export type ScheduleRow = {
  session_id: number;
  case_id: number;
  seq: number;
  scheduled_at: string;
  method: string | null;
  place: string | null;
  plan_memo: string | null;
  pseudonym: string;
  name: string | null;
  program_name: string;
  open_tasks: number;
  open_questions: number;
};

export type SessionStale = { ai_summary: boolean; mismatch: boolean };

export type SessionTranscriptState = 'none' | 'pending' | 'draft' | 'approved' | 'failed' | 'skipped';

export type CaseDetail = {
  case: {
    id: number;
    participant_id: number;
    program_id: number;
    program_name: string;
    status: 'open' | 'closed';
    overall_goal: string | null;
    sessions_planned: number | null;
  };
  pseudonym: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  sessions: Array<{
    id: number;
    seq: number;
    kind: string;
    status: string;
    held_at: string | null;
    scheduled_at: string | null;
    line: string;
    memo: string | null;
    today_goal_text: string | null;
  ai_summary: SessionAiSummary | null;
    /** 수기가 있는가. 녹음만 하고 아직 안 적은 회차는 false — 화면이 '수기 미작성'을 그린다. */
    written: boolean;
    /** 녹음·전사 상태. 여러 녹음이면 가장 최근 녹음 기준. */
    voice: { recordings: number; transcript: SessionTranscriptState };
    /** 소요 분(L5 D4). 없으면 null. */
    duration_min: number | null;
    /** 원본(수기·전사)을 고친 뒤 AI 요약·불일치가 옛것이 됐는가(L5 D3). 자동 재처리는 없다. */
    stale: SessionStale;
  }>;
  goal_revisions: Array<{ text: string | null; created_at: string }>;
  pending_next_goal: { session_id: number; session_seq: number; text: string | null } | null;
  open_cards: Array<{ id: number; kind: string; text: string; owner: CardOwner; source_session_seq?: number | null }>;
  closure: {
    closed_at: string;
    close_reason: string;
    unfinished_note: string | null;
    last_session_seq: number | null;
  } | null;
};

export const getCaseDetail = (caseId: number) => json<CaseDetail>(`/cases/${caseId}/detail`);

export const closeCase = (caseId: number, body: { close_reason: string; unfinished_note?: string | null }) =>
  json<{ case_id: number; closed_at: string }>(`/cases/${caseId}/close`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const listParticipants = () => json<ParticipantRow[]>('/participants');
export const listSchedules = (from: string, to: string) =>
  json<ScheduleRow[]>(`/schedules?${new URLSearchParams({ from, to })}`);

export const getBriefing = (caseId: number, seq?: number) =>
  json<Briefing>(`/cases/${caseId}/briefing${seq ? `?seq=${seq}` : ''}`);
export const getCase = (caseId: number) => json<CaseView>(`/cases/${caseId}`);
export const updateOverallGoal = (caseId: number, overallGoal: string | null) =>
  json<{ ok: true }>(`/cases/${caseId}/goal`, { method: 'PATCH', body: JSON.stringify({ overall_goal: overallGoal }) });
/** 다음 상담 목표를 줄 배열로(L5 D5). 대상은 `pending_next_goal` 의 회차이고 서버가 '\n' 으로 잇는다. */
export const updateNextGoalLines = (caseId: number, lines: string[]) =>
  json<{ ok: true; session_id: number }>(`/cases/${caseId}/next-goals`, {
    method: 'PATCH',
    body: JSON.stringify({ lines }),
  });
export const updateNextGoal = (sessionId: number, nextGoalText: string | null) =>
  json<{ ok: true }>(`/sessions/${sessionId}/next-goal`, {
    method: 'PATCH',
    body: JSON.stringify({ next_goal_text: nextGoalText }),
  });

export type OutcomeInput = {
  card_id: number;
  result: 'done' | 'in_progress' | 'not_done' | 'confirmed';
  follow?: 'continue' | 'stop';
  reason?: string;
};

export type RecordInput = {
  held_at?: string;
  is_closing?: boolean;
  memo: string;
  method?: ConsultationMethod;
  place?: string | null;
  /** 소요 시간(분). L5 계약 `sessions.duration_min`(2026-09-18 D4) — 서버가 받기 전에는 무시된다. */
  duration_min?: number | null;
  next_goal_text?: string | null;
  overall_goal?: string | null;
  cards?: Array<{ kind: string; text: string; section: string; area?: string; owner?: CardOwner }>;
  outcomes?: OutcomeInput[];
};

/**
 * 일곱 영역. 서버 `api/src/consent.ts` 와 같은 순서·같은 이름이다.
 * **문안은 여기 두지 않는다** — 화면이 문안을 복사해 두면 서버가 바뀌어도 옛 글로 동의를 받는다.
 * 문안은 `getConsentCopy()` 로 받아 쓴다(2026-09-16 검수).
 */
export const CONSENT_DOMAINS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'counseling_recording',
  'external_stt_processing',
  'external_llm_cross_border_processing',
  'voice_original_retention_period',
  'document_attachment',
] as const;
export type ConsentDomain = (typeof CONSENT_DOMAINS)[number];
export type ConsentDecision = 'grant' | 'withdraw' | 'decline';

export type ConsentView = Array<{
  domain: ConsentDomain;
  label: string;
  copy: string;
  status: 'granted' | 'not_granted' | 'unconfirmed';
  decided_at: string | null;
}>;

export type ParticipantView = {
  name: string | null;
  phone: string | null;
  email: string | null;
  schedule: Array<{ scheduled_at: string; method: string | null; place: string | null; program_name: string }>;
};

export const openAccess = (token: string, code: string) =>
  json<ParticipantView>('/access/open', { method: 'POST', body: JSON.stringify({ token, code }) });

export type AccessState = {
  active: boolean;
  expires_at: string | null;
  attempts_left: number | null;
  last_opened_at: string | null;
};

export const getAccess = (caseId: number) => json<AccessState>(`/cases/${caseId}/access`);
export const issueAccess = (caseId: number) =>
  json<{ token: string; code: string; expires_at: string }>(`/cases/${caseId}/access`, {
    method: 'POST',
  });
export const revokeAccess = (caseId: number) =>
  json<{ ok: true }>(`/cases/${caseId}/access`, { method: 'DELETE' });

export type AuditKind = '열람' | '기록' | '운영';

export type AuditRow = {
  id: number;
  at: string;
  action: string;
  kind: AuditKind;
  /** 사람 말로 쓴 사건 이름. 서버가 정한다 — 화면마다 다르게 부르지 않게. */
  label: string;
  fields: string[];
  actor_id: number | null;
  actor_name: string | null;
  by_participant: boolean;
  /** 맡은 사람이 아닌데 열었나. 세기만 한 값이다 — 판정이 아니다. */
  off_assignment: boolean;
  /** 누구의 것인가. 이름은 감사 표에 없고 볼 때 금고에서 꺼낸다. */
  subject: string | null;
  pseudonym: string | null;
  case_id: number | null;
  program_name: string | null;
};

export type AuditQuery = {
  days?: number;
  kind?: AuditKind;
  actor?: number;
  case?: number;
  only?: 'off_assignment' | 'download';
};

const auditParams = (q: AuditQuery): string => {
  const p = new URLSearchParams();
  if (q.days) p.set('days', String(q.days));
  if (q.kind) p.set('kind', q.kind);
  if (q.actor) p.set('actor', String(q.actor));
  if (q.case) p.set('case', String(q.case));
  if (q.only) p.set('only', q.only);
  return p.toString();
};

export const listAudit = (q: AuditQuery = {}) => json<AuditRow[]>(`/audit?${auditParams(q)}`);

export type AuditSummary = {
  days: number;
  total: number;
  by_kind: Array<{ kind: AuditKind; count: number }>;
  watch: Array<{ key: 'off_assignment' | 'download'; label: string; count: number }>;
};

export const auditSummary = (days: number) => json<AuditSummary>(`/audit/summary?days=${days}`);

/** 내려받기 주소. 이름을 실을지는 여기서 갈린다 — 그 선택이 감사에 남는다. */
export const auditCsvHref = (q: AuditQuery, withNames: boolean): string =>
  `${BASE}/audit/export?${auditParams(q)}${withNames ? '&names=1' : ''}`;

export type DocumentRow = {
  id: number;
  case_id: number;
  session_id: number | null;
  label: string;
  bytes: number;
  content_type: string;
  delete_after: string;
  deleted_at: string | null;
  created_at: string;
};

export const listDocuments = (caseId: number) => json<DocumentRow[]>(`/cases/${caseId}/documents`);

/** 파일은 본문 그대로 보낸다. 이름과 회차는 쿼리로 간다. */
export const uploadDocument = async (
  caseId: number,
  file: File,
  label: string,
  sessionId?: number,
): Promise<DocumentRow> => {
  const q = new URLSearchParams({ label });
  if (sessionId) q.set('session_id', String(sessionId));
  return json<DocumentRow>(`/cases/${caseId}/documents?${q}`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
};

/** 내려받기는 서버가 감사에 남긴다. 화면은 주소만 연다. */
export const documentHref = (id: number): string => `${BASE}/documents/${id}`;

export const getConsents = (caseId: number) => json<ConsentView>(`/cases/${caseId}/consents`);

export const recordConsent = (caseId: number, body: { domain: ConsentDomain; decision: ConsentDecision }) =>
  json<ConsentView>(`/cases/${caseId}/consents`, { method: 'POST', body: JSON.stringify(body) });

export type NewCaseInput = {
  consents?: Array<{ domain: ConsentDomain; decision: ConsentDecision }>;
  name: string;
  phone?: string;
  email?: string;
  program_id: number;
  sessions_planned?: number;
};

export type ConsultationMethod = 'in_person' | 'phone' | 'video' | 'visit' | 'other';

export type IntakeInput = {
  held_at?: string;
  method?: ConsultationMethod;
  place?: string | null;
  memo?: string;
  overall_goal?: string | null;
  detail?: Record<string, unknown>;
  cards?: Array<{ kind: string; text: string; section: string; owner?: CardOwner }>;
};

export type IntakeView = {
  session_id: number | null;
  held_at: string | null;
  method: ConsultationMethod | null;
  place: string | null;
  memo: string | null;
  detail: Record<string, unknown>;
  overall_goal: string | null;
  cards: Array<{ kind: string; text: string; owner: CardOwner; locked: boolean }>;
};

export const getIntake = (caseId: number) => json<IntakeView>(`/cases/${caseId}/intake`);

export const saveIntake = (caseId: number, body: IntakeInput) =>
  json<{ session_id: number }>(`/cases/${caseId}/intake`, { method: 'PUT', body: JSON.stringify(body) });

export const createCase = (body: NewCaseInput) =>
  json<{ case_id: number; participant_id: number; pseudonym: string }>('/cases', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export type NewSessionInput = {
  is_closing?: boolean;
  scheduled_at: string;
  method: ConsultationMethod;
  place?: string;
  plan_memo?: string;
  /**
   * 상담 소요 분(2026-09-18 Q 결정 D4 · UI 계획 §4 계약). 종료 시각은 화면이 분으로 바꿔 보낸다.
   * 서버가 `sessions.duration_min` 으로 받는다(L5).
   */
  duration_min?: number;
};

export const planSession = (caseId: number, body: NewSessionInput) =>
  json<{ session_id: number; seq: number }>(`/cases/${caseId}/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * 상담 시작(2026-09-16 Q). 수기 첫 입력이든 녹음 시작이든 그 순간 회차가 생긴다.
 * 예정 회차 id 를 주면 그 회차를 기록됨으로 바꾸고, 없으면 새 회차를 만든다. 내용은 나중에 채운다.
 */
export const startSession = (
  caseId: number,
  body: { session_id?: number; method?: ConsultationMethod; is_closing?: boolean } = {},
) =>
  json<{ session_id: number; seq: number }>(`/cases/${caseId}/sessions/start`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export type SessionRecord = {
  session_id: number;
  case_id: number;
  seq: number;
  status: string;
  kind: string;
  held_at: string | null;
  method: string | null;
  place: string | null;
  duration_min: number | null;
  stale: SessionStale;
  memo: string | null;
  next_goal_text: string | null;
  overall_goal: string | null;
  is_closing: boolean;
  cards: Array<{ kind: string; text: string; area: string | null; owner: CardOwner; locked: boolean }>;
  open_cards: Array<{
    card_id: number;
    kind: string;
    text: string;
    owner: CardOwner;
    source_session_seq: number | null;
    result: string | null;
    follow: string | null;
    reason: string | null;
  }>;
};

/** 회차 원본 리비전(L5 D3, append-only). 세 종류: 수기 메모 · 전사문 · AI 요약문. */
export type RevisionKind = 'memo' | 'transcript' | 'summary';
export type Revision = { id: number; kind: RevisionKind; text: string; actor: string | null; created_at: string };
export const listRevisions = (sessionId: number) => json<Revision[]>(`/sessions/${sessionId}/revisions`);
export const reviseSession = (sessionId: number, kind: RevisionKind, text: string) =>
  json<Revision>(`/sessions/${sessionId}/revisions`, { method: 'POST', body: JSON.stringify({ kind, text }) });

export const getSessionRecord = (sessionId: number) => json<SessionRecord>(`/sessions/${sessionId}`);

export const recordSession = (sessionId: number, body: RecordInput) =>
  json<{ session_id: number; unchecked: number }>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

// ── 설정하기(2026-09-16 Q) ────────────────────────────────────────────────

export type Profile = {
  id: number;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  contact_email: string | null;
};
export type Org = { name: string; reg_no: string | null; address: string | null; phone: string | null };
export type OrgView = Org & { slug: string | null; public_address: string | null; onboarded: boolean };
export type Program = {
  id: number;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
  retired_at: string | null;
  cases: number;
  open_cases: number;
};
export type ProgramInput = { name: string; starts_on: string | null; ends_on: string | null; description: string | null };
/** 종료를 막은 이유 — 열린 사례·예정 회차 수. 화면이 이 숫자를 보여 주고 확인을 받는다. */
export type RetireWarning = { open_cases: number; planned_sessions: number };
export type Worker = {
  id: number;
  name: string;
  email: string;
  role: string;
  deactivated_at: string | null;
  open_cases: number;
};
export type Invite = {
  id: number;
  role: string;
  note: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
export type RequestRow = {
  id: number;
  case_id: number;
  pseudonym: string;
  program_name: string;
  requester_id: number;
  requester: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  decision: string | null;
};
export type ConnectionSource = 'db' | 'env' | null;
export type Connections = {
  /** `source` 는 비밀이나 토글의 출처다. 원문 값은 오지 않는다. */
  ai: { connected: boolean; provider: string; model: string; env: string; source: ConnectionSource };
  stt: { connected: boolean; provider: 'azure'; region: 'koreacentral'; source: ConnectionSource };
  voice: { enabled: boolean; source: ConnectionSource };
  db: { connected: boolean; checked_at: string; env: string };
};

export const getProfile = () => json<Profile>('/settings/profile');
export const saveProfile = (body: { name: string; phone: string | null; contact_email: string | null }) =>
  json<Profile>('/settings/profile', { method: 'PATCH', body: JSON.stringify(body) });
export const deactivateMe = () => json<{ ok: true }>('/settings/deactivate', { method: 'POST' });

export const getOrg = () => json<OrgView>('/settings/org');
export const saveOrg = (body: Org) => json<OrgView>('/settings/org', { method: 'PUT', body: JSON.stringify(body) });

export const listPrograms = (all = false) => json<Program[]>(`/settings/programs${all ? '?all=1' : ''}`);
export const addProgram = (body: ProgramInput) =>
  json<Program>('/settings/programs', { method: 'POST', body: JSON.stringify(body) });
export const updateProgram = (id: number, body: Partial<ProgramInput>) =>
  json<Program>(`/settings/programs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
/**
 * 사업 종료. 열린 사례·예정 회차가 있으면 서버가 409 로 건수를 돌려준다 — 그때 `warning` 으로 온다.
 * `confirm` 으로 다시 부르면 종료한다.
 */
export const retireProgram = async (id: number, confirm = false): Promise<{ ok: true } | { warning: RetireWarning }> => {
  const res = await fetch(`${BASE}/settings/programs/${id}${confirm ? '?confirm=1' : ''}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (res.status === 409) return { warning: (await res.json()) as RetireWarning };
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
  return { ok: true };
};
export const reopenProgram = (id: number) => json<{ ok: true }>(`/settings/programs/${id}/reopen`, { method: 'POST' });

/** `programId` 를 주면 그 사업의 열린 사례를 맡은 실무자만. */
export const listWorkers = (programId?: number) =>
  json<Worker[]>(`/settings/workers${programId ? `?program=${programId}` : ''}`);
export const setWorkerRole = (id: number, role: 'worker' | 'admin') =>
  json<{ ok: true }>(`/settings/workers/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
export const completeOnboarding = () => json<{ ok: true }>('/settings/onboarding/complete', { method: 'POST' });
/** 마법사가 단계를 옮길 때 적는다. 실패해도 진행은 막지 않는다 — 재진입 자리가 한 단계 뒤일 뿐이다. */
export const saveOnboardingStep = (step: number) =>
  json<{ ok: true }>('/settings/onboarding/step', { method: 'PUT', body: JSON.stringify({ step }) });
/** 키 값은 보내기만 하고 되돌려받지 않는다. `null` 이면 지운다. */
export const setAiKey = (key: string | null) =>
  json<{ ok: true }>('/settings/ai-key', { method: 'PUT', body: JSON.stringify({ key }) });
export const setSttKey = (key: string | null) =>
  json<{ ok: true }>('/settings/stt-key', { method: 'PUT', body: JSON.stringify({ key }) });
export const setVoiceEnabled = (enabled: boolean) =>
  json<{ ok: true }>('/settings/voice', { method: 'PUT', body: JSON.stringify({ enabled }) });
export type WorkerCase = { id: number; pseudonym: string; program_name: string; status: string };
export const workerCases = (id: number) => json<WorkerCase[]>(`/settings/workers/${id}/cases`);
/** 배정 화면의 사례 목록. 가명·사업·담당 이름만 오고 임상 내용은 안 온다(관리자도 무권한). */
export type AssignmentCase = {
  id: number;
  pseudonym: string;
  program_name: string;
  status: string;
  assignees: Assignee[];
};
export const listAssignmentCases = () => json<AssignmentCase[]>('/settings/assignments');
/** `user_ids` 가 그 사례의 담당 전부다 — 빠진 사람은 거둬지고, 빈 배열은 모두 거둔다. */
export const assignCase = (case_id: number, user_ids: number[]) =>
  json<{ ok: true }>('/settings/assign', { method: 'POST', body: JSON.stringify({ case_id, user_ids }) });

export const listInvites = () => json<Invite[]>('/settings/invites');
export const createInvite = (role: 'worker' | 'admin', note: string | null) =>
  json<{ token: string; invite: Invite }>('/settings/invites', {
    method: 'POST',
    body: JSON.stringify({ role, note }),
  });
export const revokeInvite = (id: number) => json<Invite[]>(`/settings/invites/${id}`, { method: 'DELETE' });

export const listRequests = () => json<RequestRow[]>('/settings/requests');
export const decideRequest = (id: number, decision: 'approved' | 'rejected') =>
  json<{ ok: true }>(`/settings/requests/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });

export type ConsentCopy = {
  domain: ConsentDomain;
  label: string;
  body: string;
  items: string[];
  purpose_text: string;
  retention_text: string;
  refusal_text: string;
  /** 밖으로 나가는 영역만 채워진다. 누구에게 가는지가 동의의 본체다. */
  recipient: string | null;
  version: string;
  hash: string;
  /** 이것이 없으면 사례를 열 수 없다. */
  required: boolean;
  /** 관리자에게만 true(D6). 설정 › 동의서 관리의 `수정` 이 이것을 본다. */
  editable: boolean;
};
export const getConsentCopy = () => json<ConsentCopy[]>('/consent-copy');

export const getConnections = () => json<Connections>('/settings/connections');

export const peekInvite = (token: string) => json<{ role: string; org_name: string }>(`/auth/invite/${token}`);
export const signUpWithInvite = (
  token: string,
  body: { email: string; password: string; name: string },
) => json<{ ok: true }>(`/auth/invite/${token}`, { method: 'POST', body: JSON.stringify(body) });

/**
 * 첫 가입 문. 새 배포에서 한 번만 열리고 첫 관리자가 생기면 영구히 닫힌다 — 그 뒤는 초대 링크뿐이다.
 * 닫힌 문 앞의 사람에게 어느 기관인지 말해 주려고 워크스페이스 이름도 함께 온다.
 */
export const signupOpen = () => json<{ open: boolean; workspace: Workspace | null }>('/auth/signup');
/** 계정만 만든다. 기관 워크스페이스는 로그인 뒤 마법사 0단계다. */
export const signup = (body: { email: string; password: string; name: string }) =>
  json<{ ok: true }>('/auth/signup', { method: 'POST', body: JSON.stringify(body) });

// ── L4 설정 (UI 개편 2026-09-18, ui-plan §4 L5 계약, #54 착지) ─────────────────

/** J1. 한 실무자가 맡은 당사자 — 회차 = 기록된 회차 수, 다음 상담 = 첫 예정 회차. 남의 것을 보면 서버가 감사에 남긴다. */
export type WorkerCaseRow = { case_id: number; name: string | null; program: string; seq: number; next_at: string | null };
export const workerCaseRows = (id: number) => json<WorkerCaseRow[]>(`/users/${id}/cases`);

/** J3. 열린 사례만, 10건씩. `q` 는 가명·사업 이름에 건다(이름·연락처는 금고라 서버가 못 거른다). */
export type AssignCase = {
  case_id: number;
  name: string | null;
  /** 당사자 아이디 = 가명. */
  login: string;
  program: string;
  seq: number;
  phone: string | null;
  email: string | null;
  assignees: Assignee[];
};
export const ASSIGN_PAGE_SIZE = 10;
export const listAssignCases = (params: { q?: string; program?: number | null; page?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.program) qs.set('program', String(params.program));
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const s = qs.toString();
  return json<{ items: AssignCase[]; total: number; page: number; page_size: number }>(`/assign/cases${s ? `?${s}` : ''}`);
};

/** J3·D7. 전체 치환 — 빠진 사람은 거둬지고 빈 배열은 모두 거둔다. 감사 `assignment.set`. */
export const setAssignments = (caseId: number, user_ids: number[]) =>
  json<{ ok: true; assignees: Assignee[] }>(`/cases/${caseId}/assignments`, { method: 'PUT', body: JSON.stringify({ user_ids }) });

/** L3·D6. 저장하면 새 판 `consent-standard-form-v<N+1>` 이 되고 모든 지난 동의가 `확인 필요` 로 떨어진다. */
export type ConsentCopyInput = {
  copy: string;
  items: string[];
  purpose_text: string;
  retention_text: string;
  refusal_text: string;
};
export const putConsentCopy = (domain: ConsentDomain, body: ConsentCopyInput) =>
  json<ConsentCopy>(`/consent-copy/${domain}`, { method: 'PUT', body: JSON.stringify(body) });

// ─── v6 상담기록 분석 (2026-09-18 Q, 계약 정본 api/src/domain/record-analysis.ts) ───
// 서버 타입을 손으로 옮긴 사본이다(FactChange 와 같은 관례). 필드를 바꾸면 양쪽을 같이 고친다.
// span ID: 수기 `w:<doc>:<n>`(doc = memo | card:<id> | intake:<key>), 전사 `t:<transcriptId>:<n>`. 화면 번호가 아니다.

export type SourceKind = 'memo' | 'card:promise' | 'card:question' | 'card:judgment' | 'card:fact' | 'intake' | 'transcript';
export type SourceDocument = { id: string; kind: SourceKind; label: string; text: string; hash: string; order: number };
export type SourceSpan = {
  id: string;
  doc: string;
  start: number;
  end: number;
  order: number;
  offset_ms?: number | null;
  duration_ms?: number | null;
};
export const isTranscriptSpan = (id: string): boolean => id.startsWith('t:');

export type AnalysisStatusKind = 'change' | 'follow_up' | 'completed';
export type Annotation = { span: string; status: AnalysisStatusKind; before?: string[]; after?: string[] };
export type Paragraph = { id: string; title: string; spans: string[] };
export type Topic = { id: string; title: string; paragraph_ids: string[] };
export type StructuredRecord = { topics: Topic[]; paragraphs: Paragraph[]; annotations: Annotation[] };

export type GoalLink = 'overall' | 'session' | null;
export type SummaryItem = { text: string; spans: string[]; goal: GoalLink };
export type Dialogue = { worker?: string; participant?: string };
export type PromiseResultItem = {
  promise: string;
  result: string;
  promise_spans: string[];
  result_spans: string[];
  changes: Array<{ before: string; after: string; meaning?: string }>;
  conclusion?: string;
  goal: GoalLink;
};
export type NewlyRevealedItem = {
  dialogue?: Dialogue;
  mode: 'change' | 'confirmed';
  lines: string[];
  spans: string[];
  summary_only_exception: boolean;
  goal: GoalLink;
};
export type NewPossibilityItem = { dialogue?: Dialogue; lines: string[]; change_spans: string[]; plan_spans: string[]; goal: GoalLink };
export type SessionSummary = {
  core: SummaryItem[];
  changes: { promise_result: PromiseResultItem[]; newly_revealed: NewlyRevealedItem[]; new_possibility: NewPossibilityItem[] };
  follow_up: SummaryItem[];
  completed: SummaryItem[];
};
/** 하위 항목 의미 순서. 화면 번호 ①②③ 은 내용 있는 것만 세어 렌더 시 매긴다. */
export const CHANGE_SUBSECTIONS = ['promise_result', 'newly_revealed', 'new_possibility'] as const;
export const CHANGE_SUBSECTION_LABEL: Record<(typeof CHANGE_SUBSECTIONS)[number], string> = {
  promise_result: '약속 이행 여부',
  newly_revealed: '상담 중 새로 드러난 것',
  new_possibility: '이번 상담 후 새로운 가능성',
};

export type EvidenceLink = { transcript_span: string; written_spans: string[]; match: 'match' | 'uncertain' };
export type Discrepancy = {
  transcript_span: string;
  written_spans: string[];
  paragraph_id: string;
  difference: string;
  conditions: { same_subject: boolean; same_attribute: boolean; same_time: boolean; incompatible: boolean };
};
export type Keyword = { text: string; source: 'deterministic' | 'llm'; spans: string[] };

export type AnalysisStatus = 'draft' | 'approved' | 'failed';
export type SourceVersions = {
  memo_hash: string | null;
  cards: Array<{ id: number; hash: string }>;
  intake_hash: string | null;
  transcript_id: number | null;
};
export type SummaryOverride = { text: string; actor_id: number; at: string };
export type AnalysisBody = {
  schema_version: number;
  rule_version: string;
  documents: Array<Omit<SourceDocument, 'text'>>;
  spans: SourceSpan[];
  record: StructuredRecord;
  summary: SessionSummary;
  links: EvidenceLink[];
  discrepancies: Discrepancy[];
  keywords: Keyword[];
  tasks: string[];
  questions: string[];
  summary_override: SummaryOverride | null;
};
export type AnalysisRevision = {
  id: number;
  session_id: number;
  status: AnalysisStatus;
  schema_version: number;
  rule_version: string;
  source_versions: SourceVersions;
  model: string | null;
  mask_hits: Record<string, number>;
  body: AnalysisBody | null;
  error: string | null;
  created_by: number | null;
  approved_by: number | null;
  created_at: string;
};
export type ApproveBody = {
  draft_id: number;
  source_versions: SourceVersions;
  edits?: { summary?: SessionSummary; tasks?: string[]; questions?: string[] };
};
/** 회차 카드의 요약. v6 가 없고 구버전 승인만 있으면 legacy. `CaseDetail.sessions[].ai_summary` 가 이 타입이다. */
export type SessionAiSummary =
  | { kind: 'v6'; analysis_id: number; summary: SessionSummary; keywords: Keyword[]; override: SummaryOverride | null }
  | { kind: 'legacy'; summary: string };
export type AnalysisView = {
  session_id: number;
  analysis: AnalysisRevision | null;
  documents: SourceDocument[];
  spans: SourceSpan[];
  transcript: { id: number; status: 'draft' | 'approved'; recordings_without_transcript: number } | null;
  stale: boolean;
};
export type Backlink = { session_id: number; seq: number; span_id: string; paragraph_id: string | null; text: string };

export const getAnalysisDraft = async (sessionId: number): Promise<AnalysisRevision | 'none'> => {
  const found = await json<AnalysisRevision | { status: 'none' }>(`/sessions/${sessionId}/draft`);
  return found.status === 'none' ? 'none' : (found as AnalysisRevision);
};
export const makeAnalysisDraft = (sessionId: number) =>
  json<AnalysisRevision>(`/sessions/${sessionId}/draft`, { method: 'POST' });
export const approveAnalysis = (sessionId: number, body: ApproveBody) =>
  json<AnalysisRevision>(`/sessions/${sessionId}/draft/approve`, { method: 'POST', body: JSON.stringify(body) });
export const getAnalysis = (sessionId: number) => json<AnalysisView>(`/sessions/${sessionId}/analysis`);
export const getBacklinks = (caseId: number, keyword: string) =>
  json<Backlink[]>(`/cases/${caseId}/backlinks?keyword=${encodeURIComponent(keyword)}`);
