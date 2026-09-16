// 0023 이 적용된 DB 의 모양. 컬럼이 있고 기존 행이 전사문 유무대로 채워졌는지 본다.
import { describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { enabled } from './voice-fixture.ts';

describe.skipIf(!enabled)('migration 0023', () => {
  it('adds transcribe_state with a closed value set and backfills done where a transcript exists', async () => {
    const cols = await sql<Array<{ column_name: string; column_default: string | null; is_nullable: string }>>`
      select column_name, column_default, is_nullable from information_schema.columns
      where table_name = 'recordings' and column_name in ('transcribe_state', 'transcribe_note')`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(['transcribe_note', 'transcribe_state']);
    expect(cols.find((c) => c.column_name === 'transcribe_state')?.is_nullable).toBe('NO');
    const [check] = await sql<Array<{ def: string }>>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'recordings'::regclass and pg_get_constraintdef(oid) like '%transcribe_state%'`;
    for (const v of ['pending', 'done', 'failed', 'skipped']) expect(check.def).toContain(v);
    // 자동 전사 이전 물건은 skipped 로 둔다 — 실패한 적 없는 것을 failed 라 적지 않는다.
    expect(cols.find((c) => c.column_name === 'transcribe_state')?.column_default).toContain('skipped');
    const [applied] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from schema_migrations where version = '0023_recording_transcribe_state.sql'`;
    expect(applied.n).toBe(1);
  });
});
