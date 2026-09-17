// 0024 의 백필 규칙. 공유 시험 DB 는 이미 0024 가 지나갔으니 새 DB 를 0023 까지 올린 뒤
// 옛 모양(program_name 문자열)의 사례를 심고 0024 를 적용해 결과를 본다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enabled } from './voice-fixture.ts';
import { scratchDb, type Scratch } from './scratch-db.ts';

let scratch: Scratch;

describe.skipIf(!enabled)('migration 0024', () => {
  beforeAll(async () => {
    scratch = await scratchDb();
    await scratch.migrate('0024');
  }, 60_000);
  afterAll(async () => {
    await scratch?.drop();
  });

  it('turns program_name into a NOT NULL program_id, backfills missing and blank names, and marks existing deployments onboarded', async () => {
    const { db } = scratch;
    // 0016 이 옮긴 사업 하나, 목록에 없는 이름 하나, 빈 이름 하나.
    await db`insert into programs (name) values ('목록에 있던 사업')`;
    const [p] = await db<Array<{ id: number }>>`insert into participants (pseudonym) values ('m-001') returning id`;
    const [{ id: listed }] = await db<Array<{ id: number }>>`
      insert into support_cases (participant_id, program_name) values (${p.id}, '목록에 있던 사업') returning id`;
    const [{ id: unlisted }] = await db<Array<{ id: number }>>`
      insert into support_cases (participant_id, program_name) values (${p.id}, '자유 입력 사업') returning id`;
    const [{ id: blank }] = await db<Array<{ id: number }>>`
      insert into support_cases (participant_id, program_name) values (${p.id}, '') returning id`;
    // 기존 배포 = 기관 이름과 관리자가 있다. 마법사와 첫 가입 문을 둘 다 건너뛰어야 한다.
    await db`update organization set name = '기존 기관' where id = 1`;
    await db`insert into users (email, name, role) values ('old-admin', '기존 관리자', 'admin')`;

    expect(await scratch.migrate()).toEqual(['0024_onboarding_programs.sql']);

    const caseCols = await db<Array<{ column_name: string; is_nullable: string }>>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'support_cases' and column_name in ('program_name', 'program_id')`;
    expect(caseCols).toEqual([{ column_name: 'program_id', is_nullable: 'NO' }]);

    const programCols = await db<Array<{ column_name: string }>>`
      select column_name from information_schema.columns
      where table_name = 'programs' and column_name in ('starts_on', 'ends_on', 'description') order by 1`;
    expect(programCols.map((c) => c.column_name)).toEqual(['description', 'ends_on', 'starts_on']);

    const rows = await db<Array<{ id: number; name: string; retired_at: string | null }>>`
      select c.id, p.name, p.retired_at from support_cases c join programs p on p.id = c.program_id order by c.id`;
    expect(rows).toEqual([
      { id: listed, name: '목록에 있던 사업', retired_at: null },
      { id: unlisted, name: '자유 입력 사업', retired_at: null },
      { id: blank, name: '(미지정)', retired_at: expect.anything() },
    ]);

    // 기존 배포: 이름이 있으니 마법사를 지난 것으로, 관리자가 있으니 첫 가입 문은 닫힌 것으로 본다.
    const [org] = await db<Array<{ onboarded_at: Date | null; bootstrap_closed_at: Date | null }>>`
      select onboarded_at, bootstrap_closed_at from organization where id = 1`;
    expect(org.onboarded_at).not.toBeNull();
    expect(org.bootstrap_closed_at).not.toBeNull();

    // 기간 검사 제약이 붙었다.
    await expect(
      db`insert into programs (name, starts_on, ends_on) values ('거꾸로', '2026-12-01', '2026-01-01')`,
    ).rejects.toThrow(/programs_period_check/);

    const [applied] = await db<Array<{ n: number }>>`
      select count(*)::int as n from schema_migrations where version = '0024_onboarding_programs.sql'`;
    expect(applied.n).toBe(1);
  });
});
