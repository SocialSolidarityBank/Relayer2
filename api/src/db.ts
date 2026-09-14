import postgres from 'postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://relayer:relayer@localhost:55432/relayer';

export const sql = postgres(DATABASE_URL, {
  onnotice: () => {},
  types: {
    // int8 은 기본값이 문자열이라 id 비교가 조용히 어긋난다. 식별자 범위는 안전 정수 안이다.
    bigint: { to: 20, from: [20], serialize: String, parse: Number },
  },
});

export type Sql = typeof sql;
