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
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
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
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
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
  // 국가 표준 영역이 그대로 저장되는지. 서버가 옛 9영역 목록을 들고 있으면 여기서 500 이 난다.
  await page.locator('#change-area').selectOption({ label: '생활환경' });
  await page.locator('#change-input').fill('월세 계약을 6개월 연장함');
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
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
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
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
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

// 인테이크는 한 번 쓰고 끝이 아니다. 다시 열어 고칠 수 있어야 한다(2026-09-15 Q).
test('인테이크를 다시 열어 고쳐 쓴다', async ({ page }) => {
  const name = `E2E 인테이크수정${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();
  await page.locator('#overall-goal').fill('처음 적은 목표');
  await page.getByRole('textbox', { name: '수행할 과제' }).fill('처음 적은 과제');
  await page.locator('section.wire-card').filter({ has: page.getByRole('heading', { name: '수행할 과제' }) })
    .getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();

  // 다시 열면 적어 둔 것이 그대로 있다
  await page.getByRole('link', { name: '인테이크 작성하기' }).click();
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();
  await expect(page.locator('#overall-goal')).toHaveValue('처음 적은 목표');
  await expect(page.locator('section.wire-card').filter({ has: page.getByRole('heading', { name: '수행할 과제' }) }))
    .toContainText('처음 적은 과제');

  // 고쳐 쓰면 새 회차를 만들지 않고 그 자리를 고친다
  await page.locator('#overall-goal').fill('고쳐 적은 목표');
  await page.getByRole('button', { name: '저장' }).click();
  await page.waitForURL(/\/briefing$/);
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await expect(page.locator('.wire-container')).toContainText('고쳐 적은 목표');

  // 회차가 늘지 않았다 — 고쳐 쓰기는 새 회차를 만들지 않는다
  await page.getByRole('link', { name: '당사자 정보' }).click();
  const sessions = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await expect(sessions).toContainText('1회차');
  await expect(sessions).not.toContainText('2회차');
});

// 저장한 회차도 고쳐 쓸 수 있어야 한다(2026-09-15 Q). 결과 어휘는 진행 전·진행 중·완료 셋이다.
// `추가`를 누르지 않고 적어만 둔 줄도 저장된다 — 추가는 항목을 하나 더 만드는 일이지 저장이 아니다.
test('회차를 고쳐 쓰고, 적어만 둔 줄도 저장된다', async ({ page }) => {
  const name = `E2E 회차수정${Date.now()}`;
  const task = '서류 떼어 오기';

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  // 인테이크에서 `추가`를 누르지 않고 적어만 둔다
  await page.getByRole('textbox', { name: '수행할 과제' }).fill(task);
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 2회차를 예정 없이 기록한다. 과제는 진행 전으로.
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();
  const rail = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '확인할 과제' }) });
  await expect(rail).toContainText(task); // 적어만 둔 줄이 저장돼 올라왔다
  await page.locator('#held-at').fill('2026-10-01T10:00');
  await page.locator('#memo').fill('처음 적은 상담 내용');
  await rail.getByRole('radio', { name: '진행 전' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 당사자 정보 › 회차별 요약에서 그 회차를 고쳐 쓴다
  await page.getByRole('link', { name: '당사자 정보' }).click();
  const summary = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await summary.locator('.wire-item', { hasText: '2회차' }).getByRole('button', { name: '고쳐 쓰기' }).click();
  await expect(page.getByRole('heading', { name: '상담 기록 고쳐 쓰기' })).toBeVisible();

  // 지난번에 적은 것과 매긴 결과가 그대로 서 있다
  await expect(page.locator('#memo')).toHaveValue('처음 적은 상담 내용');
  await expect(page.getByRole('radio', { name: '진행 전' })).toBeChecked();

  await page.locator('#memo').fill('고쳐 적은 상담 내용');
  await page.getByRole('radio', { name: '완료' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 완료로 바꿨으니 확인할 과제에서 빠지고, 회차는 늘지 않는다
  await expect(page.locator('.wire-container')).not.toContainText(task);
  await page.getByRole('link', { name: '당사자 정보' }).click();
  await expect(summary).toContainText('2회차');
  await expect(summary).not.toContainText('3회차');
});

// P1 동의 게이트. 민감정보 처리 동의 없이는 상담 자유 글을 저장하지 않는다.
test('민감정보 동의가 없으면 기록을 저장하지 못하고, 받으면 저장된다', async ({ page }) => {
  const name = `E2E 동의${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  // 필수 동의만 켜고 민감정보는 끈 채 등록한다
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await expect(page.getByRole('button', { name: '등록하고 인테이크 쓰기' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();

  // 인테이크 저장이 막힌다
  await expect(page.getByRole('heading', { name: '인테이크 작성하기' })).toBeVisible();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page.getByText('민감정보 처리 동의가 없어요', { exact: false })).toBeVisible();

  // 당사자 정보 › 정보 탭에서 동의를 받는다
  await page.getByRole('link', { name: '당사자 정보' }).click();
  await page.getByRole('tab', { name: '정보' }).click();
  const consent = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '동의' }) });
  await expect(consent).toContainText('민감정보 처리 · 동의 없음');
  await consent.locator('.wire-repeat-card', { hasText: '민감정보 처리' }).getByRole('button', { name: '동의 받기' }).click();
  await expect(consent).toContainText('민감정보 처리 · 동의함');

  // 이제 저장된다
  await page.getByRole('link', { name: '인테이크 작성하기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
});

// P1 열람 기록. PII 를 실은 화면 조회 1건 = 감사 1행, 항목 이름만 남는다.
test('PII 를 본 조회가 열람 기록에 남고, 관리자만 본다', async ({ page }) => {
  // 실무자가 당사자 정보를 본다
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '일정', exact: true })).toBeVisible();
  await page.goto('/#/cases/1/info');
  await expect(page.getByRole('tab', { name: '정보' })).toBeVisible();

  // 실무자 화면에는 열람 기록 메뉴가 없다
  await expect(page.getByRole('link', { name: '열람 기록' })).toHaveCount(0);
  await page.goto('/#/audit');
  await expect(page.getByText('관리자만 볼 수 있어요', { exact: false })).toBeVisible();

  // 관리자로 바꿔 본다
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.locator('#email').fill('test1');
  await page.locator('#password').fill('test1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('link', { name: '열람 기록' }).click();

  const log = page.locator('section.wire-card', { hasText: '최근 200건' });
  await expect(log).toContainText('시험 실무자');
  await expect(log).toContainText('당사자 정보 조회');
  await expect(log).toContainText('이름 · 연락처 · 이메일'); // 항목 이름만, 값은 없다
  await expect(log).not.toContainText('010-');
});

