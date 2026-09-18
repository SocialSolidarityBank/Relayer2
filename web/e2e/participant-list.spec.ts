import { expect, test } from '@playwright/test';
import { createProgram } from './programs.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';

// Exercise real list responses: names, recording state and access boundaries must
// survive the switch from collapsed actions to the CCC name-first card.
test('이름 중심 목록에서 정보를 바로 보고 상세와 기록·일정으로 이동한다', async ({ page }) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();

  const name = `가나다 목록 검증 ${Date.now()}`;
  const program = `목록 검증 사업 ${Date.now()}`;
  // 연락처를 준다 — 펼친 본문은 **없는 값은 칸을 안 만든다**(A4). 비워 두면 `담당 실무자` 만 남아
  // 아래 '펼치면 연락처가 올라온다' 단정이 헛돈다(2026-09-18 실측).
  const created = await page.request.post(`${api}/cases`, { data: {
    name, phone: '010-7777-8888', program_id: await createProgram(program),
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
  const card = page.locator('.participant-card').filter({ hasText: name });
  await expect(card.getByText(name, { exact: true })).toBeVisible();
  // 접힌 머리는 한 줄이다(2026-09-18 Q A2·A3): 이름 · 상태 컬러 텍스트 · 가명 사업명 회차 다음 상담.
  // 담당 실무자는 머리에서 걷었다 — 위 걸개가 가르고, 펼친 본문이 이름을 싣는다.
  await expect(card.locator('.participant-state')).toHaveText('진행 중');
  // 다음 상담은 전역 일시 표기 `2026.09.21.(월) AM 10:26` 이다(2026-09-18 Q).
  await expect(card.locator('.participant-card-id'))
    .toHaveText(new RegExp(`^[a-z]+-\\d+ ${program} 1회차 다음 상담 \\d{4}\\.\\d{2}\\.\\d{2}\\.\\([일월화수목금토]\\) (AM|PM) \\d{2}:\\d{2}$`));
  await expect(card.getByText('예정 없음', { exact: true })).toHaveCount(0);
  // 연락처는 펼칠 때 그 사례만 부른다(A4) — 접힌 채로는 카드에 없다.
  await expect(card.locator('.participant-card-fields')).toBeHidden();

  // 현황판은 걸개 아래에서 지금 무엇을 보고 있는지 말한다(종결은 세지 않는다).
  const stats = page.locator('.participant-stats');
  for (const label of ['보이는 사람', '전체', '진행 중', '배정 필요', '담당 실무자']) {
    await expect(stats.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(stats).not.toContainText('종결');

  // 한 쪽은 열 장이다. 그보다 많으면 가운데 쪽 넘기기가 선다.
  // 쪽이 갈릴 만큼은 **이 spec 이 직접 만든다** — 남이 남긴 자료에 기대면 DB 를 비운 뒤 깨진다
  // (2026-09-18: 로컬 DB 를 시드만 남기고 비웠더니 `10장` 단정이 5장에서 떨어졌다).
  // 채움 사례는 **다른 사업**이다 — 아래 `사업명 걸개` 단정이 본 검증 사업으로 1장을 센다.
  const fillerProgramId = await createProgram(`쪽 넘기기 사업 ${Date.now()}`);
  for (let i = 0; i < 10; i += 1) {
    const filler = await page.request.post(`${api}/cases`, { data: {
      name: `쪽 넘기기 검증 ${Date.now()}-${i}`,
      program_id: fillerProgramId,
      consents: [{ domain: 'personal_data_collection_use', decision: 'grant' }],
    } });
    expect(filler.status()).toBe(201);
  }
  await page.reload();
  await expect(page.locator('.participant-card')).toHaveCount(10);
  const pager = page.getByRole('navigation', { name: '쪽 넘기기', exact: true });
  await expect(pager).toContainText('1 /');
  await pager.getByRole('button', { name: '다음 쪽', exact: true }).click();
  await expect(pager).toContainText('2 /');
  const secondPage = await page.locator('.participant-card').count();
  expect(secondPage).toBeGreaterThan(0);
  expect(secondPage).toBeLessThanOrEqual(10);
  await expect(page.getByRole('button', { name: '내가 맡기', exact: true })).toHaveCount(0);

  await page.getByLabel('찾기', { exact: true }).fill(name);
  // 펼치면 연락처가 그때 올라온다(A4) — 미리 부르지 않는다.
  await card.locator('summary').click();
  await expect(card.locator('.participant-card-fields')).toContainText('연락처');

  // 카드 행동 둘(A2). `당사자 정보`는 상세로, `상담 기록하기`는 **일정 예약을 지나** 기록으로 간다(D1).
  await card.getByRole('link', { name: `${name}, ${program}, 당사자 정보`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/info$`));
  await expect(page.getByRole('tab', { name: '당사자 정보', exact: true })).toBeVisible();

  await page.goto('/#/participants');
  await page.locator('#q').fill(name);
  await card.getByRole('link', { name: `${name}, ${program}, 상담 기록하기`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/schedule\\?then=record$`));
  // 화면 이름이 `h1`(`상담 일정 등록`)이고 당사자 카드의 사람 이름은 `h2`다(2026-09-18 Q — 구 h1 이름 대체).
  await expect(page.getByRole('heading', { name: '상담 일정 등록', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible();
  // 예정 회차가 있으니 안내 팝업 없이 그 회차를 확인하고 기록으로 잇는다(D1).
  await expect(page.getByRole('dialog', { name: '일시 확인 필요' })).toBeHidden();
  await page.getByRole('button', { name: '상담 기록하기', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/record$`));

  // ── 걸개와 정렬(2026-09-17 Q) ────────────────────────────────
  await page.goto('/#/participants');
  await page.getByLabel('사업명 걸개', { exact: true }).selectOption(program);
  await expect(page.locator('.participant-card')).toHaveCount(1);
  await expect(page.locator('.participant-card')).toContainText(name);
  await page.getByLabel('상태 걸개', { exact: true }).selectOption('closed');
  await expect(page.locator('.participant-card')).toHaveCount(0);
  await page.getByLabel('상태 걸개', { exact: true }).selectOption('all');
  await page.getByLabel('사업명 걸개', { exact: true }).selectOption('all');
  // 정렬은 다음 상담이 있는 사람을 앞으로 올린다 — 이 사람은 이틀 뒤 일정이 있다.
  // 구 단정 `'월'` 은 옛 `9월 21일` 표기의 흔적이었다(2026-09-18 Q 날짜 통일).
  await page.getByLabel('정렬', { exact: true }).selectOption('date_asc');
  await expect(page.locator('.participant-card').first()).toContainText('다음 상담');
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
  const restricted = page.locator('.participant-card').filter({ hasText: program });
  await expect(restricted.getByText('배정 필요', { exact: true })).toBeVisible();
  await expect(restricted.getByText(name, { exact: true })).toHaveCount(0);
  await expect(restricted.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(program) })).toHaveCount(0);
  await expect(restricted.getByText('기록 없음', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '내가 맡기', exact: true })).toHaveCount(0);
});
