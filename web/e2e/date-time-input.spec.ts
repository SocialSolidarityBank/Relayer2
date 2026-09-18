// 공유 일시 입력 회귀 — 인테이크와 기록 수정이 저장된 한국 시간을 그대로 다시 세우고,
// 달력 취소는 서버에 아무것도 보내지 않는다. 저장값은 API 응답으로 확인한다(화면 에코가 아니다).
// 브라우저 시간대를 한국 밖으로 둔다 — 한국 시간 저장이 브라우저 지역시각에 기대면 여기서 깨진다.
import { expect, test, type Page } from '@playwright/test';
import { expectDateTime, pickDateTime } from './date-time.ts';
import { createProgram } from './programs.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
test.use({ timezoneId: 'America/Los_Angeles' });

/** 로그인하고 인테이크·기록 저장에 필요한 동의까지 갖춘 합성 사례를 하나 만든다. */
const newCase = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
  const created = await page.request.post(`${api}/cases`, { data: {
    name: `일시 합성 ${Date.now()}`, program_id: await createProgram('일시 입력 검증'),
    consents: [
      { domain: 'personal_data_collection_use', decision: 'grant' },
      { domain: 'sensitive_information_processing', decision: 'grant' },
    ],
  } });
  expect(created.status()).toBe(201);
  return (await created.json()).case_id as number;
};

test('인테이크 일시는 한국 시간으로 저장되고 다시 열면 그대로 선다', async ({ page }) => {
  const caseId = await newCase(page);
  await page.goto(`/#/cases/${caseId}/intake`);
  await expect(page).toHaveURL(/\/intake$/);

  // 오전 12시 30분 — 12시제 경계(자정)에서 오전/오후를 틀리면 여기서 잡힌다.
  await pickDateTime(page, 'held-at', '2026-10-05T00:30');

  // 달력에서 다른 날을 골라도 취소하면 앞서 고른 날이 보존되고, 저장은 일어나지 않는다.
  await page.locator('#held-at-date').click();
  const dialog = page.getByRole('dialog', { name: '상담 날짜 선택', exact: true });
  await dialog.getByRole('button', { name: '2026년 10월 6일 화요일', exact: true }).click();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('#held-at-date')).toContainText('10월 5일');
  expect((await (await page.request.get(`${api}/cases/${caseId}/intake`)).json()).session_id).toBeNull();

  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  const saved = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(new Date(saved.held_at).toISOString()).toBe('2026-10-04T15:30:00.000Z');

  // 다시 열면 저장된 일시가 한국 시간 그대로 서 있다.
  await page.goto(`/#/cases/${caseId}/intake`);
  await expectDateTime(page, 'held-at', '2026-10-05T00:30');

  // 오후 12시 정각 — 12시제 경계(정오)도 오후 12시로 저장돼야 한다.
  await pickDateTime(page, 'held-at', '2026-10-05T12:00');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('tab', { name: '기본 정보' })).toBeVisible();
  const edited = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(edited.session_id).toBe(saved.session_id);
  expect(new Date(edited.held_at).toISOString()).toBe('2026-10-05T03:00:00.000Z');
});

test('기록 수정은 저장된 일시를 한국 시간으로 다시 세우고 취소는 저장하지 않는다', async ({ page }) => {
  const caseId = await newCase(page);

  // UTC 날짜와 한국 날짜가 다른 시각(10-19 15:05Z = 10-20 00:05 KST)으로 기록된 회차를 심는다.
  const planned = await page.request.post(`${api}/cases/${caseId}/sessions`, { data: {
    scheduled_at: '2026-10-19T01:00:00.000Z', method: 'in_person',
  } });
  expect(planned.status()).toBe(201);
  const { session_id: sessionId } = await planned.json();
  expect((await page.request.patch(`${api}/sessions/${sessionId}`, { data: {
    held_at: '2026-10-19T15:05:37.500Z', memo: '합성 상담 기록',
  } })).ok()).toBe(true);

  await page.goto(`/#/cases/${caseId}/sessions/${sessionId}/edit`);
  await expect(page).toHaveURL(/\/edit$/);
  // UTC 날짜(19일)가 아니라 한국 날짜(20일) 오전 12시 5분으로 서야 한다.
  await expectDateTime(page, 'held-at', '2026-10-20T00:05');

  // 다른 날을 고르고 Escape 로 닫으면 고른 날은 버려지고 서버도 그대로다.
  await page.locator('#held-at-date').click();
  const dialog = page.getByRole('dialog', { name: '상담 날짜 선택', exact: true });
  await dialog.getByRole('button', { name: '2026년 10월 21일 수요일', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#held-at-date')).toContainText('10월 20일');
  const untouched = await (await page.request.get(`${api}/sessions/${sessionId}`)).json();
  expect(new Date(untouched.held_at).toISOString()).toBe('2026-10-19T15:05:37.500Z');

  // 다른 내용만 고칠 때는 화면에 없는 초·밀리초까지 원래 시각을 유지한다.
  await page.locator('#memo').fill('일시는 그대로 두고 내용만 수정');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await expect(page.getByRole('tab', { name: '기본 정보' })).toBeVisible();
  const sameTime = await (await page.request.get(`${api}/sessions/${sessionId}`)).json();
  expect(new Date(sameTime.held_at).toISOString()).toBe('2026-10-19T15:05:37.500Z');
  await page.goto(`/#/cases/${caseId}/sessions/${sessionId}/edit`);
  await expectDateTime(page, 'held-at', '2026-10-20T00:05');

  // 고쳐 저장하면 새 일시가 한국 시간으로 반영된다.
  await pickDateTime(page, 'held-at', '2026-10-21T13:45');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await expect(page.getByRole('tab', { name: '기본 정보' })).toBeVisible();
  const edited = await (await page.request.get(`${api}/sessions/${sessionId}`)).json();
  expect(new Date(edited.held_at).toISOString()).toBe('2026-10-21T04:45:00.000Z');
});

test('기록 화면에서 날짜를 골라도 회차가 생기지 않는다', async ({ page }) => {
  const caseId = await newCase(page);
  await page.goto(`/#/cases/${caseId}/record`);
  await expect(page).toHaveURL(/\/record$/);

  // 날짜·시간을 채우는 것은 입력일 뿐 회차 시작이 아니다 — 저장·녹음·메모 입력이 회차를 연다.
  await pickDateTime(page, 'held-at', '2026-10-22T09:00');
  const view = await (await page.request.get(`${api}/cases/${caseId}`)).json();
  expect(view.sessions).toHaveLength(0);
});
