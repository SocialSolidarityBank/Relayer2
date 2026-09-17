// 시험 전용 새 DB(2026-09-17). 가입 문(활성 관리자 0명)과 0024 백필은 **공유 시험 DB 로 볼 수 없다** —
// 다른 파일이 같은 DB 에 관리자를 만들고 있고, 이미 0024 가 적용돼 있다. 그래서 DB 를 하나 새로 만든다.
// 같은 로컬 Postgres 서버에 `relayer_shared_check_` 접두로 만들고 끝나면 지운다.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import postgres, { type Sql } from 'postgres';
import { DATABASE_URL } from '../src/db.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = join(root, 'migrations');

export type Scratch = {
  url: string;
  db: Sql;
  /** `version` 보다 작은(또는 전부) 미적용 마이그레이션을 순서대로 적용한다. */
  migrate(before?: string): Promise<string[]>;
  drop(): Promise<void>;
};

export async function scratchDb(): Promise<Scratch> {
  const server = new URL(DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(server.hostname)) throw new Error('scratch DB must be local');
  server.pathname = '/postgres';
  const control = postgres(server.toString(), { onnotice: () => {} });
  const name = `relayer_shared_check_scratch_${randomUUID().replace(/-/g, '')}`;
  await control.unsafe(`create database "${name}"`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { onnotice: () => {} });
  await db`create table if not exists schema_migrations (
    version text primary key, applied_at timestamptz not null default now())`;
  return {
    url: url.toString(),
    db,
    async migrate(before) {
      const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
      const done = new Set((await db<Array<{ version: string }>>`select version from schema_migrations`).map((r) => r.version));
      const todo = files.filter((f) => !done.has(f) && (before === undefined || f < before));
      for (const file of todo) {
        const body = await readFile(join(migrationsDir, file), 'utf8');
        await db.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`insert into schema_migrations (version) values (${file})`;
        });
      }
      return todo;
    },
    async drop() {
      await db.end();
      await control.unsafe(`drop database "${name}" with (force)`);
      await control.end();
    },
  };
}

/** 새 DB 를 바라보는 API 서버 한 프로세스. 가입 문은 실제 서버로 두드린다(app.request 는 공유 sql 에 묶여 있다). */
export async function startServer(databaseUrl: string): Promise<{ base: string; stop(): void }> {
  const { promise: freePort, resolve, reject } = Promise.withResolvers<number>();
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
  });
  const port = await freePort;
  const child: ChildProcess = spawn(process.execPath, ['api/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGSCHEMA: '',
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'scratch-only',
      PII_ENC_KEY: process.env.PII_ENC_KEY ?? Buffer.alloc(32).toString('base64'),
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* 아직 안 떴다 */
    }
    if (Date.now() > until) {
      child.kill();
      throw new Error('scratch server did not start');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, stop: () => void child.kill() };
}
