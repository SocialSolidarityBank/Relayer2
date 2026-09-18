// 베타 관문 1 — 당사자 등록 → 인테이크 작성하기 → 상담 일정 등록 → 2회차 상담 기록하기 →
// 목표 탭과 기록 레일이 확인할 과제·오늘 물어볼 것·오늘 상담 목표를 출처 회차와 함께 보여 준다
// (2026-09-17 Q — 15초 다시보기 화면 폐지).
// 합성 자료만 쓴다. 실행마다 새 당사자를 만들어 이전 데이터에 기대지 않는다.
import { expect, test, type Page } from '@playwright/test';
import { pickDateTime } from './date-time.ts';

const stamp = Date.now();
const NAME = `E2E 합성${stamp}`;
const QUESTION = '임대차 계약 만료일이 언제인지';
const TASK = '채무 내역서 준비하기';
const NEXT_GOAL = '내역서를 함께 본다';
const OVERALL_GOAL = '연체를 정리하고 생활을 안정시킨다';

/**
 * 지금 보고 있는 사례의 당사자 정보로 간다. `당사자 정보`는 2026-09-17 Q 지시로 메뉴에서
 * 빠졌다 — 사람이 쓰는 입구는 당사자 목록 카드이고(그 동선은 `participant-list.spec.ts`가
 * 지킨다), 여기서는 흐름 중간에 그 화면을 열어 보는 것이 목적이라 주소로 간다.
 *
 * 화면은 당사자 카드(HERO) + 탭 4개이고 기본 탭은 `당사자 정보`다. 다른 탭이 필요하면
 * 이름을 준다 — 사람도 카드 아래 탭을 눌러 옮긴다.
 */
