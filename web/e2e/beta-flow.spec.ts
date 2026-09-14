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
  // ── 로그인 ──────────────────────────────────────────────────
  // 로그인하지 않으면 어떤 화면도 열리지 않는다. 계정은 시드가 만든다.
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  // ── 당사자 등록 ─────────────────────────────────────────────
  // 로그인하면 홈은 일정이다
  await expect(page.getByRole('heading', { name: '일정', exact: true })).toBeVisible();
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

  // ── 돌아오는 길 ─────────────────────────────────────────────
  // URL 을 외우지 않고 목록에서 이 사례로 되돌아올 수 있어야 한다.
  await page.getByRole('link', { name: '당사자 목록', exact: true }).click();
  await page.locator('#q').fill(NAME);
  const row = page.locator('.wire-item', { hasText: NAME });
  await expect(row).toContainText('2회차까지 기록');
  await row.getByRole('button', { name: '15초 다시보기' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await expect(page.locator('section.wire-card', { hasText: '확인할 과제' })).toContainText(TASK);
});

// 일정을 미리 잡지 않고 만난 상담(갑작스러운 방문·전화)도 그 자리에서 기록돼야 한다.
test('예정 회차가 없어도 상담 기록하기에서 일시를 적고 기록한다', async ({ page }) => {
  const name = `E2E 즉석${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 일정 등록 화면이 떠도 등록하지 않고 바로 기록하기로 간다
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();

  const when = page.locator('section.wire-card', { hasText: '상담 일시와 상담 방식' });
  await expect(when).toBeVisible();
  await page.locator('#held-at').fill('2026-09-20T14:00');
  await page.getByRole('radio', { name: '전화' }).check();
  await page.locator('#memo').fill('예고 없이 전화가 와서 그 자리에서 상담함');
  await page.getByRole('button', { name: '저장' }).click();

  // 2회차로 저장되고, 다시보기가 그 회차를 가리킨다
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await expect(page.locator('.participant-card, .wire-container').first()).toContainText('2회차');
});

// 상담 종결은 회차가 아니다. 회차 번호를 받지 않고, 미완료 과제를 자동 처리하지 않는다(SPEC §4-3).
test('상담 종결은 회차를 만들지 않고 미완료 과제를 그대로 남긴다', async ({ page }) => {
  const name = `E2E 종결${Date.now()}`;
  const task = '주민센터에서 서류 떼어 오기';

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 예정 없이 2회차를 기록하면서 과제를 하나 남긴다
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();
  await page.locator('#held-at').fill('2026-09-20T14:00');
  await page.locator('#memo').fill('서류를 떼어 오기로 함');
  await page.getByRole('textbox', { name: '수행할 과제' }).fill(task);
  await page.getByRole('button', { name: '추가' }).first().click();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 당사자 정보 › 정보 탭에서 종결로 들어간다
  await page.getByRole('link', { name: '당사자 정보' }).click();
  await page.getByRole('tab', { name: '정보' }).click();
  await page.locator('.wire-container').getByRole('button', { name: '상담 종결' }).click();
  await page.waitForURL(/\/close$/);
  await expect(page.getByRole('heading', { name: '종결 사유' })).toBeVisible();

  // 미완료 과제가 출처 회차와 함께 보이고, 종결해도 사라지지 않는다
  // '미완료 과제' 는 종결 사유 카드의 안내문에도 들어 있다. 제목으로 카드를 집는다.
  const unfinished = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '미완료 과제' }) });
  await expect(unfinished).toContainText(task);
  await expect(unfinished).toContainText('2회차에서 시작');
  await page.getByRole('radio', { name: '타 기관 의뢰' }).check();
  await page.locator('#note').fill('연계 기관에서 이어받기로 함');
  await page.getByRole('button', { name: '종결 확정' }).click();

  // 회차별 요약: 마지막 상담과 상담 종결이 두 항목. 종결은 회차 번호를 받지 않는다.
  await expect(page.getByRole('tab', { name: '회차별 요약' })).toBeVisible();
  const closure = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '상담 종결' }) });
  await expect(closure).toContainText('타 기관 의뢰');
  await expect(closure).toContainText('연계 기관에서 이어받기로 함');
  await expect(closure).not.toContainText('3회차');

  // 목록에서도 종결로 보인다
  await page.getByRole('link', { name: '당사자 목록', exact: true }).click();
  await page.locator('#q').fill(name);
  await expect(page.locator('.wire-item', { hasText: name })).toContainText('종결');
});

// 요구 5 — 기록 화면에서 `종결 상담`을 고르면 저장 성공 뒤 종결 화면으로 간다.
test('종결 상담으로 저장하면 종결 화면으로 이어진다', async ({ page }) => {
  const name = `E2E 종결상담${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 일정 등록에서 종결 상담으로 잡는다
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.locator('#at').fill('2026-10-01T10:00');
  await page.getByRole('checkbox', { name: '종결 상담' }).check();
  await page.getByRole('button', { name: '등록', exact: true }).click();

  // 기록 화면이 그 표시를 이어받는다
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();
  await expect(page.getByRole('checkbox', { name: '이번이 마지막 상담이에요' })).toBeChecked();
  await page.locator('#memo').fill('마지막으로 정리하고 마무리함');
  await page.getByRole('button', { name: '저장하고 종결로' }).click();

  // 저장 성공 뒤 종결 화면. 아직 닫히지는 않았다.
  await page.waitForURL(/\/close$/);
  await expect(page.getByRole('heading', { name: '종결 사유' })).toBeVisible();
  await page.getByRole('radio', { name: '목표 달성' }).check();
  await page.getByRole('button', { name: '종결 확정' }).click();
  await expect(page.getByRole('tab', { name: '정보' })).toBeVisible();
});

// 당사자는 비밀번호가 맞아도 들어오지 못한다. 열람은 실무자가 보낸 링크와 코드다(GLOSSARY §3).
test('당사자 계정은 로그인되지 않고 이유를 말한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#email').fill('test3');
  await page.locator('#password').fill('test3');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page.getByText('당사자는 로그인하지 않아요', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '일정', exact: true })).toHaveCount(0);
});
