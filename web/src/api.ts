export type BriefingItem = {
  card_id: number;
  text: string;
  source_session_seq: number;
  last_result: string | null;
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
  last_session_summary: { session_seq: number | null; line: string | null; summary_state: string };
  today_questions: BriefingItem[] | null;
  open_tasks: { items: BriefingItem[]; unchecked_carried_over: number } | null;
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
    is_closing: boolean;
  }>;
};

/** 401 은 로그인 만료다. 화면이 각자 처리하지 않고 한 곳에서 구분한다. */
export class Unauthorized extends Error {}

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
    announce('서버에 닿지 못했어요. 잠시 뒤 다시 해 주세요.');
    throw new Error('서버에 닿지 못했어요.');
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error;
    // 401 의 사연은 서버가 안다(만료인지, 당사자 계정인지). 화면이 문구를 지어내지 않는다.
    if (res.status === 401) throw new Unauthorized(message ?? '로그인이 필요해요.');
    // **화면이 알아들을 수 있는 거절은 배너를 띄우지 않는다.** 동의가 없어 막힌 것(409)이나
    // 잘못 적은 것(400)은 그 자리에서 무엇을 해야 하는지 말해 주고, 배너가 같은 말을 또 하면
    // 한 사실이 두 번 보인다. 배너는 **까닭을 화면이 모르는 실패**만 맡는다.
    if (res.status >= 500 || res.status === 403 || res.status === 404) {
      announce(message ?? `요청이 실패했어요 (${res.status}).`);
    }
    throw new Error(message ?? `${res.status}`);
  }
  return (await res.json()) as T;
}

export type Me = { id: number; name: string; role: 'worker' | 'admin' };

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

export type CaseDetail = {
  case: {
    id: number;
    participant_id: number;
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
  }>;
  goal_revisions: Array<{ text: string | null; created_at: string }>;
  open_cards: Array<{ id: number; kind: string; text: string; source_session_seq?: number | null }>;
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
export const listSchedules = () => json<ScheduleRow[]>('/schedules');

export const getBriefing = (caseId: number, seq?: number) =>
  json<Briefing>(`/cases/${caseId}/briefing${seq ? `?seq=${seq}` : ''}`);
export const getCase = (caseId: number) => json<CaseView>(`/cases/${caseId}`);

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
  method?: 'in_person' | 'phone' | 'video' | 'visit';
  place?: string;
  next_goal_text?: string | null;
  overall_goal?: string | null;
  cards?: Array<{ kind: string; text: string; section: string; area?: string }>;
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

export type Draft = {
  id: number;
  session_id: number;
  status: 'draft' | 'approved';
  summary: string;
  changes: string[];
  tasks: string[];
  questions: string[];
  mask_hits: Record<string, number>;
  model: string | null;
  created_at: string;
};

export const getDraft = async (sessionId: number): Promise<Draft | 'none'> => {
  const found = await json<Draft | { status: 'none' }>(`/sessions/${sessionId}/draft`);
  return found.status === 'none' ? 'none' : (found as Draft);
};

export const makeDraft = (sessionId: number) => json<Draft>(`/sessions/${sessionId}/draft`, { method: 'POST' });

export const approveDraft = (
  sessionId: number,
  body: { summary?: string; changes?: string[]; tasks?: string[]; questions?: string[] },
) => json<Draft>(`/sessions/${sessionId}/draft/approve`, { method: 'POST', body: JSON.stringify(body) });

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
  program_name: string;
  sessions_planned?: number;
};

export type IntakeInput = {
  memo?: string;
  overall_goal?: string | null;
  detail?: Record<string, unknown>;
  cards?: Array<{ kind: string; text: string; section: string }>;
};

export type IntakeView = {
  session_id: number | null;
  memo: string | null;
  detail: Record<string, unknown>;
  overall_goal: string | null;
  cards: Array<{ kind: string; text: string; locked: boolean }>;
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
  method: 'in_person' | 'phone' | 'video' | 'visit';
  place?: string;
  plan_memo?: string;
};

export const planSession = (caseId: number, body: NewSessionInput) =>
  json<{ session_id: number; seq: number }>(`/cases/${caseId}/sessions`, {
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
  memo: string | null;
  next_goal_text: string | null;
  overall_goal: string | null;
  is_closing: boolean;
  cards: Array<{ kind: string; text: string; area: string | null; locked: boolean }>;
  open_cards: Array<{
    card_id: number;
    kind: string;
    text: string;
    source_session_seq: number | null;
    result: string | null;
    follow: string | null;
    reason: string | null;
  }>;
};

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
export type Program = { id: number; name: string; retired_at: string | null; cases: number };
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
export type Connections = {
  ai: { connected: boolean; provider: string; model: string; env: string };
  stt: { connected: boolean; provider: string; region: string | null; env: string };
  db: { connected: boolean; checked_at: string; env: string };
};

export const getProfile = () => json<Profile>('/settings/profile');
export const saveProfile = (body: { name: string; phone: string | null; contact_email: string | null }) =>
  json<Profile>('/settings/profile', { method: 'PATCH', body: JSON.stringify(body) });
export const deactivateMe = () => json<{ ok: true }>('/settings/deactivate', { method: 'POST' });

export const getOrg = () => json<Org>('/settings/org');
export const saveOrg = (body: Org) => json<Org>('/settings/org', { method: 'PUT', body: JSON.stringify(body) });

export const listPrograms = (all = false) => json<Program[]>(`/settings/programs${all ? '?all=1' : ''}`);
export const addProgram = (name: string) =>
  json<Program[]>('/settings/programs', { method: 'POST', body: JSON.stringify({ name }) });
export const retireProgram = (id: number) => json<Program[]>(`/settings/programs/${id}`, { method: 'DELETE' });

export const listWorkers = () => json<Worker[]>('/settings/workers');
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
export const requestAssignment = (case_id: number, reason: string | null) =>
  json<{ ok: true }>('/settings/requests', { method: 'POST', body: JSON.stringify({ case_id, reason }) });
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
};
export const getConsentCopy = () => json<ConsentCopy[]>('/consent-copy');

export const getConnections = () => json<Connections>('/settings/connections');

export const peekInvite = (token: string) => json<{ role: string }>(`/auth/invite/${token}`);
export const signUpWithInvite = (
  token: string,
  body: { email: string; password: string; name: string },
) => json<{ ok: true }>(`/auth/invite/${token}`, { method: 'POST', body: JSON.stringify(body) });
