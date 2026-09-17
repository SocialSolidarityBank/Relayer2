// 첫 가입 → 마법사 네 단계 → 당사자 등록 → 담당 배정 → 사업별 필터 링크(2026-09-17 Q).
// **seed 없는 새 DB** 에서만 뜻이 있는 흐름이라 DB 와 API 서버를 따로 띄우고, 화면은 빌드된 dist 를
// 그 서버가 같은 출처로 낸다(배포와 같은 모양). 다른 e2e 처럼 :5173 시드 서버를 쓰지 않는다.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { scratchDb, startServer, type Scratch } from '../../api/test/scratch-db.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = Date.now();
const ORG = `E2E 기관 ${stamp}`;
const PROGRAM = `E2E 사업 ${stamp}`;
const PARTICIPANT = `E2E 당사자 ${stamp}`;

let scratch: Scratch;
let base: string;
let stop: () => void;

test.beforeAll(async () => {
  // 서버가 내는 화면은 web/dist 다. 지금 코드로 다시 짓는다.
  execFileSync('pnpm', ['--dir', 'web', 'build'], { cwd: root, stdio: 'ignore' });
  scratch = await scratchDb();
  await scratch.migrate();
  ({ base, stop } = await startServer(scratch.url));
});
test.afterAll(async () => {
  stop?.();
  await scratch?.drop();
});

// 가입부터 사업별 필터까지 한 시험 안에서 잇는다 — 화면이 열 개 남짓이라 기본 60초로는 빠듯하다.
test.setTimeout(180_000);

test('첫 가입에서 마법사, 당사자 등록, 배정, 사업별 필터까지 한 바퀴', async ({ page }) => {
  // ── 가입 문 ─────────────────────────────────────────────────
  await page.goto(`${base}/`);
  // 활성 관리자가 없으니 로그인 화면에 첫 가입 문이 보인다.
  await page.getByRole('link', { name: '기관 만들고 시작하기' }).click();
  await expect(page).toHaveURL(/#\/signup$/);
  await page.locator('#su-org').fill(ORG);
  await page.locator('#su-slug').fill(`e2e-${stamp}`);
  await page.locator('#su-email').fill('e2e-admin');
  await page.locator('#su-pw').fill('e2e-admin');
  await page.locator('#su-name').fill('E2E 관리자');
  await page.getByRole('button', { name: '기관 만들고 시작하기' }).click();

  // ── 마법사 가두기 ──────────────────────────────────────────
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole('heading', { name: '기관 준비', level: 1 })).toBeVisible();
  // 마치기 전에 다른 화면으로 가면 마법사로 돌아온다.
  await page.goto(`${base}/#/participants`);
  await expect(page).toHaveURL(/#\/onboarding$/);

  // 1. 기관 정보 — 이름은 가입에서 이미 들어왔다. 나머지를 적고 저장해야 다음이 열린다.
  await expect(page.locator('#og-name')).toHaveValue(ORG);
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.locator('#og-reg').fill('123-45-67890');
  await page.locator('#og-addr').fill('서울시 어딘가 1');
  await page.locator('#og-tel').fill('02-000-0000');
  await page.getByRole('button', { name: '저장하기' }).click();
  await expect(page.getByText('저장했어요.')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // 2. 사업 — 하나 이상 있어야 다음이 열린다.
  await expect(page.getByRole('tab', { name: '사업', selected: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.locator('#pg-new-name').fill(PROGRAM);
  await page.locator('#pg-new-start').fill('2026-01-01');
  await page.locator('#pg-new-desc').fill('마법사에서 만든 사업');
  await page.getByRole('button', { name: '사업 추가하기' }).click();
  await expect(page.getByText(PROGRAM, { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // 3. 실무자 초대 — 건너뛴다.
  await expect(page.getByRole('tab', { name: '실무자 초대', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '초대 링크 만들기' })).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // 4. API 연결 — 키만 넣으면 되는 것과 설치가 필요한 것이 갈려 보인다. 확인만 하고 마친다.
  await expect(page.getByRole('tab', { name: 'API 연결', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '키만 넣으면 되는 것' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '설치가 필요한 것' })).toBeVisible();
  await page.getByRole('button', { name: '마치기' }).click();

  // ── 당사자 등록 ─────────────────────────────────────────────
  await expect(page).toHaveURL(/#\/participants\/new$/);
  await page.locator('#name').fill(PARTICIPANT);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  // 사업이 하나뿐이라 이미 골라져 있다.
  await expect(page.locator('#program')).toHaveValue(/^\d+$/);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/#\/cases\/\d+\/intake$/);

  // 마법사를 마쳤으니 이제 다른 화면으로 가도 되돌아오지 않는다.
  await page.goto(`${base}/#/participants`);
  await expect(page).toHaveURL(/#\/participants$/);

  // ── 관리자 배정 ─────────────────────────────────────────────
  await page.goto(`${base}/#/settings/staff`);
  const assignCard = page.locator('section.wire-card', { hasText: '담당 실무자 배정' });
  await assignCard.getByRole('button', { name: '담당 고르기' }).first().click();
  // 등록한 사람이 첫 담당이다 — 이미 켜져 있다. 저장으로 배정을 확정한다.
  await expect(assignCard.getByRole('checkbox', { name: /E2E 관리자/ })).toBeChecked();
  await assignCard.getByRole('button', { name: '저장하기' }).click();
  await expect(assignCard.getByText(/담당 E2E 관리자/)).toBeVisible();

  // ── 사업별 보기 ─────────────────────────────────────────────
  await page.goto(`${base}/#/settings/org`);
  const programsCard = page.locator('section.wire-card', { hasText: '사업 목록' });
  await programsCard.getByRole('button', { name: `${PROGRAM} 자세히` }).click();
  await expect(programsCard.getByText('마법사에서 만든 사업', { exact: true })).toBeVisible();
  await expect(programsCard.getByText('참여 당사자')).toBeVisible();
  await expect(programsCard.getByText('E2E 관리자', { exact: true })).toBeVisible();
  await programsCard.getByRole('link', { name: '당사자 목록' }).click();
  await expect(page).toHaveURL(/#\/participants\?program=\d+$/);
  // 걸개가 그 사업으로 걸린 채 열린다.
  const programId = new URL(page.url()).hash.match(/program=(\d+)/)![1];
  await expect(page.locator('#filter-program')).toHaveValue(programId);
  await expect(page.getByRole('link', { name: new RegExp(`^${PARTICIPANT},`) })).toBeVisible();

  await page.goBack();
  await programsCard.getByRole('button', { name: `${PROGRAM} 자세히` }).click();
  await programsCard.getByRole('link', { name: '실무자 목록' }).click();
  await expect(page).toHaveURL(new RegExp(`#/settings/staff\\?program=${programId}$`));
  await expect(page.locator('#wk-program')).toHaveValue(programId);
  const workers = page.locator('section.wire-card', { hasText: '실무자 목록' });
  await expect(workers.getByRole('cell', { name: 'E2E 관리자', exact: true })).toBeVisible();

  // ── 가입 문은 닫혔다 ────────────────────────────────────────
  const gate = await page.request.get(`${base}/auth/signup`);
  expect(await gate.json()).toEqual({ open: false });
});