// P1 자유 글 암호화. 화면은 평문을 보지만 DB 에는 암호문이 앉는다.
// (DB 확인은 api/test/pii.test.ts 와 scripts/check-encryption.sh 가 맡는다. 여기서는 왕복만 본다.)
test('자유 글을 저장하고 다시 열면 그대로 읽힌다', async ({ page }) => {
  const name = `E2E 암호화${Date.now()}`;
  const memo = '건강·채무 이야기가 섞인 상담 내용';

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();
  await page.locator('#held-at').fill('2026-10-05T10:00');
  await page.locator('#memo').fill(memo);
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 회차별 요약의 원문 보기에 그대로 뜬다
  await page.getByRole('link', { name: '당사자 정보' }).click();
  const summary = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await summary.locator('.wire-item', { hasText: '2회차' }).getByRole('button', { name: '원문 보기' }).click();
  await expect(summary).toContainText(memo);
});

// P2 당사자 열람. 당사자는 로그인하지 않고 링크+코드로 자기 정보와 일정만 본다.
test('당사자는 링크와 코드로 자기 일정만 본다', async ({ page, context }) => {
  const name = `E2E 열람${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.locator('#phone').fill('010-5555-6666');
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 앞으로의 일정 하나
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.locator('#at').fill('2026-12-01T10:00');
  await page.getByRole('button', { name: '등록', exact: true }).click();

  // 실무자가 열람 링크를 만든다
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();
  await page.getByRole('link', { name: '당사자 정보' }).click();
  await page.waitForURL(/\/info$/);
  await page.getByRole('tab', { name: '정보' }).click();
  const access = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '당사자 열람' }) });
  await access.getByRole('button', { name: '열람 링크 만들기' }).click();
  await expect(access).toContainText('확인 코드');

  const link = (await access.locator('.wire-data-row', { hasText: '링크' }).locator('dd').innerText()).trim();
  const code = (await access.locator('.wire-data-row', { hasText: '확인 코드' }).locator('dd').innerText()).trim();
  const token = link.split('/access/')[1];

  // 로그인하지 않은 다른 브라우저로 연다
  const guest = await context.browser()!.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/#/access/${token}`);
  await expect(guestPage.getByRole('heading', { name: '내 상담 일정' })).toBeVisible();

  // 틀린 코드는 남은 횟수를 알려 준다
  await guestPage.locator('#code').fill('000000');
  await guestPage.getByRole('button', { name: '열기' }).click();
  await expect(guestPage.getByText('코드가 맞지 않아요', { exact: false })).toBeVisible();

  // 맞는 코드로 열면 기본 정보와 일정만 보인다
  await guestPage.locator('#code').fill(code);
  await guestPage.getByRole('button', { name: '열기' }).click();
  await expect(guestPage.getByRole('heading', { name: '다가오는 상담' })).toBeVisible();
  await expect(guestPage.locator('.wire-container')).toContainText('010-5555-6666');
  await expect(guestPage.locator('.wire-container')).toContainText('12월');
  // 실무자 화면과 상담 내용은 보이지 않는다
  await expect(guestPage.getByRole('link', { name: '당사자 목록' })).toHaveCount(0);
  await expect(guestPage.locator('.wire-container')).not.toContainText('상담 기록');
  await guest.close();
});

