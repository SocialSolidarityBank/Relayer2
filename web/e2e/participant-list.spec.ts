import { expect, test } from '@playwright/test';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';

// Exercise real list responses: names, recording state and access boundaries must
// survive the switch from collapsed actions to the CCC name-first card.
test('이름 중심 목록에서 정보를 바로 보고 상세와 기록·일정으로 이동한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '일정', level: 1, exact: true })).toBeVisible();

  const name = `가나다 목록 검증 ${Date.now()}`;
  const program = `목록 검증 사업 ${Date.now()}`;
  const created = await page.request.post(`${api}/cases`, { data: {
    name, program_name: program,
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
  await expect(card.getByText(program, { exact: true })).toBeVisible();
  await expect(card.getByText('시험 실무자', { exact: true })).toBeVisible();
  await expect(card.getByText('1회차까지 기록', { exact: true })).toBeVisible();
  await expect(card.getByText('다음 상담', { exact: true })).toBeVisible();
  await expect(card.getByText('예정 없음', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '내가 맡기', exact: true })).toHaveCount(0);

  await page.getByLabel('찾기', { exact: true }).fill(name);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/info$`));
  await expect(page.getByRole('tab', { name: '내 정보', exact: true })).toBeVisible();

  for (const [pick, destination, title] of [
    ['record', 'record', '상담 기록하기'],
    ['schedule', 'schedule', '상담 일정 등록'],
  ]) {
    await page.goto(`/#/pick/${pick}`);
    await page.getByRole('link', { name: `${name}, ${program}, ${title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/${destination}$`));
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible();
  }

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