const openInfo = async (
  page: Page,
  tab?: '당사자 정보' | '회차별 요약' | '회차별 원본 보기' | '목표',
  // 일정을 저장하면 사례 주소를 떠나 일정 목록으로 간다(2026-09-17 Q) — 그때는 사례를 직접 준다.
  fromCaseId?: string,
) => {
  const caseId = fromCaseId ?? page.url().match(/#\/cases\/(\d+)\//)?.[1];
  expect(caseId, '사례 주소에서 왔어야 한다').toBeTruthy();
  await page.goto(`/#/cases/${caseId}/info`);
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
};

/**
 * 사례를 고르는 자리는 **당사자 목록 하나**다(2026-09-18 Q A1 — 구 `#/pick/*` 폐지).
 * 카드의 `상담 기록하기`는 늘 일정 예약을 지난다(Q 결정 D1): 예정 회차가 있으면 그 회차를
 * 확인하고 넘어가고, 없으면 일시 확인 안내 뒤 지금 일시를 저장한 다음 기록으로 간다.
 */
const recordFromList = async (page: Page, name: string, planned: boolean) => {
  await page.locator('.navigation-list').getByRole('link', { name: '당사자 목록' }).first().click();
  await page.locator('#q').fill(name);
  await page
    .locator('.participant-card')
    .filter({ hasText: name })
    .getByRole('link', { name: new RegExp(`^${name},.*상담 기록하기$`) })
    .click();
  await expect(page).toHaveURL(/\/schedule\?then=record$/);
  if (!planned) {
    // 작은 안내 팝업(C5) — 닫기가 확인이다. 값은 이미 지금 일시로 채워져 있다.
    await page
      .getByRole('dialog', { name: '일시 확인 필요' })
      .getByRole('button', { name: '닫기', exact: true })
      .click();
  }
  // 저장 버튼은 카드 제목 줄에 선다(85e76c1 — 구 하단 `.schedule-savebar` 폐지).
  await page
    .getByRole('button', { name: planned ? '상담 기록하기' : '일정 저장', exact: true })
    .click();
  await expect(page).toHaveURL(/\/record$/);
  // 기록 화면의 첫 렌더는 `불러오는 중` 이고, 본문은 브리핑·사례가 다 온 뒤에 선다(입력칸을
  // 그때 초기화한다). 본문을 기다리지 않고 칸을 채우면 초기화가 덮어쓴다 — 일정 예약 화면에도
  // 같은 이름의 칸(`#memo`·`종결 상담`)이 있어 넘어오는 순간에는 어느 화면인지도 가려진다.
  await expect(page.locator('.record-main')).toBeVisible();
};

test('등록부터 회차 기록·이어받기까지 한 바퀴', async ({ page }) => {
  // ── 로그인 ──────────────────────────────────────────────────
  // 로그인하지 않으면 어떤 화면도 열리지 않는다. 계정은 시드가 만든다.
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  // ── 당사자 등록 ─────────────────────────────────────────────
  // 로그인하면 홈(상담 일정)이 연다 — 화면 제목이 아니라 셸의 내 계정 표시로 준비를 본다.
  await expect(page.locator('.app-nav-me')).toBeVisible();
  // 사이드바 일정 묶음은 보기 하나다(2026-09-18 Q A1) — 등록·기록 메뉴는 목록 카드로 내렸다.
  const scheduleMenu = page.locator('.navigation-group', {
    has: page.locator('.navigation-section-title', { hasText: '일정' }),
  });
  const participantMenu = page.locator('.navigation-group', {
    has: page.locator('.navigation-section-title', { hasText: '당사자' }),
  });
  await expect(scheduleMenu.getByRole('link')).toHaveText(['상담 일정 보기']);
  await expect(participantMenu.getByRole('link')).toHaveText(['당사자 목록', '당사자 등록']);
  await expect(page.locator('.navigation-list').getByRole('link', { name: '상담 기록하기' })).toHaveCount(0);
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(NAME);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();

  // ── 인테이크 작성하기 ───────────────────────────────────────
  await expect(page).toHaveURL(/\/intake$/);

  // 수급자 여부에 따라 해당 급여의 복수 선택이 열린다.
  await expect(page.getByRole('checkbox', { name: '생계급여', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '기초생활보장수급', exact: true }).check();
  await page.getByRole('checkbox', { name: '생계급여', exact: true }).check();
  await page.getByRole('checkbox', { name: '주거급여', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: '생계급여', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '주거급여', exact: true })).toBeChecked();

  await page.locator('#overall-goal').fill(OVERALL_GOAL);
  const intakeQuestions = page.locator('section.wire-card', { hasText: '다음에 물어볼 것' });
  await intakeQuestions.getByLabel('다음에 물어볼 것').fill(QUESTION);
  await intakeQuestions.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // ── 상담 일정 등록(2회차) ───────────────────────────────────
  await expect(page).toHaveURL(/\/schedule$/);
  const caseId = page.url().match(/#\/cases\/(\d+)\//)?.[1];
  expect(caseId, '일정 등록은 사례 주소다').toBeTruthy();
  await pickDateTime(page, 'schedule', '2026-10-01T10:00');
  await page.getByRole('radio', { name: '대면' }).check();
  await page.locator('#place').fill('사회연대은행 상담실');
  await page.getByRole('button', { name: '일정 저장', exact: true }).click();
  // 저장하면 상담 일정 보기로 돌아온다(2026-09-17 Q — 잇달아 잡는 일이 많다).
  await expect(page).toHaveURL(/#\/schedule$/);
  await expect(page.getByRole('heading', { name: '상담 일정', level: 1, exact: true })).toBeVisible();

  // ── 2회차 상담 기록하기 ─────────────────────────────────────
  await recordFromList(page, NAME, true);

  // 인테이크에서 만든 질문이 레일에 올라와 있다.
  const rail = page.locator('.record-side');
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
  // 기록 저장의 도착지는 그 사람의 당사자 정보다(안 바뀐다).
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // ── 3회차 일정 등록 ─────────────────────────────────────────
  // 기록을 끼지 않는 순수 일정 등록은 사례 주소로 들어간다(2026-09-18 A1 — 메뉴 입구는 없어졌고
  // 목록 카드의 `상담 기록하기`는 저장 뒤 기록으로 잇는 길이다).
  await page.goto(`/#/cases/${caseId}/schedule`);
  await pickDateTime(page, 'schedule', '2026-10-08T10:00');
  await page.getByRole('radio', { name: '전화' }).check();
  await page.getByRole('button', { name: '일정 저장', exact: true }).click();
  // 저장하면 상담 일정 보기로 돌아온다(2026-09-17 Q — 잇달아 잡는 일이 많다).
  await expect(page).toHaveURL(/#\/schedule$/);
  await expect(page.getByRole('heading', { name: '상담 일정', level: 1, exact: true })).toBeVisible();

  // ── 당사자 정보 탭: 회차 정보 접힌 머리의 단위(2026-09-18 Q 결정 D14) ──
  // 회차·기록은 `회`, 문서·녹음·전사는 `건`. 수만 있고 단위가 없으면 무엇을 센 것인지 읽히지 않는다.
  await openInfo(page, '당사자 정보', caseId);
  const seqInfo = page.locator('details', { has: page.getByText('회차 정보') }).first();
  await expect(seqInfo.locator('.fold-title-desc')).toHaveText(/수기 기록 \d+회/);
  await expect(seqInfo.locator('.fold-title-desc')).toHaveText(/전사 승인 \d+건/);

  // ── 회차별 요약 탭: 한 회차가 한 접힘 카드다(2026-09-17 Q — 상단 위험 신호 배너 폐지) ──
  await openInfo(page, '회차별 요약', caseId);
  // 배너는 더 이상 없다. 위험 신호는 그 신호가 나온 회차 카드가 말한다.
  await expect(page.locator('.risk-banner')).toHaveCount(0);
  const summaryCard = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  // 최신순이다 — 맨 위가 마지막 회차다.
  await expect(summaryCard.locator('details').first().locator('.seq-head-no')).toHaveText('2회차');
  await expect(summaryCard.locator('details')).toHaveCount(2);

  // ── 목표 탭(2026-09-18 Q 개편): 전체·다음 상담 목표는 입력칸, 이력은 모달 ──────
  await page.getByRole('tab', { name: '목표' }).click();
  await expect(page.getByLabel('전체 상담 목표', { exact: true })).toHaveValue(OVERALL_GOAL);
  // 2회차가 쓴 다음 상담 목표는 아직 어느 회차도 이어받지 않았으므로 여기서 고칠 수 있다.
  await expect(page.getByLabel('다음 상담 목표', { exact: true })).toHaveValue(NEXT_GOAL);
  await expect(page.locator('section.wire-card', { hasText: '다음 상담 목표' })).toContainText('2회차에서 정함');
  // 지난 목표 모달: 이력 첫 줄은 `승인`. 회차별 오늘 상담 목표는 기록된 회차만 — 3회차는 예정이라 비어 있다.
  await page.getByRole('button', { name: '지난 목표 보기' }).click();
  const goalDialog = page.getByRole('dialog', { name: '지난 목표' });
  await expect(goalDialog).toBeVisible();
  await expect(goalDialog).toContainText(OVERALL_GOAL);
  await expect(goalDialog).toContainText('승인');
  await expect(goalDialog).toContainText('이어받은 목표 없음');
  await goalDialog.getByRole('button', { name: '닫기' }).click();
  await expect(goalDialog).toBeHidden();

  // ── 회차별 원본 보기: 2회차가 넘긴 다음 상담 목표 ───────────
  // 열리는 것은 큰 팝업 두 열(수기 · 녹음 전사)이다(2026-09-18 Q E2 — 드로어 폐지).
  await page.getByRole('tab', { name: '회차별 원본 보기' }).click();
  await page
    .locator('.wire-repeat-card', { hasText: '2회차' })
    .getByRole('button', { name: '원본 보기' })
    .click();
  const originalDialog = page.getByRole('dialog', { name: '2회차 원본' });
  await expect(originalDialog.getByRole('region', { name: '수기 기록' })).toContainText(NEXT_GOAL);
  await expect(originalDialog.getByRole('region', { name: '녹음 전사' })).toContainText('올라온 녹음 없음');
  // 원문 수정은 편집 모드 + 리비전 로그다(D3, L5 `POST /sessions/:id/revisions`). 저장하면 원문이
  // 바뀌고 수정 기록이 남는다 — 지울 수 없다.
  const written = originalDialog.getByRole('region', { name: '수기 기록' });
  await written.getByRole('button', { name: '수정', exact: true }).click();
  const memoBox = originalDialog.getByRole('textbox', { name: '오늘 상담 내용' });
  await expect(memoBox).toHaveValue('내역서는 아직 못 뗐다고 함.');
  await memoBox.fill('내역서는 아직 못 뗐다고 함. 다음 주 발급 예정.');
  await written.getByRole('button', { name: '저장', exact: true }).click();
  await expect(written).toContainText('다음 주 발급 예정.');
  await expect(written).toContainText('수정 기록 1');
  await expect(memoBox).toHaveCount(0);
  await originalDialog.getByRole('button', { name: '닫기' }).click();
  await expect(originalDialog).toBeHidden();
  // 팝업을 닫아도 회차 목록을 떠나지 않는다.
  await expect(page.getByRole('tab', { name: '회차별 원본 보기' })).toBeVisible();

  // ── 확인할 과제·오늘 물어볼 것은 상담 기록하기의 레일이 보여 준다 ──
  // 같은 자료를 쓰던 15초 다시보기 화면이 없어져, 이 흐름의 유일한 자리다.
  // 3회차가 예정돼 있으니 그 회차를 확인하고 기록으로 넘어간다.
  await recordFromList(page, NAME, true);
  await expect(rail).toContainText(TASK);
  await expect(rail).toContainText(QUESTION);
  // `지난 회차 미확인` 꼬리표는 15초 다시보기 화면에만 있던 표기다(2026-09-17 Q 폐지) —
  // 기록 레일은 질문과 출처 회차를 싣고 결과는 그 자리에서 고른다.
  await expect(rail).toContainText('1회차');

  // 기록 화면에는 문장별 카드 분류를 고르는 입력이 없다
  await expect(page.getByText('사실', { exact: true })).toHaveCount(0);
  await expect(page.getByText('약속한 일', { exact: true })).toHaveCount(0);

  // ── 돌아오는 길 ─────────────────────────────────────────────
  // URL 을 외우지 않고 목록에서 이 사례로 되돌아올 수 있어야 한다.
  await page.getByRole('link', { name: '당사자 목록', exact: true }).click();
  await page.locator('#q').fill(NAME);
  const row = page.locator('.participant-card').filter({ hasText: NAME });
  // 접힌 머리는 한 행 요약이다(2026-09-17 Q) — 회차는 사업명 뒤에 붙는다.
  await expect(row.locator('.participant-card-id')).toContainText('2회차');
  await row.getByRole('link', { name: new RegExp(`^${NAME},.*당사자 정보$`) }).click();
  // 당사자 카드가 머리다 — 제목이 사람 이름이다(2026-09-17 Q).
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await page.getByRole('tab', { name: '회차별 요약' }).click();
  await expect(page.locator('section.wire-card', { hasText: '회차별 요약' })).toContainText('2회차');
});

// 일정을 미리 잡지 않고 만난 상담(갑작스러운 방문·전화)도 그 자리에서 기록돼야 한다.
test('예정 회차가 없어도 상담 기록하기에서 일시를 적고 기록한다', async ({ page }) => {
  const name = `E2E 즉석${Date.now()}`;

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 일정 등록 화면이 떠도 등록하지 않고 바로 기록하기로 간다
  await expect(page).toHaveURL(/\/schedule$/);
  await recordFromList(page, name, false);

  await pickDateTime(page, 'held-at', '2026-09-20T14:00');
  await page.getByRole('radio', { name: '전화' }).check();
  await page.locator('#memo').fill('예고 없이 전화가 와서 그 자리에서 상담함');
  await page.getByRole('button', { name: '저장' }).click();

  // 2회차로 저장되고, 당사자 카드가 그 회차 수를 싣는다(2026-09-17 Q — 15초 다시보기 폐지).
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  await expect(page.locator('.participant-hero-card')).toContainText('2회차까지 기록');
});

// 상담 종결은 회차가 아니다. 회차 번호를 받지 않고, 미완료 과제를 자동 처리하지 않는다(SPEC §4-3).
test('상담 종결은 회차를 만들지 않고 미완료 과제를 그대로 남긴다', async ({ page }) => {
  const name = `E2E 종결${Date.now()}`;
  const task = '주민센터에서 서류 떼어 오기';

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 예정 없이 2회차를 기록하면서 과제를 하나 남긴다
  await expect(page).toHaveURL(/\/schedule$/);
  await recordFromList(page, name, false);
  await pickDateTime(page, 'held-at', '2026-09-20T14:00');
  await page.locator('#memo').fill('서류를 떼어 오기로 함');
  await page.getByRole('textbox', { name: '수행할 과제' }).fill(task);
  await page.getByRole('button', { name: '추가' }).first().click();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 당사자 정보 › 정보 탭에서 종결로 들어간다
  await openInfo(page);
  await page.getByRole('tab', { name: '당사자 정보' }).click();
  await page.locator('.wire-container').getByRole('button', { name: '상담 종결' }).click();
  // 종결 앞에는 경고가 선다(2026-09-17 Q): 남은 과제·예정 회차·앞으로의 일정을 세어 보여 준다.
  const warning = page.locator('.confirm-dialog');
  await expect(warning).toContainText('미확인 과제 1건');
  await warning.getByRole('button', { name: '종결 기록 쓰기' }).click();
  await page.waitForURL(/\/record\?closing=1$/);
  // 종결도 상담이라 기록이 먼저다 — 체크는 이미 켜져 있고 레일 맨 위에 선다.
  await expect(page.getByRole('checkbox', { name: '종결 상담' })).toBeChecked();
  await pickDateTime(page, 'held-at', '2026-09-21T14:00');
  await page.locator('#memo').fill('마지막으로 정리하고 마무리함');
  await page.getByRole('button', { name: '저장' }).click();
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
  // 기본 탭은 `당사자 정보`라 요약을 보려면 탭을 고른다(2026-09-17 Q 최종 4탭).
  await page.getByRole('tab', { name: '회차별 요약' }).click();
  const closure = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '상담 종결' }) });
  await expect(closure).toContainText('타 기관 의뢰');
  await expect(closure).toContainText('연계 기관에서 이어받기로 함');
  await expect(closure).not.toContainText('3회차');

  // 목록에서도 종결로 보인다
  await page.getByRole('link', { name: '당사자 목록', exact: true }).click();
  await page.locator('#q').fill(name);
  // 상태는 배지가 아니라 머리의 컬러 텍스트다(2026-09-18 Q A3).
  await expect(
    page.locator('.participant-card').filter({ hasText: name }).locator('.participant-state'),
  ).toHaveText('종결');
});

