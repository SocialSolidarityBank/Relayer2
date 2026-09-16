// 녹음 시작 = 회차 생성(2026-09-16 인계 §4). 가짜 마이크로 녹음을 시작하면 그 순간
// 회차가 생기고, 멈추면 녹음이 그 회차에 붙는다. 회차별 요약에 수기 미작성·녹음·전사
// 상태가 보이고, 전문 보기에서 수기·음성 전문을 읽고 돌아온다.
// 루트 서버(VOICE_ENABLED=1, STT 키 없음 → 전사 skipped)에 붙여 돌린다.
import { expect, test } from '@playwright/test';

// 다른 spec 과 같은 규약이다 — 같은 원점에서 화면과 API 를 함께 내는 서버(dist 를 얹은
// api :8798)에서는 접두 `/api` 가 없다. 하드코딩하면 그 서버에서 404 를 JSON 으로 읽는다.
const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';

// 이 spec 에서만 가짜 마이크를 켠다 — 다른 spec 의 브라우저에는 영향이 없다.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

const stamp = Date.now();
const NAME = `E2E 녹음${stamp}`;

test('녹음 시작이 회차를 만들고 요약과 전문 보기로 이어진다', async ({ page }) => {
  // ── 로그인 ──────────────────────────────────────────────────
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '일정', exact: true })).toBeVisible();

  // ── 당사자 등록(녹음·STT 동의 포함) ─────────────────────────
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(NAME);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('checkbox', { name: /상담 녹음/ }).check();
  await page.getByRole('checkbox', { name: /외부 STT 처리/ }).check();
  await page.getByRole('checkbox', { name: /음성 원본 보유기간/ }).check();
  await page.locator('#program').selectOption({ index: 1 });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();
  const caseId = page.url().match(/#\/cases\/(\d+)\/intake/)?.[1];
  expect(caseId).toBeTruthy();

  // ── 상담 기록하기 — 녹음 시작이 곧 회차 ─────────────────────
  // 인테이크는 건너뛴다 — 시작 경로가 만드는 회차가 1회차다.
  await page.goto(`/#/cases/${caseId}/record`);
  await expect(page.getByRole('heading', { name: '상담 기록하기' })).toBeVisible();
  await expect(page.locator('.page-header')).toContainText('1회차');

  await page.getByRole('button', { name: '녹음 시작' }).click();
  await expect(page.getByText('녹음 중')).toBeVisible();
  // 회차는 시작과 함께 생긴다 — 멈추기 전에 이미 서버에 있다.
  await expect
    .poll(async () => {
      const res = await page.request.get(`${api}/cases/${caseId}/detail`);
      const detail = (await res.json()) as {
        sessions: Array<{ status: string; written: boolean }>;
      };
      return detail.sessions.filter((s) => s.status === 'done').length;
    })
    .toBe(1);

  await page.getByRole('button', { name: '녹음 멈춤' }).click();
  await expect(page.locator('audio')).toHaveCount(1);
  // STT 키가 없는 서버라 자동 전사는 건너뛴다.
  await expect(page.getByText('전사 건너뜀')).toBeVisible();

  // ── 회차별 요약 — 수기 미작성·녹음 1·전사 상태 ──────────────
  await page.goto(`/#/cases/${caseId}/info`);
  const row = page.locator('.wire-repeat-card', { hasText: '1회차' });
  await expect(row).toContainText('수기 미작성');
  await expect(row).toContainText('녹음 1');
  await expect(row).toContainText('전사 건너뜀');

  // ── 전문 보기 — 수기 미작성·재생·전사 상태 ──────────────────
  await row.getByRole('button', { name: '전문 보기' }).click();
  await expect(page.getByRole('heading', { name: '수기·음성 전문' })).toBeVisible();
  await expect(page.locator('.page-header')).toContainText('1회차');
  await expect(page.locator('section.wire-card', { hasText: '수기 기록' })).toContainText(
    '수기 미작성',
  );
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(
    page.locator('section.wire-card', { hasText: '음성' }),
  ).toContainText('전사 건너뜀');

  // ── 뒤로 — 회차별 요약으로 돌아온다 ─────────────────────────
  await page.getByRole('button', { name: '회차별 요약으로' }).click();
  await expect(page.getByRole('heading', { name: '당사자 정보' })).toBeVisible();
  await expect(page.locator('.wire-repeat-card', { hasText: '1회차' })).toContainText('녹음 1');
});
