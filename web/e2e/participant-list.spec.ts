import { expect, test } from '@playwright/test';
import { createProgram } from './programs.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';

// Exercise real list responses: names, recording state and access boundaries must
// survive the switch from collapsed actions to the CCC name-first card.
test('이름 중심 목록에서 정보를 바로 보고 상세와 기록·일정으로 이동한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();

  const name = `가나다 목록 검증 ${Date.now()}`;
  const program = `목록 검증 사업 ${Date.now()}`;
  const created = await page.request.post(`${api}/cases`, { data: {
    name, program_id: await createProgram(program),
    consents: [
      { domain: 'personal_data_collection_use', decision: 'grant' },
      { domain: 'sensitive_information_processing', decision: 'grant' },
    ],
  } });
  expect(created.status()).toBe(201);
  const { case_id: caseId } = await created.json();
  expect((await page.request.put(`${api}/cases/${caseId}/intake`, { data: { memo: '합성 인테이크' } })).ok()).toBe(true);
  const nextAt = new Date(Date.now() + 2 * 86400000).toISOString();
  expect((await page.request.post(`${api}/cases/${caseId}/sessions`, { data: {
    scheduled_at: nextAt, method: 'phone',
  } })).status()).toBe(201);

  await page.goto('/#/participants');
  const card = page.getByRole('link', { name: `${name}, ${program}, 당사자 정보`, exact: true });
  await expect(card.getByText(name, { exact: true })).toBeVisible();
  // 카드는 두 줄이다(2026-09-17 Q): `가명 · 사업명 N회차` / `연락처 · 이메일 · 다음 상담`.
  // 담당 실무자는 카드에서 걷었다 — 위 걸개가 가른다.
  await expect(card.locator('.participant-card-id')).toHaveText(new RegExp(`^[a-z]+-\\d+ \\| ${program} 1회차$`));
  await expect(card.locator('.participant-card-reach')).toHaveText(/다음 상담 \d+월 \d+일/);
  await expect(card.getByText('예정 없음', { exact: true })).toHaveCount(0);

  // 현황판은 걸개 아래에서 지금 무엇을 보고 있는지 말한다(종결은 세지 않는다).
  const stats = page.locator('.participant-stats');
  for (const label of ['보이는 사람', '전체', '진행 중', '배정 필요', '담당 실무자']) {
    await expect(stats.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(stats).not.toContainText('종결');

  // 한 쪽은 열 장이다. 그보다 많으면 가운데 쪽 넘기기가 선다.
  await expect(page.getByRole('article')).toHaveCount(10);
  const pager = page.getByRole('navigation', { name: '쪽 넘기기', exact: true });
  await expect(pager).toContainText('1 /');
  await pager.getByRole('button', { name: '다음 쪽', exact: true }).click();
  await expect(pager).toContainText('2 /');
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '내가 맡기', exact: true })).toHaveCount(0);

  await page.getByLabel('찾기', { exact: true }).fill(name);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/info$`));
  await expect(page.getByRole('tab', { name: '당사자 정보', exact: true })).toBeVisible();

  for (const [pick, destination, title] of [
    ['record', 'record', '상담 기록하기'],
    ['schedule', 'schedule', '상담 일정 등록'],
  ]) {
    await page.goto(`/#/pick/${pick}`);
    await page.locator('#q').fill(name);
    await page.getByRole('link', { name: `${name}, ${program}, ${title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/${destination}$`));
    // 화면 이름은 더 이상 제목이 아니다 — 당사자 카드가 머리이고 제목은 사람 이름이다(2026-09-17 Q).
    await expect(page.getByRole('heading', { name, level: 1, exact: true })).toBeVisible();
  }

  // ── 걸개와 정렬(2026-09-17 Q) ────────────────────────────────
  await page.goto('/#/participants');
  await page.getByLabel('사업명 걸개', { exact: true }).selectOption(program);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText(name);
  await page.getByLabel('상태 걸개', { exact: true }).selectOption('closed');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByLabel('상태 걸개', { exact: true }).selectOption('all');
  await page.getByLabel('사업명 걸개', { exact: true }).selectOption('all');
  // 정렬은 다음 상담이 있는 사람을 앞으로 올린다 — 이 사람은 이틀 뒤 일정이 있다.
  await page.getByLabel('정렬', { exact: true }).selectOption('date_asc');
  await expect(page.getByRole('article').first()).toContainText('월');
  await page.getByLabel('정렬', { exact: true }).selectOption('name');

  // Revoking membership changes the live list response. A card must not pretend
  // that hidden records are empty, retain the old name, or offer self-assignment.
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.locator('#email').fill('test1');
  await page.locator('#password').fill('test1');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toHaveText('시험 관리자');
  expect((await page.request.post(`${api}/settings/assign`, { data: { case_id: caseId, user_ids: [] } })).ok()).toBe(true);
  await page.goto('/#/participants');
  await page.getByLabel('찾기', { exact: true }).fill(program);
  const restricted = page.getByRole('article').filter({ hasText: program });
  await expect(restricted.getByText('배정 필요', { exact: true })).toBeVisible();
  await expect(restricted.getByText(name, { exact: true })).toHaveCount(0);
  await expect(restricted.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(program) })).toHaveCount(0);
  await expect(restricted.getByText('기록 없음', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '내가 맡기', exact: true })).toHaveCount(0);
});
