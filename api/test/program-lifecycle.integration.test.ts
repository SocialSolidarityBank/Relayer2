// 사업 실체(2026-09-17 Q): 이름 변경 → 사례가 새 이름으로 보이고, 종료는 경고 뒤 잠금이며, 다시 열기가 되돌린다.
// 종료된 사업의 사례는 정리(종결·열람 링크 회수·관리자 배정 변경·이미 잡힌 예정 회차의 기록)만 된다.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { enabled, req } from './voice-fixture.ts';

const GRANT = ['personal_data_collection_use', 'sensitive_information_processing'].map((domain) => ({
  domain,
  decision: 'grant',
}));

async function people() {
  const prefix = randomUUID();
  const rows = await sql<Array<{ id: number }>>`insert into users (email, name, role) values
    (${prefix + '-a'}, '실무자 A', 'worker'), (${prefix + '-b'}, '실무자 B', 'worker'),
    (${prefix + '-admin'}, '관리자', 'admin') returning id`;
  return rows.map((r) => r.id);
}

describe.skipIf(!enabled)('program lifecycle', () => {
  it('renames through to cases, warns then retires, locks writes except cleanup, hides closed planned sessions, reopens', async () => {
    const [a, b, admin] = await people();
    const name = `사업 ${randomUUID().slice(0, 8)}`;

    // 사업 만들기 — 기간·설명까지. 실무자는 못 만든다.
    expect((await req('/settings/programs', a, 'POST', { name })).status).toBe(403);
    const made = await req('/settings/programs', admin, 'POST', {
      name,
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
      description: '한 줄 설명',
    });
    expect(made.status).toBe(201);
    const program = await made.json();
    expect(program).toMatchObject({ name, starts_on: '2026-01-01', ends_on: '2026-12-31', description: '한 줄 설명', retired_at: null });
    // 기간이 거꾸로면 400.
    expect((await req('/settings/programs', admin, 'POST', { name: name + '역', starts_on: '2026-12-01', ends_on: '2026-01-01' })).status).toBe(400);
    // 같은 이름은 409 — 되살리지 않는다.
    expect((await req('/settings/programs', admin, 'POST', { name })).status).toBe(409);

    // 사례 둘: 하나는 예정 회차를 하나 잡아 두고, 하나는 종결할 것.
    const c1 = await (await req('/cases', a, 'POST', { name: '수명 합성 1', program_id: program.id, consents: GRANT })).json();
    const c2 = await (await req('/cases', a, 'POST', { name: '수명 합성 2', program_id: program.id, consents: GRANT })).json();
    const planned = await (await req(`/cases/${c1.case_id}/sessions`, a, 'POST', { scheduled_at: '2026-10-01T01:00:00Z', method: 'phone' })).json();
    const plannedIn2 = await (await req(`/cases/${c2.case_id}/sessions`, a, 'POST', { scheduled_at: '2026-10-02T01:00:00Z', method: 'phone' })).json();

    // 이름 변경 → 사례 조회·목록·배정 화면에 새 이름.
    const renamed = `${name} 개명`;
    expect((await req(`/settings/programs/${program.id}`, admin, 'PATCH', { name: renamed, description: null })).status).toBe(200);
    const detail = await (await req(`/cases/${c1.case_id}/detail`, a)).json();
    expect(detail.case).toMatchObject({ program_id: program.id, program_name: renamed });
    const list = await (await req('/participants', a)).json();
    expect(list.find((r: { case_id: number }) => r.case_id === c1.case_id)).toMatchObject({ program_id: program.id, program_name: renamed });
    const assignments = await (await req('/settings/assignments', admin)).json();
    expect(assignments.find((r: { id: number }) => r.id === c1.case_id).program_name).toBe(renamed);

    // 종결한 사례의 예정 회차는 일정에서 빠진다(취소 API 없음).
    expect((await req(`/cases/${c2.case_id}/close`, a, 'POST', { close_reason: '목표 달성' })).status).toBe(200);
    const schedules = await (await req('/schedules?from=2026-09-01T00:00:00Z&to=2026-11-01T00:00:00Z', a)).json();
    const ids = schedules.map((s: { session_id: number }) => s.session_id);
    expect(ids).toContain(planned.session_id);
    expect(ids).not.toContain(plannedIn2.session_id);

    // 종료: 열린 사례 1 · 예정 회차 1 → 409 에 건수. confirm 으로 종료.
    const warn = await req(`/settings/programs/${program.id}`, admin, 'DELETE');
    expect(warn.status).toBe(409);
    expect(await warn.json()).toEqual({ open_cases: 1, planned_sessions: 1 });
    const [{ retired_at: still }] = await sql<Array<{ retired_at: Date | null }>>`select retired_at from programs where id = ${program.id}`;
    expect(still).toBeNull();
    expect((await req(`/settings/programs/${program.id}?confirm=1`, admin, 'DELETE')).status).toBe(200);
    // 종료된 사업은 기본 목록에서 빠지고 all 에는 남는다.
    const live = await (await req('/settings/programs', a)).json();
    expect(live.some((p: { id: number }) => p.id === program.id)).toBe(false);
    const all = await (await req('/settings/programs?all=1', a)).json();
    expect(all.find((p: { id: number }) => p.id === program.id).retired_at).not.toBeNull();

    // 잠긴 쓰기 — 전부 409 이고 메시지가 사업 종료를 말한다.
    const locked: Array<[string, string, unknown]> = [
      ['/cases', 'POST', { name: '막힘', program_id: program.id, consents: GRANT }],
      [`/cases/${c1.case_id}/sessions`, 'POST', { scheduled_at: '2026-10-05T01:00:00Z', method: 'phone' }],
      [`/cases/${c1.case_id}/intake`, 'PUT', { memo: '인테이크' }],
      [`/cases/${c1.case_id}/sessions/start`, 'POST', {}],
      [`/cases/${c1.case_id}/consents`, 'POST', { domain: 'counseling_recording', decision: 'grant' }],
      [`/cases/${c1.case_id}/access`, 'POST', undefined],
      [`/settings/requests`, 'POST', { case_id: c1.case_id, reason: '맡고 싶어요' }],
    ];
    for (const [path, method, body] of locked) {
      const res = await req(path, path === '/settings/requests' ? b : a, method, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect((await res.json()).error, `${method} ${path}`).toContain('종료된 사업');
    }
    const doc = await req(`/cases/${c1.case_id}/documents?label=x`, a, 'POST', undefined);
    expect(doc.status).toBe(409);
    // 종료된 사업은 고칠 수 없다.
    const patch = await req(`/settings/programs/${program.id}`, admin, 'PATCH', { name: `${renamed} 다시` });
    expect(patch.status).toBe(409);

    // 예외 — 이미 잡힌 예정 회차의 기록(시작·저장), 관리자 배정 변경, 열람 링크 회수, 사례 종결.
    expect((await req(`/cases/${c1.case_id}/sessions/start`, a, 'POST', { session_id: planned.session_id })).status).toBe(201);
    // 기록됨이 된 회차를 고쳐 쓰는 것은 잠긴다.
    expect((await req(`/sessions/${planned.session_id}`, a, 'PATCH', { memo: '고쳐 쓰기' })).status).toBe(409);
    const planned2 = await sql<Array<{ id: number }>>`
      insert into sessions (case_id, seq, kind, status, scheduled_at, method)
      values (${c1.case_id}, 9, 'regular', 'planned', '2026-10-09T01:00:00Z', 'phone') returning id`;
    expect((await req(`/sessions/${planned2[0].id}`, a, 'PATCH', { memo: '예정 회차 기록', method: 'phone' })).status).toBe(200);
    expect((await req('/settings/assign', admin, 'POST', { case_id: c1.case_id, user_ids: [a, b] })).status).toBe(200);
    expect((await req(`/cases/${c1.case_id}/access`, a, 'DELETE')).status).toBe(200);
    expect((await req(`/cases/${c1.case_id}/close`, a, 'POST', { close_reason: '사업 종료 정리' })).status).toBe(200);

    // 다시 열기 → 고치기·쓰기가 돌아온다. 종결된 사례는 그대로 종결이다.
    expect((await req(`/settings/programs/${program.id}/reopen`, a, 'POST')).status).toBe(403);
    expect((await req(`/settings/programs/${program.id}/reopen`, admin, 'POST')).status).toBe(200);
    expect((await req(`/settings/programs/${program.id}`, admin, 'PATCH', { description: '다시 열림' })).status).toBe(200);
    const c3 = await req('/cases', a, 'POST', { name: '수명 합성 3', program_id: program.id, consents: GRANT });
    expect(c3.status).toBe(201);
    const [{ status }] = await sql<Array<{ status: string }>>`select status from support_cases where id = ${c1.case_id}`;
    expect(status).toBe('closed');

    const audits = await sql<Array<{ action: string }>>`
      select action from audit_log where actor_id = ${admin} and action like 'program.%' order by id`;
    expect(audits.map((x) => x.action)).toEqual(['program.add', 'program.update', 'program.retire', 'program.reopen', 'program.update']);
  });
});
