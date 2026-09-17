// UI 개편 L5 계약(docs/ui-plan-2026-09-18.md §4). 새 DB 하나에 서버 하나를 띄우고 엔드포인트마다 한 번씩 두드린다.
// 동의 문안 판 올리기는 **모든 동의를 확인 필요로 떨어뜨리므로** 맨 뒤에 둔다 — 앞 시험이 그 뒤에 저장하면 409 다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueCookie } from '../src/auth.ts';
import { enabled } from './voice-fixture.ts';
import { scratchDb, startServer, type Scratch } from './scratch-db.ts';
import type { CaseDetail, ConsentView, SessionRecord } from '../src/service.ts';
import type { Revision } from '../src/revisions.ts';
import type { AssignCase, UserCase } from '../src/settings.ts';

type CopyView = { domain: string; body: string; items: string[]; version: string; hash: string; editable: boolean };
type Created = { case_id: number; pseudonym: string };

let scratch: Scratch;
let base: string;
let stop: () => void;
let admin: number;
let worker: number;
let caseId: number;
let pseudonym: string;
let sessionId: number;

const call = (path: string, actor: number, method = 'GET', body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { cookie: issueCookie(actor).split(';')[0], 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = <T = Record<string, unknown>>(res: Response) => res.json() as Promise<T>;

describe.skipIf(!enabled)('ui-plan L5 contract', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate();
    ({ base, stop } = await startServer(scratch.url));
    [admin, worker] = (
      await scratch.db<Array<{ id: number }>>`insert into users (email, name, role) values
        ('admin', '관리자', 'admin'), ('w', '실무자', 'worker') returning id`
    ).map((r) => Number(r.id));
    const [program] = await scratch.db<Array<{ id: number }>>`insert into programs (name) values ('사업') returning id`;
    const created = await json<Created>(
      await call('/cases', admin, 'POST', {
        name: '김민희', phone: '010-0000-0000', email: 'm@example.com', program_id: Number(program.id),
        consents: [
          { domain: 'personal_data_collection_use', decision: 'grant' },
          { domain: 'sensitive_information_processing', decision: 'grant' },
        ],
      }),
    );
    caseId = created.case_id;
    pseudonym = created.pseudonym;
    ({ session_id: sessionId } = await json<{ session_id: number }>(await call(`/cases/${caseId}/sessions/start`, admin, 'POST', {})));
  }, 60_000);
  afterAll(async () => {
    stop?.();
    await scratch?.drop();
  });

  it('duration_min: PATCH 로 넣고, 안 보내면 지키고, null 이면 지운다', async () => {
    expect((await call(`/sessions/${sessionId}`, admin, 'PATCH', { memo: '첫 기록', duration_min: 45 })).status).toBe(200);
    expect((await json<SessionRecord>(await call(`/sessions/${sessionId}/detail`, admin))).duration_min).toBe(45);
    await call(`/sessions/${sessionId}`, admin, 'PATCH', { memo: '첫 기록' });
    expect((await json<SessionRecord>(await call(`/sessions/${sessionId}`, admin))).duration_min).toBe(45);
    await call(`/sessions/${sessionId}`, admin, 'PATCH', { duration_min: null });
    expect((await json<SessionRecord>(await call(`/sessions/${sessionId}`, admin))).duration_min).toBeNull();
    expect((await call(`/sessions/${sessionId}`, admin, 'PATCH', { duration_min: 0 })).status).toBe(400);
    // 일정 예약에서도 받는다.
    const planned = await json<{ session_id: number }>(
      await call(`/cases/${caseId}/sessions`, admin, 'POST', { scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), method: 'phone', duration_min: 30 }),
    );
    const detail = await json<CaseDetail>(await call(`/cases/${caseId}/detail`, admin));
    expect(detail.sessions.find((s) => s.id === planned.session_id)?.duration_min).toBe(30);
  });

  it('revisions: 원본을 고치면 현재 본문이 바뀌고 로그가 쌓이며 파생물에 stale 이 붙는다', async () => {
    // 기록 전 회차·없는 전사·없는 요약은 409 다.
    const [planned] = await scratch.db<Array<{ id: number }>>`
      select id from sessions where case_id = ${caseId} and status = 'planned'`;
    expect((await call(`/sessions/${Number(planned.id)}/revisions`, admin, 'POST', { kind: 'memo', text: 'x' })).status).toBe(409);
    expect((await call(`/sessions/${sessionId}/revisions`, admin, 'POST', { kind: 'transcript', text: 'x' })).status).toBe(409);
    expect((await call(`/sessions/${sessionId}/revisions`, admin, 'POST', { kind: 'summary', text: 'x' })).status).toBe(409);

    // 승인된 AI 정리가 있다 치고, 수기를 고친다 → 요약이 옛것이 된다.
    await scratch.db`insert into ai_drafts (session_id, status, summary) values (${sessionId}, 'approved', '옛 요약')`;
    expect((await json<SessionRecord>(await call(`/sessions/${sessionId}/detail`, admin))).stale).toEqual({ ai_summary: false, mismatch: false });
    const revised = await call(`/sessions/${sessionId}/revisions`, admin, 'POST', { kind: 'memo', text: '고친 기록' });
    expect(revised.status).toBe(201);
    expect(await json(revised)).toMatchObject({ kind: 'memo', text: '고친 기록', actor: '관리자', actor_id: admin });
    const after = await json<SessionRecord>(await call(`/sessions/${sessionId}/detail`, admin));
    expect(after.memo).toBe('고친 기록');
    expect(after.stale).toEqual({ ai_summary: true, mismatch: false });
    const detail = await json<CaseDetail>(await call(`/cases/${caseId}/detail`, admin));
    expect(detail.sessions.find((s) => s.id === sessionId)?.stale.ai_summary).toBe(true);

    // 요약을 고치면 승인 행이 새로 쌓이고 stale 이 풀린다.
    expect((await call(`/sessions/${sessionId}/revisions`, admin, 'POST', { kind: 'summary', text: '새 요약' })).status).toBe(201);
    expect((await json<{ summary: string }>(await call(`/sessions/${sessionId}/draft`, admin))).summary).toBe('새 요약');
    expect((await json<SessionRecord>(await call(`/sessions/${sessionId}/detail`, admin))).stale.ai_summary).toBe(false);

    const log = await json<Revision[]>(await call(`/sessions/${sessionId}/revisions`, admin));
    expect(log.map((r) => r.kind)).toEqual(['memo', 'summary']);
    expect(log[0].text).toBe('고친 기록');
    // 리비전은 지우거나 고칠 수 없고, 감사에 남는다.
    await expect(scratch.db`delete from session_revisions`).rejects.toThrow(/append-only/);
    const audits = await scratch.db<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'session.revise' order by id`;
    expect(audits.map((a) => a.fields)).toEqual([[`session=${sessionId}`, 'kind=memo'], [`session=${sessionId}`, 'kind=summary']]);
  });

  it('next-goals: 줄 배열을 이어 기존 컬럼에 두고, 기록 회차가 없으면 409 다', async () => {
    const res = await call(`/cases/${caseId}/next-goals`, admin, 'PATCH', { lines: ['월세 확인', '  ', '병원 예약'] });
    expect(res.status).toBe(200);
    expect((await json<{ session_id: number }>(res)).session_id).toBe(sessionId);
    const detail = await json<CaseDetail>(await call(`/cases/${caseId}/detail`, admin));
    expect(detail.pending_next_goal).toMatchObject({ session_id: sessionId, text: '월세 확인\n병원 예약' });

    const [program] = await scratch.db<Array<{ id: number }>>`select id from programs limit 1`;
    const empty = await json<Created>(
      await call('/cases', admin, 'POST', { name: '아무개', program_id: Number(program.id), consents: [{ domain: 'personal_data_collection_use', decision: 'grant' }] }),
    );
    expect((await call(`/cases/${empty.case_id}/next-goals`, admin, 'PATCH', { lines: ['x'] })).status).toBe(409);
  });

  it('assignments: 전체 치환·감사·담당 목록·배정 목록·요청 승인', async () => {
    // 실무자는 배정 전이라 사례를 못 연다. 관리자 전용 목록도 닫혀 있다.
    expect((await call(`/cases/${caseId}`, worker)).status).toBe(403);
    expect((await call('/assign/cases', worker)).status).toBe(403);
    expect((await call(`/cases/${caseId}/assignments`, worker, 'PUT', { user_ids: [worker] })).status).toBe(403);
    expect((await call(`/users/${admin}/cases`, worker)).status).toBe(403);
    expect(await json(await call(`/users/${worker}/cases`, worker))).toEqual([]);

    // 전체 치환 → 실무자가 열 수 있고, 담당 목록에 이름·사업·회차·다음 상담이 실린다.
    const put = await call(`/cases/${caseId}/assignments`, admin, 'PUT', { user_ids: [worker] });
    expect(put.status).toBe(200);
    expect((await json<{ assignees: unknown[] }>(put)).assignees).toEqual([{ id: worker, name: '실무자' }]);
    expect((await call(`/cases/${caseId}`, worker)).status).toBe(200);
    expect((await call(`/cases/${caseId}`, admin)).status).toBe(403);
    const mine = await json<UserCase[]>(await call(`/users/${worker}/cases`, worker));
    expect(mine).toEqual([{ case_id: caseId, name: '김민희', program: '사업', seq: 1, next_at: expect.any(String) }]);
    expect((await call(`/cases/99999/assignments`, admin, 'PUT', { user_ids: [] })).status).toBe(404);

    // 배정 목록: 10건씩, 검색은 가명·사업 이름, 이름·연락처·이메일이 실린다.
    const list = await json<{ items: AssignCase[]; total: number }>(await call(`/assign/cases?q=${encodeURIComponent(pseudonym)}`, admin));
    expect(list).toMatchObject({ total: 1, page: 1, page_size: 10 });
    expect(list.items[0]).toEqual({
      case_id: caseId, name: '김민희', login: pseudonym, program: '사업', seq: 1,
      phone: '010-0000-0000', email: 'm@example.com', assignees: [{ id: worker, name: '실무자' }],
    });
    expect((await json<{ total: number }>(await call('/assign/cases?q=없는가명', admin))).total).toBe(0);
    expect((await json<{ items: unknown[] }>(await call('/assign/cases?page=2', admin))).items).toEqual([]);

    // 요청 승인 → 같은 트랜잭션에서 case_assignments 에 들어간다. 두 번째는 409.
    await call(`/cases/${caseId}/assignments`, admin, 'PUT', { user_ids: [] });
    expect((await call('/settings/requests', worker, 'POST', { case_id: caseId })).status).toBe(200);
    const [request] = await json<Array<{ id: number }>>(await call('/settings/requests', worker));
    const approve = await call(`/assignment-requests/${request.id}/approve`, admin, 'POST');
    expect(approve.status).toBe(200);
    expect((await call(`/cases/${caseId}`, worker)).status).toBe(200);
    expect((await call(`/assignment-requests/${request.id}/approve`, admin, 'POST')).status).toBe(409);

    const audits = await scratch.db<Array<{ action: string; fields: string[] }>>`
      select action, fields from audit_log where action in ('assignment.set', 'assign.view', 'assignment.decide') order by id`;
    // 배정 목록 조회는 두 번 했지만 같은 사람의 열람이라 한 줄로 접힌다(SPEC §19-2).
    expect(audits.map((a) => a.action)).toEqual(['assignment.set', 'assign.view', 'assignment.set', 'assignment.decide']);
    expect(audits[0].fields).toEqual([`assignee=${worker}`]);
  });

  it('consent-copy: 관리자가 고치면 새 판이 되고 모든 동의가 확인 필요로 떨어진다', async () => {
    const before = await json<CopyView[]>(await call('/consent-copy', worker));
    const personal = before.find((c) => c.domain === 'personal_data_collection_use');
    expect(personal).toMatchObject({ editable: false, version: 'consent-standard-form-v3' });
    expect((await json<CopyView[]>(await call('/consent-copy', admin)))[0].editable).toBe(true);

    const body = { copy: '새 전문', items: ['이름', '연락처'], purpose_text: '목적', retention_text: '기간', refusal_text: '거부권' };
    expect((await call('/consent-copy/personal_data_collection_use', worker, 'PUT', body)).status).toBe(403);
    expect((await call('/consent-copy/nope', admin, 'PUT', body)).status).toBe(400);
    const put = await call('/consent-copy/personal_data_collection_use', admin, 'PUT', body);
    expect(put.status).toBe(200);
    const updated = await json<CopyView>(put);
    expect(updated).toMatchObject({ body: '새 전문', items: ['이름', '연락처'], version: 'consent-standard-form-v4', editable: true });
    expect(updated.hash).not.toBe(personal?.hash);

    // 다른 영역은 문안이 그대로지만 판이 올라 함께 확인 필요다. 화면(GET)도 새 판을 본다.
    const after = await json<CopyView[]>(await call('/consent-copy', worker));
    expect(after.find((c) => c.domain === 'sensitive_information_processing')).toMatchObject({
      version: 'consent-standard-form-v4', body: before.find((c) => c.domain === 'sensitive_information_processing')?.body,
    });
    const consents = await json<ConsentView>(await call(`/cases/${caseId}/consents`, worker));
    expect(consents.find((c) => c.domain === 'personal_data_collection_use')?.status).toBe('unconfirmed');
    expect(consents.find((c) => c.domain === 'sensitive_information_processing')?.status).toBe('unconfirmed');
    expect((await call(`/sessions/${sessionId}`, worker, 'PATCH', { memo: '막힘' })).status).toBe(409);

    // 다시 받으면 새 판·새 지문으로 동의함이다. 한 번 더 고치면 v5.
    await call(`/cases/${caseId}/consents`, worker, 'POST', { domain: 'personal_data_collection_use', decision: 'grant' });
    const [event] = await scratch.db<Array<{ copy_version: string; copy_hash: string }>>`
      select copy_version, copy_hash from consent_events order by id desc limit 1`;
    expect(event.copy_version).toBe('consent-standard-form-v4');
    expect(event.copy_hash.slice(0, 12)).toBe(updated.hash);
    expect((await json<CopyView>(await call('/consent-copy/document_attachment', admin, 'PUT', body))).version).toBe('consent-standard-form-v5');
    await expect(scratch.db`delete from consent_copy`).rejects.toThrow(/append-only/);
    const audits = await scratch.db<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'consent.copy.update' order by id`;
    expect(audits.map((a) => a.fields)).toEqual([
      ['domain=personal_data_collection_use', 'version=consent-standard-form-v4'],
      ['domain=document_attachment', 'version=consent-standard-form-v5'],
    ]);
  }, 30_000);
});
