// 사례는 이름이 아니라 사업 id 로 묶인다(0024). API 로 사례를 만드는 시험은 여기서 사업 id 를 얻는다.
import { request } from '@playwright/test';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

/**
 * 이름을 정한 사업 하나. 사업은 관리자만 만들 수 있어 시드 관리자(test1)로 따로 로그인한 요청 문맥을 쓴다 —
 * 시험 중인 페이지의 쿠키(실무자)는 건드리지 않는다. 같은 이름이 이미 있으면 그 id 를 돌려준다.
 */
export async function createProgram(name: string): Promise<number> {
  const admin = await request.newContext({ baseURL: base });
  try {
    const login = await admin.post(`${api}/auth/login`, { data: { email: 'test1', password: 'test1' } });
    if (!login.ok()) throw new Error(`admin login failed: ${login.status()}`);
    const made = await admin.post(`${api}/settings/programs`, { data: { name } });
    if (made.status() === 201) return ((await made.json()) as { id: number }).id;
    if (made.status() !== 409) throw new Error(`program create failed: ${made.status()}`);
    const rows = (await (await admin.get(`${api}/settings/programs?all=1`)).json()) as Array<{ id: number; name: string }>;
    const found = rows.find((p) => p.name === name);
    if (!found) throw new Error(`program ${name} not found after 409`);
    return found.id;
  } finally {
    await admin.dispose();
  }
}
