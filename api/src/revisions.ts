/**
 * 회차 원본 리비전(2026-09-18 Q D3). 수기·전사·요약을 **편집 모드**로 고친다 —
 * 현재 본문을 갱신하고 `session_revisions` 에 새 리비전을 쌓는다(append-only). 메모 추가 방식은
 * 원문이 틀린 채 남아 채택하지 않았다. 파생물(AI 요약·불일치)은 자동 재처리하지 않고
 * `stale` 배지만 붙는다(service.ts `staleFlags`). 재정리는 사람이 `AI 정리 다시 하기`로 부른다.
 *
 * 세 종류의 "현재 본문"은 서로 다른 표에 있다.
 * - memo       → `sessions.memo` 를 덮는다(암호문).
 * - transcript → `transcripts` 에 승인 행을 쌓는다(append-only 라 덮지 않는다). 타임스탬프는 붙이지 않는다.
 * - summary    → v6 승인 분석이 있으면 `record_analyses` 에 summary_override 를 담은 새 승인 행을 쌓고,
 *                없으면 `ai_drafts` 에 승인 행을 쌓는다. 과제·질문 카드는 손대지 않는다(요약문만 고친다).
 */
import { audit } from './audit.ts';
import { NotFound, caseIdOfSession } from './access.ts';
import { sql } from './db.ts';
import { decryptText, encryptText } from './pii.ts';
import type { AnalysisBody } from './domain/record-analysis.ts';

export const REVISION_KINDS = ['memo', 'transcript', 'summary'] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

/** 고칠 원본이 아직 없다(기록 전 회차, 전사·요약 없음). 라우트는 409 로 답한다. */
export class NothingToRevise extends Error {}

export type Revision = {
  id: number;
  kind: RevisionKind;
  text: string;
  actor: string | null;
  actor_id: number | null;
  created_at: string;
};

export async function reviseSession(
  sessionId: number,
  actorId: number,
  kind: RevisionKind,
  text: string,
): Promise<Revision> {
  const caseId = await caseIdOfSession(sessionId);
  if (caseId === null) throw new NotFound('회차 없음');

  const revision = await sql.begin(async (tx) => {
    const [s] = await tx<Array<{ status: string }>>`select status from sessions where id = ${sessionId} for update`;
    if (s?.status !== 'done') throw new NothingToRevise('기록 전 회차, 원본 없음');

    if (kind === 'memo') {
      await tx`update sessions set memo = ${encryptText(text)} where id = ${sessionId}`;
    } else if (kind === 'transcript') {
      const [inserted] = await tx<Array<{ id: number }>>`
        insert into transcripts (recording_id, session_id, status, text, segments, mask_hits, engine, created_by, approved_by)
        select recording_id, session_id, 'approved', ${encryptText(text)}, null, mask_hits, engine, ${actorId}, ${actorId}
        from transcripts where session_id = ${sessionId} order by id desc limit 1
        returning id`;
      if (!inserted) throw new NothingToRevise('전사문 없음');
    } else {
      // v6 승인 분석이 있으면 요약 편집은 summary_override 로 새 승인 행에 담는다(Q 17) —
      // 01 구조·상태·전사 연결·키워드는 그대로 복사한다. ai_drafts 는 건드리지 않는다.
      const [analysis] = await tx<Array<{ id: number; status: string; body: string | null }>>`
        select id, status, body from record_analyses
        where session_id = ${sessionId} order by id desc limit 1`;
      if (analysis?.status === 'approved' && analysis.body) {
        const body = JSON.parse(decryptText(analysis.body) ?? 'null') as AnalysisBody;
        const overridden: AnalysisBody = {
          ...body,
          summary_override: { text, actor_id: actorId, at: new Date().toISOString() },
        };
        await tx`
          insert into record_analyses
            (session_id, status, schema_version, rule_version, source_versions, model, mask_hits, body, created_by, approved_by)
          select session_id, 'approved', schema_version, rule_version, source_versions, model, mask_hits,
                 ${encryptText(JSON.stringify(overridden))}, created_by, ${actorId}
          from record_analyses where id = ${analysis.id}`;
      } else {
        const [inserted] = await tx<Array<{ id: number }>>`
          insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by, approved_by)
          select session_id, 'approved', ${text}, changes, tasks, questions, fact_changes, mask_hits, model, created_by, ${actorId}
          from ai_drafts where session_id = ${sessionId} and status = 'approved' order by id desc limit 1
          returning id`;
        if (!inserted) throw new NothingToRevise('승인된 AI 정리 없음');
      }
    }

    const [row] = await tx<Array<{ id: number; created_at: string }>>`
      insert into session_revisions (session_id, kind, text, actor)
      values (${sessionId}, ${kind}, ${encryptText(text)}, ${actorId})
      returning id, created_at`;
    return row;
  });

  await audit({ actorId, action: 'session.revise', caseId, fields: [`session=${sessionId}`, `kind=${kind}`] });
  const [actor] = await sql<Array<{ name: string }>>`select name from users where id = ${actorId}`;
  return { id: revision.id, kind, text, actor: actor?.name ?? null, actor_id: actorId, created_at: revision.created_at };
}

export async function listRevisions(sessionId: number): Promise<Revision[]> {
  const rows = await sql<Array<Omit<Revision, 'text'> & { text: string | null }>>`
    select r.id, r.kind, r.text, u.name as actor, r.actor as actor_id, r.created_at
    from session_revisions r left join users u on u.id = r.actor
    where r.session_id = ${sessionId} order by r.id`;
  return rows.map((r) => ({ ...r, text: decryptText(r.text) ?? '' }));
}
