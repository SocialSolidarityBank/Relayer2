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

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error;
    // 401 의 사연은 서버가 안다(만료인지, 당사자 계정인지). 화면이 문구를 지어내지 않는다.
    if (res.status === 401) throw new Unauthorized(message ?? '로그인이 필요해요.');
    throw new Error(message ?? `${res.status}`);
  }
  return (await res.json()) as T;
}

export type Me = { id: number; name: string; role: 'worker' | 'admin' };

export const getMe = () => json<Me>('/me');
export const login = (email: string, password: string) =>
  json<Me>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const logout = () => json<{ ok: true }>('/auth/logout', { method: 'POST' });

export type ParticipantRow = {
  case_id: number;
  participant_id: number;
  pseudonym: string;
  name: string | null;
  program_name: string;
  status: 'open' | 'closed';
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

export const getBriefing = (caseId: number) => json<Briefing>(`/cases/${caseId}/briefing`);
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

export const CONSENT_DOMAINS = ['personal_data_collection_use', 'sensitive_information_processing'] as const;
export type ConsentDomain = (typeof CONSENT_DOMAINS)[number];
export type ConsentDecision = 'grant' | 'withdraw' | 'decline';

export type ConsentView = Array<{
  domain: ConsentDomain;
  label: string;
  copy: string;
  status: 'granted' | 'not_granted' | 'unconfirmed';
  decided_at: string | null;
}>;

export type AuditRow = {
  id: number;
  at: string;
  action: string;
  fields: string[];
  actor_name: string | null;
  pseudonym: string | null;
  case_id: number | null;
};

export const listAudit = () => json<AuditRow[]>('/audit');

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
