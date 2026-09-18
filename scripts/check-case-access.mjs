// Runs the case-access/audio regression suite in a disposable localhost database.
// Never connects to the application's .env or production database.
// Extra argv goes to vitest as-is — `node scripts/check-case-access.mjs test/foo.integration.test.ts` runs one file.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const postgres = createRequire(new URL('../api/package.json', import.meta.url))('postgres');
const source = new URL(process.env.CHECK_DATABASE_URL ?? 'postgres://relayer:relayer@localhost:55432/postgres');
assert(['localhost', '127.0.0.1'].includes(source.hostname), 'Only a localhost PostgreSQL instance is allowed');
source.pathname = '/postgres';
const control = postgres(source.toString(), { onnotice: () => {} });
const database = `relayer_shared_check_${process.pid}_${Date.now()}`;
const storage = await mkdtemp(join(tmpdir(), 'relayer-case-check-'));
let db;
let created = false;
try {
  await control.unsafe(`create database "${database}"`);
  created = true;
  const url = new URL(source);
  url.pathname = `/${database}`;
  db = postgres(url.toString(), { onnotice: () => {} });
  await db`create table schema_migrations(version text primary key, applied_at timestamptz not null default now())`;
  for (const file of (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql') && f < '0019').sort()) {
    const body = await readFile(join(root, 'migrations', file), 'utf8');
    await db.begin(async tx => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations(version) values(${file})`;
    });
  }
  const [owner] = await db`insert into users(email,name,role) values('migration-owner','이관 실무자','worker') returning id`;
  const [participant] = await db`insert into participants(pseudonym) values('migration-001') returning id`;
  const [legacy] = await db`insert into support_cases(participant_id,program_name,assigned_user_id) values(${participant.id},'이관 검증',${owner.id}) returning id`;
  await db`insert into participant_access(participant_id,token,code_hash,expires_at,created_by)
    values(${participant.id},'legacy-unscoped','unused',now()+interval '1 day',null)`;
  const env = { ...process.env, DATABASE_URL: url.toString(), PGSCHEMA: '',
    SESSION_SECRET: 'disposable-regression-only', PII_ENC_KEY: Buffer.alloc(32).toString('base64'),
    RELAYER_INTEGRATION: '1', VOICE_ENABLED: '1', VOICE_ROOT: join(storage, 'voice'),
    DOC_ROOT: join(storage, 'documents'), AZURE_SPEECH_KEY: '', AZURE_SPEECH_REGION: '', AZURE_SPEECH_ENDPOINT: '' };
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    assert.equal(result.status, 0, `${command} failed`);
  };
  run(process.execPath, ['api/src/migrate.ts']);
  const [assignment] = await db`select user_id from case_assignments where case_id=${legacy.id}`;
  assert.equal(String(assignment.user_id), String(owner.id));
  const [oldLink] = await db`select revoked_at from participant_access where token='legacy-unscoped'`;
  assert(oldLink.revoked_at, 'Unscoped legacy links must be revoked during migration');
  console.log('Assignment and legacy-link migration checks passed');
  run('pnpm', ['--dir', 'api', 'exec', 'vitest', 'run', ...process.argv.slice(2)]);
} finally {
  if (db) await db.end();
  if (created) await control.unsafe(`drop database "${database}" with (force)`);
  await control.end();
  await rm(storage, { recursive: true, force: true });
}
