// 베타 관문 1 — 당사자 등록 → 인테이크 작성하기 → 상담 일정 등록 → 2회차 상담 기록하기 →
// 15초 다시보기가 확인할 과제·오늘 물어볼 것·오늘 상담 목표를 출처 회차 번호와 함께 보여 준다.
// 합성 자료만 쓴다. 실행마다 새 당사자를 만들어 이전 데이터에 기대지 않는다.
import { expect, test } from '@playwright/test';

const stamp = Date.now();
const NAME = `E2E 합성${stamp}`;
const QUESTION = '임대차 계약 만료일이 언제인지';
const TASK = '채무 내역서 준비하기';
const NEXT_GOAL = '내역서를 함께 본다';
const OVERALL_GOAL = '연체를 정리하고 생활을 안정시킨다';

test('등록부터 15초 다시보기까지 한 바퀴', async ({ page }) => {
  // ── 당사자 등록 ─────────────────────────────────────────────
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(NAME);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();

  // ── 인테이크 작성하기 ───────────────────────────────────────
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();

  // 고른 영역만 세부 질문이 열린다(I-05).
  const areaSection = page.locator('section.wire-card', { hasText: '현재 어려움 관련 영역' });
  await expect(page.locator('section.wire-card .wire-card-title', { hasText: '경제' })).toHaveCount(0);
  await areaSection.getByRole('checkbox', { name: '경제', exact: true }).check();
  const economySection = page.locator('section.wire-card').filter({ has: page.getByRole('heading', { name: '경제', exact: true }) });
  await expect(economySection).toBeVisible();
  await economySection.getByRole('checkbox', { name: '부채', exact: true }).check();

  await page.locator('#overall-goal').fill(OVERALL_GOAL);
  const intakeQuestions = page.locator('section.wire-card', { hasText: '다음에 물어볼 것' });
  await intakeQuestions.getByLabel('다음에 물어볼 것').fill(QUESTION);
  await intakeQuestions.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // ── 상담 일정 등록(2회차) ───────────────────────────────────
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.locator('#at').fill('2026-10-01T10:00');
  await page.getByRole('radio', { name: '대면' }).check();
  await page.locator('#place').fill('사회연대은행 상담실');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // ── 2회차 상담 기록하기 ─────────────────────────────────────
  await page.getByRole('button', { name: '상담 기록하기' }).click();
  await expect(page.getByRole('heading', { name: '상담 기록하기' })).toBeVisible();

  // 인테이크에서 만든 질문이 레일에 올라와 있다.
  const rail = page.locator('aside');
  await expect(rail.getByText(QUESTION)).toBeVisible();

  await page.getByLabel('상담 내용').fill('내역서는 아직 못 뗐다고 함.');
  await page.getByLabel('수행할 과제').fill(TASK);
  await page
    .locator('section.wire-card', { hasText: '수행할 과제' })
    .getByRole('button', { name: '추가', exact: true })
    .click();
  await page.locator('#next-goal').fill(NEXT_GOAL);
  // 질문 카드의 '확인함'은 일부러 누르지 않는다 → unchecked 로 남아야 한다.
  await page.getByRole('button', { name: '저장' }).click();

  // ── 3회차 일정 등록 ─────────────────────────────────────────
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await page.getByRole('link', { name: '상담 일정 등록' }).click();
  await page.locator('#at').fill('2026-10-08T10:00');
  await page.getByRole('radio', { name: '전화' }).check();
  await page.getByRole('button', { name: '등록', exact: true }).click();

  // ── 15초 다시보기 ───────────────────────────────────────────
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 목표: 전체 상담 목표 + 2회차에서 이어받은 오늘 상담 목표
  const goals = page.locator('section.wire-card', { hasText: '목표' }).first();
  await expect(goals).toContainText(OVERALL_GOAL);
  await expect(goals).toContainText(NEXT_GOAL);
  await expect(goals).toContainText('2회차에서 적음');

  // 확인할 과제: 2회차에서 만든 과제가 출처 회차와 함께
  const tasks = page.locator('section.wire-card', { hasText: '확인할 과제' });
  await expect(tasks).toContainText(TASK);
  await expect(tasks).toContainText('2회차');

  // 오늘 물어볼 것: 누르지 않은 질문이 '지난 회차 미확인'을 달고 다시 올라온다
  const questions = page.locator('section.wire-card', { hasText: '오늘 물어볼 것' });
  await expect(questions).toContainText(QUESTION);
  await expect(questions).toContainText('지난 회차 미확인');

  // 위험 신호는 비어도 빠지지 않고 상태를 쓴다
  // 위험 신호는 카드가 아니라 전용 배너다(.risk-banner — 화면에서 유일한 위험색 테두리).
  const risk = page.locator('.risk-banner');
  await expect(risk).toContainText('위험 신호 없음');
  await expect(risk).toContainText('AI 확인 안 함');

  // 기록 화면에는 문장별 카드 분류를 고르는 입력이 없다
  await page.getByRole('button', { name: '상담 기록하기' }).click();
  await expect(page.getByText('사실', { exact: true })).toHaveCount(0);
  await expect(page.getByText('약속한 일', { exact: true })).toHaveCount(0);
});