// P3 AI 경로. **동의 없이는 호출 자체를 하지 않는다.** 화면에서 그 사실이 보여야 한다.
// (실제 모델 호출은 키가 있어야 하므로 여기서는 게이트와 화면까지만 본다.)
test('외부 LLM 동의가 없으면 AI 정리를 하지 않는다', async ({ page }) => {
  const name = `E2E AI${Date.now()}`;

  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 예정 없이 2회차를 기록한다
  await expect(page.getByRole('heading', { name: '상담 일정 등록' })).toBeVisible();
  await page.getByRole('link', { name: '상담 기록하기' }).click();
  await page.locator('#held-at').fill('2026-10-05T10:00');
  await page.locator('#memo').fill('연체 2건 확인. 서류는 다음 주에 떼기로 함.');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '15초 다시보기' })).toBeVisible();

  // 회차별 요약 → AI 정리
  await page.getByRole('link', { name: '당사자 정보' }).click();
  await page.waitForURL(/\/info$/);
  const summary = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await summary.locator('.wire-item', { hasText: '2회차' }).getByRole('button', { name: 'AI 정리' }).click();
  await page.waitForURL(/\/review$/);

  // 동의가 없으니 정리가 막힌다
  await page.getByRole('button', { name: 'AI로 정리하기' }).click();
  await expect(page.getByText('외부 LLM·국외 처리 동의가 없어요', { exact: false })).toBeVisible();
});

// 잘못 쓴 요청은 **400** 이다. 500 으로 답하면 서버가 고장난 줄 안다.
// 2026-09-15 실측: ZodError 를 잡는 곳이 없어 모든 잘못된 입력이 500 이었다.
test('스키마에 안 맞는 요청은 400 으로 답한다', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '일정' })).toBeVisible();

  const cookies = await page.context().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // 개발 서버는 /api 를 API 로 넘긴다(web/src/api.ts:44).
  const res = await request.post('/api/cases', {
    headers: { cookie, 'content-type': 'application/json' },
    data: { name: '검증', program_name: 'x', consents: [{ domain: '없는_영역', decision: 'grant' }] },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  // 어느 자리가 틀렸는지만 알려 준다. 보낸 값은 되돌려주지 않는다 — PII 가 섞여 있다.
  expect(body.error).toContain('consents.0.domain');
  expect(body.error).not.toContain('없는_영역');
});
