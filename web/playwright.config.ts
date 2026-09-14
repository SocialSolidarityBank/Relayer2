import { defineConfig } from '@playwright/test';

// 베타 관문 1 검증용. 서버(api :8787 · web :5173)와 Postgres 는 미리 떠 있어야 한다.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:5173', locale: 'ko-KR' },
});
