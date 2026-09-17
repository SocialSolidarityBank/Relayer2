// Isolated local DB only: Main creates/migrates a disposable database before enabling this suite.
import { describe, expect, it } from 'vitest';
import { DATABASE_URL, sql } from '../src/db.ts';
import { app } from '../src/routes.ts';
import { ensureProgram } from './voice-fixture.ts';
import { issueCookie } from '../src/auth.ts';
import { randomUUID } from 'node:crypto';
import { encryptPii } from '../src/pii.ts';

const enabled = process.env.RELAYER_INTEGRATION === '1';
if (enabled) {
  const db = new URL(DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || !db.pathname.startsWith('/relayer_shared_check_'))
    throw new Error('Integration tests require an isolated relayer_shared_check_ database on localhost.');
}
const request = (path: string, actor: number, method = 'GET', body?: unknown) => app.request(path, {
  method, headers: { cookie: issueCookie(actor).split(';')[0], ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

async function fixtureUsers(): Promise<number[]> {
  const prefix = randomUUID();
  const rows = await sql<Array<{ id: number }>>`insert into users (email,name,role) values
    (${prefix+'-a'},'실무자 A','worker'),(${prefix+'-b'},'실무자 B','worker'),
    (${prefix+'-admin'},'관리자','admin') returning id`;
  return rows.map(row=>row.id);
}

describe.skipIf(!enabled)('shared case assignment boundary', () => {
  it('requires membership including admins, adds jointly, revokes immediately without discarding another member', async () => {
    const [a,b,admin] = await fixtureUsers();
    const created = await request('/cases',a,'POST',{name:'공동배정 합성',program_id:await ensureProgram('권한 검증'),consents:[{domain:'personal_data_collection_use',decision:'grant'},{domain:'sensitive_information_processing',decision:'grant'}]});
    expect(created.status).toBe(201);
    const {case_id:caseId,participant_id:participantId}=await created.json();
    await sql`update participant_pii set enc_phone=${encryptPii('010-1111-2222')} where participant_id=${participantId}`;
    const planned=await request(`/cases/${caseId}/sessions`,a,'POST',{scheduled_at:'2026-09-20T01:00:00Z',method:'phone'});
    expect(planned.status).toBe(201);
    const {session_id:sessionId}=await planned.json();
    const protectedWrites: Array<[string, string]> = [
      ['PUT', `/cases/${caseId}/intake`],
      ['POST', `/cases/${caseId}/sessions`],
      ['POST', `/cases/${caseId}/consents`],
      ['POST', `/cases/${caseId}/documents`],
      ['POST', `/cases/${caseId}/close`],
      ['POST', `/sessions/${sessionId}/draft`],
      ['POST', `/sessions/${sessionId}/draft/approve`],
      ['POST', `/sessions/${sessionId}/recordings`],
      ['POST', `/sessions/${sessionId}/transcript/approve`],
      ['POST', `/cases/${caseId}/access`],
      ['DELETE', `/cases/${caseId}/access`],
    ];
    expect((await request(`/sessions/${sessionId}`,a,'PATCH',{memo:'연체 3건입니다.',method:'phone'})).status).toBe(200);
    const paths=[`/cases/${caseId}`,`/cases/${caseId}/detail`,`/cases/${caseId}/intake`,`/cases/${caseId}/briefing`,`/cases/${caseId}/documents`,`/cases/${caseId}/consents`,`/sessions/${sessionId}`,`/sessions/${sessionId}/draft`,`/sessions/${sessionId}/transcript`,`/sessions/${sessionId}/mismatches`,`/sessions/${sessionId}/recordings`,`/cases/${caseId}/access`];
    for (const actor of [b,admin]) {
      for (const path of paths) expect((await request(path,actor)).status, path).toBe(403);
      for (const [method,path] of protectedWrites)
        expect((await request(path,actor,method,{})).status, `${method} ${path}`).toBe(403);
      expect((await request(`/sessions/${sessionId}`,actor,'PATCH',{memo:'권한 없는 수정',method:'phone'})).status).toBe(403);
      const index = await (await request('/participants',actor)).json();
      const row=index.find((r:any)=>r.case_id===caseId);
      if(row){ expect(row.name).toBeNull(); expect(row.can_access).toBe(false); expect(row.last_session_seq).toBeNull(); }
      expect(JSON.stringify(await (await request('/schedules',actor)).json())).not.toContain('공동배정 합성');
    }
    const auditData=await (await request('/audit',admin)).text();
    expect(auditData).not.toContain('공동배정 합성');
    expect((await request('/settings/assign',b,'POST',{case_id:caseId,user_ids:[b]})).status).toBe(403);
    expect((await request('/settings/assign',admin,'POST',{case_id:caseId,user_ids:[a,b]})).status).toBe(200);
    for(const actor of [a,b]) expect((await request(`/cases/${caseId}/detail`,actor)).status).toBe(200);
    expect((await request('/settings/assign',admin,'POST',{case_id:caseId,user_ids:[b]})).status).toBe(200);
    expect((await request(`/cases/${caseId}/detail`,a)).status).toBe(403);
    expect((await request(`/sessions/${sessionId}`,b)).status).toBe(200);
    expect((await request('/settings/assign',admin,'POST',{case_id:caseId,user_ids:[]})).status).toBe(200);
    expect((await request(`/sessions/${sessionId}`,b)).status).toBe(403);
  });

  it('approval adds a second assignee instead of replacing the existing one', async()=>{
    const [a,b,admin] = await fixtureUsers();
    const res=await request('/cases',a,'POST',{name:'추가배정 합성',program_id:await ensureProgram('권한 검증'),consents:[{domain:'personal_data_collection_use',decision:'grant'}]});
    const {case_id}=await res.json();
    expect((await request('/settings/requests',b,'POST',{case_id,reason:'팀 합의'})).status).toBe(200);
    const [pending]=await sql<Array<{id:number}>>`select id from assignment_requests where case_id=${case_id} and requested_by=${b}`;
    expect((await request(`/settings/requests/${pending.id}`,admin,'POST',{decision:'approved'})).status).toBe(200);
    for(const actor of [a,b]) expect((await request(`/cases/${case_id}`,actor)).status).toBe(200);
    await request('/settings/assign',admin,'POST',{case_id,user_ids:[a]});
    await request(`/settings/requests/${pending.id}`,admin,'POST',{decision:'approved'});
    expect((await request(`/cases/${case_id}`,b)).status).toBe(403);
  });

  it('limits participant links to the issuer case and invalidates links after issuer removal', async () => {
    const [a,b,admin] = await fixtureUsers();
    const created=await request('/cases',a,'POST',{name:'다사업 합성',program_id:await ensureProgram('A사업'),consents:[{domain:'personal_data_collection_use',decision:'grant'}]});
    const {case_id,participant_id}=await created.json();
    const [other]=await sql<Array<{id:number}>>`insert into support_cases(participant_id,program_id) values(${participant_id},${await ensureProgram('B사업')}) returning id`;
    await request('/settings/assign',admin,'POST',{case_id:other.id,user_ids:[b]});
    const tomorrow = new Date(Date.now()+86400000).toISOString();
    const otherConsents = await (await request(`/cases/${other.id}/consents`, b)).json();
    expect(otherConsents.find((c:any)=>c.domain==='personal_data_collection_use')?.status).toBe('unconfirmed');
    await request(`/cases/${case_id}/sessions`,a,'POST',{scheduled_at:tomorrow,method:'phone'});
    await request(`/cases/${other.id}/sessions`,b,'POST',{scheduled_at:tomorrow,method:'phone'});
    const issued=await (await request(`/cases/${case_id}/access`,a,'POST',{})).json();
    const opened=await app.request('/access/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(issued)});
    expect(opened.status).toBe(200);
    const view=await opened.json();
    expect(view.schedule.map((s:any)=>s.program_name)).toEqual(['A사업']);
    await request('/settings/assign',admin,'POST',{case_id,user_ids:[b]});
    const after=await app.request('/access/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(issued)});
    expect(after.status).toBe(401);
  });
});
