// 상담 일정 화면 — 월간(기본)·주간·일간 보기와 기간 이동을 실제 API 응답으로 검증한다.
// 시계는 2026-10-01 00:30 KST(UTC 9-30 15:30, LA 9-30 08:30)에 고정한다 — UTC·로컬 날짜가
// 한국 날짜와 어긋나는 지점이라, 화면이 한국 시간을 안 쓰면 기본 달이 9월로 잘못 열린다.
// 합성 자료만 쓰고, 다른 spec 과 겹치지 않게 날짜·이름을 고유하게 잡는다.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProgram } from './programs.ts';
import { pickDate } from './date-time.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
test.use({ timezoneId: 'America/Los_Angeles' });

const NOW = new Date('2026-09-30T15:30:00.000Z'); // KST 2026-10-01 00:30
const KST = (day: string, time: string) => `${day}T${time}:00+09:00`;

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
};

const makeCase = async (page: Page, name: string): Promise<number> => {
  const created = await page.request.post(`${api}/cases`, { data: {
    name, program_id: await createProgram('달력 보기 검증'),
    consents: [{ domain: 'personal_data_collection_use', decision: 'grant' }],
  } });
  expect(created.status()).toBe(201);
  return (await created.json()).case_id;
};

const plan = async (page: Page, caseId: number, at: string): Promise<number> => {
  const created = await page.request.post(`${api}/cases/${caseId}/sessions`, {
    data: { scheduled_at: at, method: 'phone' },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).session_id;
};

// 일정 단추 — 표·시간표 안에서만 찾는다(아래 목록 행과 섞이지 않게).
const event = (grid: Locator, sessionId: number) =>
  grid.locator(`.sc-event[data-session-id="${sessionId}"]`);

// 월간 표의 한 칸 — 날짜 단추(data-day)를 품은 td.
const cellOf = (page: Page, day: string) =>
  page.locator('.sc-month-grid td', { has: page.locator(`[data-day="${day}"]`) });

test('월간이 기본이고 기간 이동·주간·일간·다시보기가 실제 응답으로 동작한다', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await login(page);

  // ── 합성 자료 ────────────────────────────────────────────────
  // 10-14 에 네 건(10시 두 건 — 같은 시각대가 둘 다 살아 있어야 한다),
  // 11-01 01:00 KST = UTC 10-31 16:00(경계), 10-01(일간 이동용), 12-20(구 '앞으로 30일' 밖).
  const stamp = Date.now();
  const nameA = `달력 갑${stamp}`;
  const nameB = `달력 을${stamp}`;
  const nameC = `달력 병${stamp}`;
  const nameD = `달력 정${stamp}`;
  const caseA = await makeCase(page, nameA);
  const caseB = await makeCase(page, nameB);
  const caseC = await makeCase(page, nameC);
  const caseD = await makeCase(page, nameD);
  const s1 = await plan(page, caseA, KST('2026-10-14', '10:00'));
  const s2 = await plan(page, caseB, KST('2026-10-14', '10:30'));
  await plan(page, caseC, KST('2026-10-14', '11:00'));
  await plan(page, caseD, KST('2026-10-14', '14:00'));
  const boundarySession = await plan(page, caseB, KST('2026-11-01', '01:00'));
  await plan(page, caseA, KST('2026-12-20', '15:00'));
  const s7 = await plan(page, caseC, KST('2026-10-01', '09:00'));

  // 자료를 만든 뒤 일정 화면을 다시 연다 — 첫 조회가 새 자료를 담게 한다.
  await page.goto('/#/participants');
  await page.goto('/#/schedule');

  // ── 기본은 월간, 제목은 상담 일정 ────────────────────────────
  await expect(page.getByRole('heading', { name: '상담 일정', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '일정 보기', exact: true })).toHaveValue('month');

  const month = page.locator('.sc-month-grid');
  await expect(month).toHaveAttribute('aria-label', '월간 상담 일정');
  // 월요일부터 일요일까지: 9-28~11-01. 한국 기준 현재 월은 10월이다.
  await expect(month.locator('thead th')).toHaveText(['월', '화', '수', '목', '금', '토', '일']);
  await expect(month.locator('[data-day="2026-09-28"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-10-31"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-08-30"]')).toHaveCount(0);
  await expect(month.locator('[data-day="2026-11-01"]')).toBeVisible();

  // ── 기간 이동: 다음 달 → 오늘 → 이전 달 ─────────────────────
  const toolbar = page.locator('.sc-toolbar');
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-11-01"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-11-30"]')).toBeVisible();
  // 경계: 11-01 01:00 KST 일정은 11월 칸에 있고 10-31 칸에는 없어야 한다.
  // 칸에는 처음 3건만 오르므로 날짜를 눌러 아래 목록으로 확인한다.
  const detail = page.getByRole('region', { name: /^선택한 날짜의 상담 일정/ });
  await month.locator('[data-day="2026-11-01"]').click();
  await expect(detail.getByText(nameB)).toBeVisible();

  await toolbar.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(month.locator('[data-day="2026-10-14"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-09-28"]')).toBeVisible();
  // UTC 날짜(10-31)가 아니라 한국 날짜(11-01)에 속해야 한다.
  await expect(event(cellOf(page, '2026-10-31'), boundarySession)).toHaveCount(0);

  await toolbar.getByRole('button', { name: '이전 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-09-30"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-10-14"]')).toHaveCount(0);
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-10-14"]')).toBeVisible();
  // 꺽쇠 사이 날짜를 누르면 달력 모달이 열리고, 고른 날짜의 달로 이동한다.
  await pickDate(page, 'calendar-focus', '2026-12-20');
  await expect(month.locator('[data-day="2026-12-20"]')).toBeVisible();
  await expect(month.locator('[data-day="2026-10-14"]')).toHaveCount(0);
  await pickDate(page, 'calendar-focus', '2026-10-14');
  await expect(month.locator('[data-day="2026-10-14"]')).toBeVisible();

  // ── 날짜를 고르면 월간 칸에서 생략된 일정까지 모두 확인할 수 있다 ──
  // 줄은 접힌 카드다(2026-09-17 Q). 접힌 머리에 이름·가명·사업명·회차·일시와 `당사자 정보`가
  // 서고, 방식·장소·메모 같은 상담 조건은 펼쳐야 보인다.
  await month.locator('[data-day="2026-10-14"]').click();
  for (const name of [nameA, nameB, nameC, nameD]) {
    await expect(detail.getByText(name)).toBeVisible();
  }
  // 날짜를 눌러 온 목록에서 펼쳐진 줄은 많아도 하나다(`<details name>` 이 배타로 묶는다).
  // 날짜 클릭이 첫 일정을 펼치느냐는 브라우저의 `open` 처리에 달려 헐겁게 본다.
  expect(await detail.locator('details[open]').count()).toBeLessThanOrEqual(1);
  const foldOf = (name: string) => detail.locator('details', { has: page.getByText(name) });
  // 머리 요약 한 줄: 가명 | 사업명 회차 | 일시(세로선 구분, 2026-09-17 Q).
  await expect(foldOf(nameA).locator('.fold-title-desc'))
    .toHaveText(/달력 보기 검증 1회차 10\. 14\./);
  // 접힌 줄에는 상담 조건이 없다. 어느 줄이 펼쳐지는지는 위처럼 헐거우니 단정은 **접힌 줄**에 건다 —
  // 넷 중 펼쳐진 줄은 많아도 하나라 접힌 줄은 늘 있다(구 단정은 nameA 가 접혀 있다고 못 박아
  // 첫 일정이 펼쳐진 실행에서 떨어졌다).
  await expect(detail.locator('details:not([open])').first().getByText('방식', { exact: true })).toBeHidden();

  // ── 펼치면 상담 조건이 라벨/값으로 붙는다 ──
  if (!(await foldOf(nameA).evaluate((el) => (el as HTMLDetailsElement).open))) {
    await foldOf(nameA).locator('summary').click();
  }
  await expect(foldOf(nameA).getByText('방식', { exact: true })).toBeVisible();
  // 한 번에 하나만 펼쳐진다 — 다른 줄을 열면 앞 줄은 닫힌다.
  await foldOf(nameB).locator('summary').click();
  await expect(detail.locator('details[open]')).toHaveCount(1);

  // ── 당사자 정보는 접힌 머리에서도 바로 누를 수 있고, 눌러도 카드가 열리지 않는다 ──
  const review = foldOf(nameA).getByRole('link', { name: '당사자 정보' });
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute('href', new RegExp(`cases/${caseA}/info$`));
  // 그 옆 `상담 기록하기`는 같은 사례의 기록 화면으로 간다.
  await expect(foldOf(nameA).getByRole('link', { name: '상담 기록하기' }))
    .toHaveAttribute('href', new RegExp(`cases/${caseA}/record$`));
  await review.click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseA}/info`));
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // ── 주간: 같은 시각대의 두 일정이 모두 살아 있다 ─────────────
  await page.goto('/#/schedule');
  await page.getByRole('combobox', { name: '일정 보기', exact: true }).selectOption('week');
  const week = page.locator('.sc-time-grid');
  await expect(week).toHaveAttribute('aria-label', '주간 상담 일정');
  // 앵커는 10-01 — 그 주(월~일, 9-28~10-04)에는 10-14 일정이 없다.
  await expect(event(week, s1)).toHaveCount(0);
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(event(week, s1)).toBeVisible();
  await expect(event(week, s2)).toBeVisible();
  // 같은 시각대의 두 번째 일정도 눌러 선택한 날짜 목록을 연다.
  await event(week, s2).click();
  await expect(detail.getByText(nameB)).toBeVisible();

  // ── 일간: 하루씩 이동한다 ────────────────────────────────────
  await page.getByRole('combobox', { name: '일정 보기', exact: true }).selectOption('day');
  const day = page.locator('.sc-time-grid');
  await expect(day).toHaveAttribute('aria-label', '일간 상담 일정');
  await expect(event(day, s1)).toBeVisible(); // 주간에서 선택한 10-14를 유지한다.
  await expect(event(day, s2)).toBeVisible();
  await toolbar.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(event(day, s7)).toBeVisible();
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(event(day, s7)).toHaveCount(0);
  await toolbar.getByRole('button', { name: '이전 기간', exact: true }).click();
  await expect(event(day, s7)).toBeVisible();
  await pickDate(page, 'calendar-focus', '2026-10-02');
  await expect(event(day, s7)).toHaveCount(0);
  await pickDate(page, 'calendar-focus', '2026-10-01');
  await expect(event(day, s7)).toBeVisible();

  // ── 구 '앞으로 30일' 밖의 달도 요청·표시된다 ─────────────────
  await page.getByRole('combobox', { name: '일정 보기', exact: true }).selectOption('month');
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-11-30"]')).toBeVisible();
  await toolbar.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-12-20"]')).toBeVisible();
  await month.locator('[data-day="2026-12-20"]').click();
  await expect(detail.getByText(nameA)).toBeVisible();
});

test('늦게 도착한 이전 기간 응답이 새 기간 화면을 덮지 않는다', async ({ page }) => {
  await page.clock.install({ time: NOW });

  // 첫 /schedules 응답만 붙잡는다 — 로그인 직후 홈이 여는 조회다.
  let gate!: () => void;
  const hold = new Promise<void>((resolve) => { gate = resolve; });
  let heldUrl: string | null = null;
  await page.route('**/schedules*', async (route) => {
    if (heldUrl) return route.continue();
    heldUrl = route.request().url();
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response }).catch(() => {});
  });

  await login(page);
  await expect.poll(() => heldUrl).not.toBeNull();

  // 첫 응답을 붙잡은 뒤 새 자료를 만든다. 옛 응답으로 덮이면 새 11월 일정이 사라진다.
  const name = `달력 무${Date.now()}`;
  const caseId = await makeCase(page, name);
  await plan(page, caseId, KST('2026-10-14', '10:00'));
  await plan(page, caseId, KST('2026-11-10', '10:00'));

  // 아직 첫 응답이 안 왔어도 다음 기간으로 갈 수 있어야 한다.
  const month = page.locator('.sc-month-grid');
  await page.locator('.sc-toolbar').getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(month.locator('[data-day="2026-11-10"]')).toBeVisible();
  // 10월 칸은 없어야 한다 — 옛 표가 남아 있으면 여기서 걸린다.
  await expect(month.locator('[data-day="2026-10-14"]')).toHaveCount(0);
  await month.locator('[data-day="2026-11-10"]').click();
  await expect(page.getByRole('region', { name: /^선택한 날짜의 상담 일정/ }).getByText(name)).toBeVisible();

  // 이제 10월 응답을 푼다 — 11월 표와 그 일정이 그대로여야 한다.
  const stale = page.waitForResponse((r) => r.url() === heldUrl!);
  gate();
  await stale;
  await expect(month.locator('[data-day="2026-11-10"]')).toBeVisible();
  await month.locator('[data-day="2026-11-10"]').click();
  await expect(page.getByRole('region', { name: /^선택한 날짜의 상담 일정/ }).getByText(name)).toBeVisible();
});

test('모바일에서도 날짜의 전체 일정을 열고 주간표 안에서만 가로로 넘긴다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: NOW });
  await login(page);
  const name = `모바일 달력 ${Date.now()}`;
  const caseId = await makeCase(page, name);
  await plan(page, caseId, KST('2026-10-14', '10:00'));
  await page.goto('/#/participants');
  await page.goto('/#/schedule');
  const detail = page.getByRole('region', { name: '선택한 날짜의 상담 일정' });
  const date = page.locator('.sc-month-grid [data-day="2026-10-14"]');
  await date.click();
  await expect(detail.getByText(name)).toBeVisible();
  await date.click();
  await expect(detail).toBeFocused();
  await expect(detail).toHaveAccessibleName(/2026년 10월 14일/);
  await page.getByRole('combobox', { name: '일정 보기', exact: true }).selectOption('week');
  const tableRegion = page.getByRole('region', { name: '주간 시간표', exact: true });
  await expect(tableRegion).toBeVisible();
  expect(await tableRegion.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: '일정 보기', exact: true }).selectOption('day');
  const dayRegion = page.getByRole('region', { name: '일간 시간표', exact: true });
  await expect(dayRegion).toBeVisible();
  await expect(dayRegion.locator('thead tr')).toHaveCount(1);
  expect(await dayRegion.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// 달력 아래 카드의 기본은 '다가오는 일정'이다(2026-09-17 Q): 오늘 이후 가까운 순 다섯 건,
// 넘치면 `날짜 더보기`. 다른 spec 의 합성 자료가 같은 DB 에 쌓이므로 '내가 만든 먼 일정이
// 처음에는 없다가 더보기 뒤에 뜬다'로 자른다 — 건수 상한과 순서를 함께 본다.
test('다가오는 일정은 가까운 다섯 건만 보여 주고 나머지는 날짜 더보기로 펼친다', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await login(page);
  const stamp = Date.now();
  const near = `다가옴 가까운${stamp}`;
  const far = `다가옴 먼${stamp}`;
  const nearCase = await makeCase(page, near);
  const farCase = await makeCase(page, far);
  for (const day of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']) {
    await plan(page, nearCase, KST(day, '10:00'));
  }
  await plan(page, farCase, KST('2027-02-20', '10:00'));
  await page.goto('/#/participants');
  await page.goto('/#/schedule');

  const upcoming = page.getByRole('region', { name: '다가오는 상담 일정', exact: true });
  await expect(upcoming.getByRole('heading', { name: '다가오는 일정', exact: true })).toBeVisible();
  await expect(upcoming.locator('details')).toHaveCount(5);
  await expect(upcoming.getByText(far)).toHaveCount(0);
  // 더보기는 다섯 건씩 더 붙인다 — 한 번에 전부 쏟지 않는다.
  const more = upcoming.getByRole('button', { name: '날짜 더보기', exact: true });
  await more.click();
  await expect(upcoming.locator('details')).toHaveCount(10);
  while (await more.count()) {
    await more.click();
  }
  await expect(upcoming.getByText(far)).toBeVisible();
});
