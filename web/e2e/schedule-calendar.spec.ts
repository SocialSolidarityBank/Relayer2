import { expect, test } from '@playwright/test';
import { createProgram } from './programs.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
test.use({ timezoneId: 'America/Los_Angeles' });

test('날짜 선택은 저장하지 않고, 취소를 보존하며 한국 시간으로 일정을 저장한다', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T15:30:00Z') });
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
  const created = await page.request.post(`${api}/cases`, { data: {
    name: `달력 합성 ${Date.now()}`, program_id: await createProgram('달력 입력 검증'),
    consents: [{ domain: 'personal_data_collection_use', decision: 'grant' }],
  } });
  expect(created.status()).toBe(201);
  const { case_id: caseId } = await created.json();
  await page.goto(`/#/cases/${caseId}/schedule`);
  const open = page.getByRole('button', { name: /^상담 날짜 선택:/ });
  const dialog = page.getByRole('dialog', { name: '상담 날짜 선택', exact: true });
  await open.click();
  await expect(dialog.getByText('2027년 1월', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '2027년 1월 31일 일요일', exact: true }).click();
  await dialog.getByRole('button', { name: '선택 완료', exact: true }).click();
  await open.click();
  await dialog.getByRole('button', { name: '다음 달', exact: true }).click();
  await dialog.getByRole('button', { name: '2027년 2월 2일 화요일', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect(open).toContainText('1월 31일');
  expect((await (await page.request.get(`${api}/cases/${caseId}`)).json()).sessions).toHaveLength(0);
  await page.locator('#schedule-period').selectOption('오전');
  await page.locator('#schedule-hour').selectOption('12');
  await page.locator('#schedule-minute').selectOption('15');
  await page.getByRole('radio', { name: '전화', exact: true }).check();
  await page.getByRole('button', { name: '일정 저장', exact: true }).click();
  // 저장 뒤 도착지는 상담 일정 보기다(2026-09-17 Q — 잇달아 잡는 일이 많다).
  await expect(page).toHaveURL(/#\/schedule$/);
  const saved = await (await page.request.get(`${api}/cases/${caseId}`)).json();
  expect(saved.sessions).toHaveLength(1);
  expect(new Date(saved.sessions[0].scheduled_at).toISOString()).toBe('2027-01-30T15:15:00.000Z');
  expect(saved.sessions[0].method).toBe('phone');
  expect(saved.sessions[0].place).toBeNull();
});
