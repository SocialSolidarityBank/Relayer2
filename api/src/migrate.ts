// 순번 SQL 파일을 순서대로 적용한다. 두 번 적용해도 안전하다.
// `--check` 는 미적용 마이그레이션이 없을 때만 종료 코드 0.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './db.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function pending(): Promise<string[]> {
  await sql`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`;
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = await sql<{ version: string }[]>`select version from schema_migrations`;
  const done = new Set(applied.map((r) => r.version));
  return files.filter((f) => !done.has(f));
}

const checkOnly = process.argv.includes('--check');
const todo = await pending();

if (checkOnly) {
  if (todo.length > 0) {
    console.error(`pending migrations: ${todo.join(', ')}`);
    await sql.end();
    process.exit(1);
  }
  console.log('migrations up to date');
} else {
  for (const file of todo) {
    const body = await readFile(join(migrationsDir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (version) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log(todo.length === 0 ? 'nothing to apply' : `applied ${todo.length} migration(s)`);
}

await sql.end();
