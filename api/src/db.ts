import postgres from 'postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://relayer:relayer@localhost:55432/relayer';

/**
 * 관리형 Postgres(Supabase 등)는 TLS 를 요구하고, 풀러를 거치면 prepared statement 를 못 쓴다.
 * 접속 주소로 판별한다 — 배포마다 손으로 켜고 끄게 하지 않는다.
 *  · `sslmode=require` 또는 supabase 주소 → TLS
 *  · 풀러 포트(6543, transaction 모드) → prepare 끔
 */
const isManaged = /supabase\.(co|com)|sslmode=require/.test(DATABASE_URL);
const isTransactionPooler = /:6543\b/.test(DATABASE_URL);

export const sql = postgres(DATABASE_URL, {
  ssl: isManaged ? 'require' : undefined,
  prepare: !isTransactionPooler,
  onnotice: () => {},
  types: {
    // int8 은 기본값이 문자열이라 id 비교가 조용히 어긋난다. 식별자 범위는 안전 정수 안이다.
    bigint: { to: 20, from: [20], serialize: String, parse: Number },
  },
});

export type Sql = typeof sql;
