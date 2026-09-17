// 사업별 보기(2026-09-17 Q). 새 표·새 페이지 없이 — 당사자 행의 program_id 와 실무자 목록의 ?program= 로 거른다.
// 사업 담당 실무자는 그 사업의 **열린** 사례 배정에서 파생된다.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { enabled, ensureProgram, req } from './voice-fixture.ts';

const GRANT = [{ domain: 'personal_data_collection_use', decision: 'grant' }];

describe.skipIf(!enabled)('program filters', () => {
  it('stamps program_id on participant rows and derives program workers from open-case assignments', async () => {
    const prefix = randomUUID();
    const [a, b, admin] = (
      await sql<Array<{ id: number }>>`insert into users (email, name, role) values
        (${prefix + '-a'}, '실무자 A', 'worker'), (${prefix + '-b'}, '실무자 B', 'worker'),
        (${prefix + '-admin'}, '관리자', 'admin') returning id`
    ).map((r) => r.id);
    const p1 = await ensureProgram(`필터 사업 1 ${prefix}`);
    const p2 = await ensureProgram(`필터 사업 2 ${prefix}`);
    const empty = await ensureProgram(`필터 사업 빈 ${prefix}`);

    const c1 = await (await req('/cases', a, 'POST', { name: '필터 합성 1', program_id: p1, consents: GRANT })).json();
    const c2 = await (await req('/cases', b, 'POST', { name: '필터 합성 2', program_id: p2, consents: GRANT })).json();
    // 사업 1 의 종결 사례. 종결된 사례의 담당은 사업 담당으로 세지 않는다.
    const closed = await (await req('/cases', b, 'POST', { name: '필터 합성 종결', program_id: p1, consents: GRANT })).json();
    expect((await req(`/cases/${closed.case_id}/close`, b, 'POST', { close_reason: '끝' })).status).toBe(200);

    const rows = await (await req('/participants', admin)).json();
    const byCase = new Map<number, { program_id: number; program_name: string }>(
      rows.map((r: { case_id: number; program_id: number; program_name: string }) => [r.case_id, r]),
    );
    expect(byCase.get(c1.case_id)).toMatchObject({ program_id: p1 });
    expect(byCase.get(c2.case_id)).toMatchObject({ program_id: p2 });
    expect(byCase.get(closed.case_id)).toMatchObject({ program_id: p1 });
    // 맡지 않은 행에도 사업은 실린다 — 임상 정보가 아니다.
    for (const r of rows) expect(typeof r.program_id).toBe('number');

    const workersOf = async (programId: number) =>
      ((await (await req(`/settings/workers?program=${programId}`, admin)).json()) as Array<{ id: number }>)
        .map((w) => w.id)
        .sort();
    expect(await workersOf(p1)).toEqual([a]);
    expect(await workersOf(p2)).toEqual([b]);
    expect(await workersOf(empty)).toEqual([]);

    // 배정을 더하면 그 사업의 실무자가 늘고, 빼면 준다.
    expect((await req('/settings/assign', admin, 'POST', { case_id: c1.case_id, user_ids: [a, b] })).status).toBe(200);
    expect(await workersOf(p1)).toEqual([a, b].sort());
    expect((await req('/settings/assign', admin, 'POST', { case_id: c1.case_id, user_ids: [b] })).status).toBe(200);
    expect(await workersOf(p1)).toEqual([b]);

    // 필터 없는 목록은 그대로 전부다.
    const everyone = (await (await req('/settings/workers', admin)).json()) as Array<{ id: number }>;
    for (const id of [a, b, admin]) expect(everyone.some((w) => w.id === id)).toBe(true);
    // 사업 목록의 사례 수도 id 로 센다.
    const programs = (await (await req('/settings/programs?all=1', admin)).json()) as Array<{ id: number; cases: number; open_cases: number }>;
    expect(programs.find((p) => p.id === p1)).toMatchObject({ cases: 2, open_cases: 1 });
    expect(programs.find((p) => p.id === empty)).toMatchObject({ cases: 0, open_cases: 0 });
    expect((await req('/settings/workers?program=abc', admin)).status).toBe(404);
  });
});
