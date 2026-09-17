// 사례 접근 통제(2026-09-16 Q). **맡은 사람만 연다 — 관리자도 예외가 없다.**
//
// 화면에서 감추는 것은 안내이지 잠금이 아니다. 잠금은 여기 하나다:
// 사례·회차·문서·녹음·동의·당사자 열람 링크, 어느 경로로 와도 이 문을 지난다.
// 배정을 빼면 다음 요청부터 바로 닫힌다 — 세션 캐시를 두지 않는다.
import { sql } from './db.ts';

/** 사례가 없다. 라우트는 404 로 답한다. */
export class NotFound extends Error {}

/** 사례는 있으나 맡은 사람이 아니다. 라우트는 403 으로 답한다. */
export class AccessDenied extends Error {}

/** 사례가 종결됐다. 새 녹음·전사를 받지 않는다. 라우트는 409 로 답한다. */
export class CaseClosed extends Error {}

/** 종결 사례에는 새 음성 처리를 하지 않는다(2026-09-16 Q). 재생·열람은 이 문을 지나지 않는다. */
export async function assertCaseOpen(caseId: number): Promise<void> {
  const [row] = await sql<Array<{ status: string }>>`
    select status from support_cases where id = ${caseId}`;
  if (!row) throw new NotFound('사례 없음');
  if (row.status === 'closed') throw new CaseClosed('종결된 상담, 녹음·전사 불가');
}


/** 사례가 없으면 NotFound, 맡지 않았으면 AccessDenied. */
export async function assertCaseAccess(caseId: number, userId: number): Promise<void> {
  const [row] = await sql<Array<{ mine: boolean }>>`
    select exists (select 1 from case_assignments a
                   where a.case_id = c.id and a.user_id = ${userId}) as mine
    from support_cases c where c.id = ${caseId}`;
  if (!row) throw new NotFound('사례 없음');
  if (!row.mine) throw new AccessDenied('배정되지 않은 당사자');
}

/** 회차 → 사례. 없으면 null. */
export async function caseIdOfSession(sessionId: number): Promise<number | null> {
  const [row] = await sql<Array<{ case_id: number }>>`
    select case_id from sessions where id = ${sessionId}`;
  return row?.case_id ?? null;
}

/** 녹음 → 회차 → 사례. 없으면 null. */
export async function caseIdOfRecording(recordingId: number): Promise<number | null> {
  const [row] = await sql<Array<{ case_id: number }>>`
    select s.case_id from recordings r join sessions s on s.id = r.session_id
    where r.id = ${recordingId}`;
  return row?.case_id ?? null;
}

/** 문서 → 사례. 없으면 null. */
export async function caseIdOfDocument(documentId: number): Promise<number | null> {
  const [row] = await sql<Array<{ case_id: number }>>`
    select case_id from documents where id = ${documentId}`;
  return row?.case_id ?? null;
}

