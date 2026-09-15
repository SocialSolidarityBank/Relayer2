// 열람 기록(P1). 정본 규칙: PII 를 실은 화면 조회 1건 = 감사 1행, 실은 항목은 그 행의 fields 에.
// 값은 남기지 않는다 — 항목 이름만 남긴다. 감사 기록이 또 하나의 개인정보 창고가 되면 안 된다.
import { sql } from './db.ts';

export type AuditAction =
  | 'participants.list'
  | 'case.detail'
  | 'case.briefing'
  | 'schedule.list'
  | 'consent.record';

export type AuditEntry = {
  actorId: number;
  action: AuditAction;
  participantId?: number | null;
  caseId?: number | null;
  /** 실제로 응답에 실은 PII 항목 이름. 비면 행을 남기지 않는다. */
  fields?: string[];
};

/**
 * 감사 한 줄. 화면 응답을 막지 않도록 실패해도 삼킨다 —
 * 다만 삼킨 사실은 서버 로그에 남긴다(조용히 사라지면 감사가 아니다).
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await sql`
      insert into audit_log (actor_id, action, participant_id, case_id, fields)
      values (${entry.actorId}, ${entry.action}, ${entry.participantId ?? null},
              ${entry.caseId ?? null}, ${entry.fields ?? []})`;
  } catch (error) {
    console.error('audit write failed', entry.action, error);
  }
}

export type AuditRow = {
  id: number;
  at: string;
  action: AuditAction;
  fields: string[];
  actor_name: string | null;
  pseudonym: string | null;
  case_id: number | null;
};

/** 열람 기록 조회. 관리자만 본다(라우트에서 막는다). */
export async function listAudit(limit = 200): Promise<AuditRow[]> {
  return await sql<AuditRow[]>`
    select a.id, a.at, a.action, a.fields, u.name as actor_name, p.pseudonym, a.case_id
    from audit_log a
    left join users u on u.id = a.actor_id
    left join participants p on p.id = a.participant_id
    order by a.at desc, a.id desc
    limit ${limit}`;
}
