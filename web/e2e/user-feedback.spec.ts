import { expect, test, type Page } from '@playwright/test';
import { expectDateTime, pickDateTime } from './date-time.ts';

const api = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
// 브라우저가 한국이 아니어도 화면은 한국 시간으로 저장돼야 한다 — 다른 시간대에서 돌려 본다.
test.use({ timezoneId: 'America/Los_Angeles' });

async function register(page: Page) {
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(`E2E 피드백${Date.now()}`);
  await page.locator('#program').selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  const match = page.url().match(/cases\/(\d+)/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

test('피드백 인테이크의 조건부 입력과 실제 상담정보가 생성·수정에서 유지된다', async ({ page }) => {
  const caseId = await register(page);
  await expect(page.locator('.wire-container > section.wire-card .wire-card-title, .wire-container > .card-grid > section.wire-card .wire-card-title'))
    .toHaveText([
      '상담 일시와 상담 방식', /공적급여.*수급자 여부/, '상담 운영정보', '상담 신청 사유',
      '이전에 받은 지원', '강점과 도와줄 사람', '전체 상담 목표', '수행할 과제', '다음에 물어볼 것',
    ]);
  const actual = page.getByRole('group', { name: '상담 방식', exact: true });
  await actual.getByRole('radio', { name: '대면', exact: true }).check();
  await pickDateTime(page, 'held-at', '2026-09-15T14:20');
  await page.getByLabel('상담 장소', { exact: false }).fill('합성 상담실');
  await page.getByRole('group', { name: '선호 상담 방식', exact: true }).getByRole('radio', { name: '전화', exact: true }).check();
  await expect(actual.getByRole('radio', { name: '대면', exact: true })).toBeChecked();

  await expect(page.getByRole('checkbox', { name: '생계급여', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '기초생활보장수급', exact: true }).check();
  await page.getByRole('checkbox', { name: '생계급여', exact: true }).check();
  await page.getByRole('checkbox', { name: '주거급여', exact: true }).check();
  await page.getByRole('radio', { name: '차상위계층', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: '생계급여', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '기초생활보장수급', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: '생계급여', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '주거급여', exact: true })).toBeChecked();

  const reason = page.getByRole('group', { name: '상담을 신청한 사유', exact: true });
  await reason.getByRole('checkbox', { name: '빚과 연체', exact: true }).check();
  await reason.getByRole('checkbox', { name: '돈 관리와 신용 관리', exact: true }).check();
  await page.getByLabel('그 밖의 상황과 연계가 필요한 내용', { exact: true }).fill('합성 연계 내용');
  await expect(page.getByRole('radio', { name: '무응답', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '무응답', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '현재 어려움 관련 영역', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '우선적으로 필요한 도움', exact: true })).toHaveCount(0);

  const history = page.getByLabel('다른 기관에서 받았거나 신청한 지원', { exact: true });
  const strength = page.getByLabel('강점과 도와줄 사람', { exact: true });
  const longText = Array.from({ length: 16 }, (_, i) => `합성 입력 ${i}: 이전 지원을 기록합니다.`).join('\n');
  for (const field of [history, strength]) {
    await field.fill(longText);
    await expect.poll(() => field.evaluate(el => el.tagName === 'TEXTAREA' && el.clientHeight >= el.scrollHeight - 2)).toBe(true);
  }
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  const saved = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(saved.method).toBe('in_person');
  expect(saved.place).toBe('합성 상담실');
  expect(saved.detail.preferred_counsel_method).toBe('전화');
  expect(saved.detail.welfare_benefit_type).toEqual(expect.arrayContaining(['생계급여', '주거급여']));

  // Retired answers are not rendered, but editing the new form must not erase them.
  expect((await page.request.put(`${api}/cases/${caseId}/intake`, { data: {
    detail: { difficulty_areas: ['경제'], need_economy_detail: '보존할 과거 응답' },
  } })).ok()).toBe(true);
  await page.goto(`/#/cases/${caseId}/intake`);
  await expectDateTime(page, 'held-at', '2026-09-15T14:20');
  await expect(history).toHaveValue(longText);
  await actual.getByRole('radio', { name: '기타(이메일, SNS 등)', exact: true }).check();
  await expect(page.getByLabel('상담 장소', { exact: false })).toHaveCount(0);
  await pickDateTime(page, 'held-at', '2026-09-16T10:30');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  const edited = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(edited.session_id).toBe(saved.session_id);
  expect(edited.method).toBe('other');
  expect(edited.place).toBeNull();
  expect(new Date(edited.held_at).toISOString()).toBe('2026-09-16T01:30:00.000Z');
  expect(edited.detail.need_economy_detail).toBe('보존할 과거 응답');
});

test('상담 기록은 다섯 구획이고 인테이크의 전체 목표를 덮어쓰지 않는다', async ({ page }) => {
  const caseId = await register(page);
  await page.locator('#overall-goal').fill('보존할 전체 상담 목표');
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await page.goto(`/#/cases/${caseId}/record`);
  await expect(page.locator('.record-main > section.wire-card .wire-card-title')).toHaveText([
    '1. 오늘 상담 내용', '2. 수행할 과제', '3. 다음에 물어볼 것', '4. 실무자 의견', '5. 다음 상담 목표',
  ]);
  await expect(page.getByRole('textbox', { name: '달라진 것', exact: true })).toHaveCount(0);
  await expect(page.locator('#overall-goal')).toHaveCount(0);
  await page.getByRole('radio', { name: '대면', exact: true }).check();
  await page.locator('#place').fill('이전 상담 장소');
  await page.locator('#memo').fill('합성 상담 기록');
  await page.locator('#next-goal').fill('다음 상담에서 확인할 목표');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  const result = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(result.overall_goal).toBe('보존할 전체 상담 목표');
  const view = await (await page.request.get(`${api}/cases/${caseId}`)).json();
  const session = view.sessions.find((s: { seq: number }) => s.seq === 2);
  await page.goto(`/#/cases/${caseId}/sessions/${session.id}/edit`);
  await expect(page.locator('#place')).toHaveValue('이전 상담 장소');
  await page.locator('#place').fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  const cleared = await (await page.request.get(`${api}/sessions/${session.id}`)).json();
  expect(cleared.place).toBeNull();
});

test('과거 수급과 복수 선호를 새 단일 응답으로 추정하지 않는다', async ({ page }) => {
  const caseId = await register(page);
  const legacy = {
    welfare_basic_livelihood: '과거 수급',
    welfare_near_poverty: '비해당',
    counsel_method: '대면',
    participation_preferred_method: ['전화', '온라인 화상'],
    difficulty_areas: ['경제'],
  };
  expect((await page.request.put(`${api}/cases/${caseId}/intake`, {
    data: { memo: '이전 신청 배경', detail: legacy },
  })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel('신청 배경', { exact: true })).toHaveValue('이전 신청 배경');
  await expect(page.locator('input[name="welfare_status"]:checked')).toHaveCount(0);
  await expect(page.locator('input[name="preferred_counsel_method"]:checked')).toHaveCount(0);
  await page.getByLabel('신청 배경', { exact: true }).fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  const saved = await (await page.request.get(`${api}/cases/${caseId}/intake`)).json();
  expect(saved.memo).toBeNull();
  expect(saved.detail).toMatchObject(legacy);
});