// 요구 5 — 기록 화면에서 `종결 상담`을 고르면 저장 성공 뒤 종결 화면으로 간다.
test('종결 상담으로 저장하면 종결 화면으로 이어진다', async ({ page }) => {
  const name = `E2E 종결상담${Date.now()}`;

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 일정 등록에서 종결 상담으로 잡는다
  await expect(page).toHaveURL(/\/schedule$/);
  await pickDateTime(page, 'schedule', '2026-10-01T10:00');
  await page.getByRole('checkbox', { name: '종결 상담' }).check();
  await page.getByRole('button', { name: '일정 저장', exact: true }).click();
  await expect(page).toHaveURL(/#\/schedule$/);

  // 기록 화면이 그 표시를 이어받는다
  await recordFromList(page, name, true);
  await expect(page.getByRole('checkbox', { name: '종결 상담' })).toBeChecked();
  await page.locator('#memo').fill('마지막으로 정리하고 마무리함');
  await page.getByRole('button', { name: '저장하고 종결로' }).click();

  // 저장 성공 뒤 종결 화면. 아직 닫히지는 않았다.
  await page.waitForURL(/\/close$/);
  await expect(page.getByRole('heading', { name: '종결 사유' })).toBeVisible();
  await page.getByRole('radio', { name: '목표 달성' }).check();
  await page.getByRole('button', { name: '종결 확정' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
});

// 당사자는 비밀번호가 맞아도 들어오지 못한다. 열람은 실무자가 보낸 링크와 코드다(GLOSSARY §3).
test('당사자 계정은 로그인되지 않고 이유를 말한다', async ({ page }) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test3');
  await page.locator('#password').fill('test3');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page.getByText('당사자 로그인 불가', { exact: false })).toBeVisible();
  await expect(page.locator('.app-nav-me')).toHaveCount(0);
});

// 인테이크는 한 번 쓰고 끝이 아니다. 다시 열어 고칠 수 있어야 한다(2026-09-15 Q).
test('인테이크를 다시 열어 고쳐 쓴다', async ({ page }) => {
  const name = `E2E 인테이크수정${Date.now()}`;

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.locator('#overall-goal').fill('처음 적은 목표');
  await page.getByRole('textbox', { name: '수행할 과제' }).fill('처음 적은 과제');
  await page.locator('section.wire-card').filter({ has: page.getByRole('heading', { name: '수행할 과제' }) })
    .getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page).toHaveURL(/\/schedule$/);

  // 다시 열면 적어 둔 것이 그대로 있다.
  // 한 번 쓴 인테이크는 메뉴에 없다 — 원본 팝업의 잠근 인테이크 화면에서 `수정` 으로 고쳐 쓴다
  // (2026-09-18 Q F4 — 요약 머리의 `수정` 은 요약문 수정이다).
  await openInfo(page, '회차별 원본 보기');
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  await page.locator('.wire-repeat-card', { hasText: '인테이크' }).getByRole('button', { name: '원본 보기' }).click();
  const intakeOriginal = page.getByRole('dialog', { name: '1회차 원본' });
  await expect(intakeOriginal.locator('#overall-goal')).toHaveValue('처음 적은 목표');
  await intakeOriginal.getByRole('button', { name: '수정', exact: true }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await expect(intakeOriginal).toHaveCount(0);
  await expect(page.locator('#overall-goal')).toHaveValue('처음 적은 목표');
  await expect(page.locator('section.wire-card').filter({ has: page.getByRole('heading', { name: '수행할 과제' }) }))
    .toContainText('처음 적은 과제');

  // 고쳐 쓰면 새 회차를 만들지 않고 그 자리를 고친다
  await page.locator('#overall-goal').fill('고쳐 적은 목표');
  await page.getByRole('button', { name: '저장' }).click();
  // 고친 전체 목표는 `목표` 탭이 싣는다(2026-09-17 Q — 구 15초 다시보기 자리 대체).
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  await page.getByRole('tab', { name: '목표' }).click();
  await expect(
    page.locator('section.wire-card', { hasText: '전체 상담 목표' }).first(),
  ).toContainText('고쳐 적은 목표');

  // 회차가 늘지 않았다 — 수정은 새 회차를 만들지 않는다
  await openInfo(page, '회차별 요약');
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

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  // 인테이크에서 `추가`를 누르지 않고 적어만 둔다
  await page.getByRole('textbox', { name: '수행할 과제' }).fill(task);
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 2회차를 예정 없이 기록한다. 과제는 진행 전으로.
  await expect(page).toHaveURL(/\/schedule$/);
  await recordFromList(page, name, false);
  const rail = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '확인할 과제' }) });
  await expect(rail).toContainText(task); // 적어만 둔 줄이 저장돼 올라왔다
  await pickDateTime(page, 'held-at', '2026-10-01T10:00');
  await page.locator('#memo').fill('처음 적은 상담 내용');
  await rail.getByRole('radio', { name: '진행 전' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 당사자 정보 › 회차별 원본 보기 팝업의 `기록 수정` 으로 그 회차를 고쳐 쓴다(2026-09-18 Q F4)
  await openInfo(page, '회차별 원본 보기');
  await page.locator('.wire-repeat-card', { hasText: '2회차' }).getByRole('button', { name: '원본 보기' }).click();
  await page.getByRole('dialog', { name: '2회차 원본' }).getByRole('button', { name: '기록 수정' }).click();
  await expect(page).toHaveURL(/\/edit$/);

  // 지난번에 적은 것과 매긴 결과가 그대로 서 있다
  await expect(page.locator('#memo')).toHaveValue('처음 적은 상담 내용');
  await expect(page.getByRole('radio', { name: '진행 전' })).toBeChecked();

  await page.locator('#memo').fill('고쳐 적은 상담 내용');
  await page.getByRole('radio', { name: '완료' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 완료로 바꿨으니 확인할 과제에서 빠지고, 회차는 늘지 않는다
  await expect(page.locator('.wire-container')).not.toContainText(task);
  await openInfo(page, '회차별 요약');
  const summary = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await expect(summary).toContainText('2회차');
  await expect(summary).not.toContainText('3회차');
});

// P1 동의 게이트. 민감정보 처리 동의 없이는 상담 자유 글을 저장하지 않는다.
test('민감정보 동의가 없으면 기록을 저장하지 못하고, 받으면 저장된다', async ({ page }) => {
  const name = `E2E 동의${Date.now()}`;

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  // 필수 동의만 켜고 민감정보는 끈 채 등록한다
  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await expect(page.getByRole('button', { name: '등록하고 인테이크 쓰기' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();

  // 인테이크 저장이 막힌다
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page.getByText('민감정보 처리 동의 없음', { exact: false })).toBeVisible();

  // 당사자 정보 › 정보 탭에서 동의를 받는다
  await openInfo(page);
  await page.getByRole('tab', { name: '당사자 정보' }).click();
  const consent = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '동의' }) });
  // 동의 항목은 접힘 카드 하나다(2026-09-17 Q). 접힌 머리에 상태가 서고, 펼치면 동의문 전문과
  // 체크 하나가 있다 — `동의 받기`·`철회` 버튼은 걷었다.
  const sensitive = consent.locator('details', { has: page.getByText('민감정보 처리', { exact: true }) });
  await expect(sensitive.locator('.fold-title-desc')).toContainText('동의 없음');
  await sensitive.locator('summary').click();
  await expect(sensitive.getByText('동의 내용', { exact: true })).toBeVisible();
  const sensitiveCheck = sensitive.getByRole('checkbox', { name: '동의', exact: true });
  await expect(sensitiveCheck).not.toBeChecked();
  // `check()` 대신 클릭이다 — 저장 동안 입력이 잠시 잠겨 Playwright 의 즉시 확인이 어긋난다.
  await sensitiveCheck.click();
  await expect(sensitive.locator('.fold-title-desc')).toContainText('동의함');
  await expect(sensitiveCheck).toBeChecked();

  // 이제 저장된다. 인테이크는 메뉴에 없다 —
  // 아직 아무 기록이 없는 사례라 회차별 요약의 빈 상태에서 바로 연다.
  await page.getByRole('tab', { name: '회차별 요약' }).click();
  await page.getByRole('button', { name: '인테이크 작성하기' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();
  await expect(page).toHaveURL(/\/schedule$/);
});

// P1 열람 기록. PII 를 실은 화면 조회 1건 = 감사 1행, 항목 이름만 남는다.
test('PII 를 본 조회가 열람 기록에 남고, 관리자만 본다', async ({ page }) => {
  // 실무자가 당사자 정보를 본다
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
  await page.goto('/#/cases/1/info');
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 실무자 사이드바에는 `시스템` 묶음이 서지 않는다(2026-09-16 Q 3차 — 묶음마다 메뉴 하나).
  await expect(page.getByRole('link', { name: '시스템' })).toHaveCount(0);
  await page.goto('/#/settings/system');
  await expect(page.getByText('관리자 전용', { exact: false })).toBeVisible();

  // 관리자로 바꿔 본다
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.locator('#email').fill('test1');
  await page.locator('#password').fill('test1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('link', { name: '시스템' }).click();

  // 시스템은 한 계층 더 들어간다(2026-09-16 Q 4차). 항목 넷은 각자 카드다(2026-09-17 Q —
  // 구 `무엇을 볼까요` 묶음 카드 안 반복 행 대체).
  await page
    .locator('section.wire-card', { hasText: '열람 기록 관리' })
    .getByRole('button', { name: '열기' })
    .click();

  // 찾기 전에는 아무것도 펼치지 않는다.
  await expect(page.getByText('기간, 확인 필요, 검색 중 하나 선택', { exact: false })).toBeVisible();
  await page.locator('#audit-q').fill('당사자 정보 조회');

  const log = page.locator('section.wire-card', { hasText: '열람 기록' });
  await expect(log).toContainText('시험 실무자');
  await expect(log).toContainText('당사자 정보 조회');
  await expect(log).toContainText('이름, 연락처, 이메일'); // 항목 이름만, 값은 없다
  await expect(log).not.toContainText('010-');
});

// P1 자유 글 암호화. 화면은 평문을 보지만 DB 에는 암호문이 앉는다.
// (DB 확인은 api/test/pii.test.ts 와 scripts/check-encryption.sh 가 맡는다. 여기서는 왕복만 본다.)
test('자유 글을 저장하고 다시 열면 그대로 읽힌다', async ({ page }) => {
  const name = `E2E 암호화${Date.now()}`;
  const memo = '건강·채무 이야기가 섞인 상담 내용';

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  await expect(page).toHaveURL(/\/schedule$/);
  await recordFromList(page, name, false);
  await pickDateTime(page, 'held-at', '2026-10-05T10:00');
  await page.locator('#memo').fill(memo);
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 원본은 `회차별 원본 보기` 탭에서 큰 팝업으로 연다(2026-09-18 Q E2).
  await openInfo(page, '회차별 원본 보기');
  await page
    .locator('.wire-repeat-card', { hasText: '2회차' })
    .getByRole('button', { name: '원본 보기' })
    .click();
  await expect(page.getByRole('dialog', { name: '2회차 원본' })).toContainText(memo);
});

// P2 당사자 열람. 당사자는 로그인하지 않고 링크+코드로 자기 정보와 일정만 본다.
test('당사자는 링크와 코드로 자기 일정만 본다', async ({ page, context }) => {
  const name = `E2E 열람${Date.now()}`;

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.locator('#phone').fill('010-5555-6666');
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 앞으로의 일정 하나
  await expect(page).toHaveURL(/\/schedule$/);
  const caseId = page.url().match(/#\/cases\/(\d+)\//)?.[1];
  await pickDateTime(page, 'schedule', '2026-12-01T10:00');
  await page.getByRole('button', { name: '일정 저장', exact: true }).click();
  await expect(page).toHaveURL(/#\/schedule$/);

  // 실무자가 열람 링크를 만든다
  await openInfo(page, undefined, caseId);
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  await page.getByRole('tab', { name: '당사자 정보' }).click();
  const access = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '개인정보 및 민감정보 처리 동의 링크' }) });
  await access.getByRole('button', { name: '링크 만들기' }).click();
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
  await expect(guestPage.getByText('코드 불일치', { exact: false })).toBeVisible();

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

  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.goto('/#/participants/new');
  await page.locator('#name').fill(name);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  // 사업은 고르기다(2026-09-16 Q) — 시드 사업을 이름으로 집는다(목록은 최신이 위라 첫 칸이 매번 바뀐다).
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await page.getByRole('button', { name: '저장하고 상담 일정 잡기' }).click();

  // 예정 없이 2회차를 기록한다
  await expect(page).toHaveURL(/\/schedule$/);
  await recordFromList(page, name, false);
  await pickDateTime(page, 'held-at', '2026-10-05T10:00');
  await page.locator('#memo').fill('연체 2건 확인. 서류는 다음 주에 떼기로 함.');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();

  // 회차별 요약 → AI 정리
  await openInfo(page, '회차별 요약');
  await expect(page.getByRole('tab', { name: '당사자 정보' })).toBeVisible();
  const summary = page
    .locator('section.wire-card')
    .filter({ has: page.getByRole('heading', { name: '회차별 요약' }) });
  await summary.locator('details', { hasText: '2회차' }).getByRole('button', { name: /^AI 정리/ }).click();
  await page.waitForURL(/\/review$/);

  // 동의가 없으니 정리가 막힌다
  await page.getByRole('button', { name: 'AI로 정리하기' }).click();
  await expect(page.getByText('외부 LLM·국외 처리 동의 없음', { exact: false })).toBeVisible();
});

// 잘못 쓴 요청은 **400** 이다. 500 으로 답하면 서버가 고장난 줄 안다.
// 2026-09-15 실측: ZodError 를 잡는 곳이 없어 모든 잘못된 입력이 500 이었다.
test('스키마에 안 맞는 요청은 400 으로 답한다', async ({ page, request }) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();

  const cookies = await page.context().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // 개발 서버는 /api 를 API 로 넘긴다(web/src/api.ts:44).
  const res = await request.post(`${process.env.PLAYWRIGHT_API_PREFIX ?? '/api'}/cases`, {
    headers: { cookie, 'content-type': 'application/json' },
    data: { name: '검증', program_id: 1, consents: [{ domain: '없는_영역', decision: 'grant' }] },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  // 어느 자리가 틀렸는지만 알려 준다. 보낸 값은 되돌려주지 않는다 — PII 가 섞여 있다.
  expect(body.error).toContain('consents.0.domain');
  expect(body.error).not.toContain('없는_영역');
});
