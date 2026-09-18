// 첫 가입 → 마법사 다섯 단계 → 당사자 등록 → 담당 배정 → 사업별 필터 링크.
// **seed 없는 새 DB** 에서만 뜻이 있는 흐름이라 DB 와 API 서버를 따로 띄우고, 화면은 빌드된 dist 를
// 그 서버가 같은 출처로 낸다(배포와 같은 모양). 다른 e2e 처럼 :5173 시드 서버를 쓰지 않는다.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { scratchDb, startServer, type Scratch } from '../../api/test/scratch-db.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = Date.now();
const ORG = `E2E 기관 ${stamp}`;
const PROGRAM = `E2E 사업 ${stamp}`;
const PARTICIPANT = `E2E 당사자 ${stamp}`;

let scratch: Scratch;
let base: string;
let stop: () => void;

test.beforeAll(async () => {
  // 서버가 내는 화면은 web/dist 다. 지금 코드로 다시 짓는다.
  execFileSync('pnpm', ['--dir', 'web', 'build'], { cwd: root, stdio: 'ignore' });
  scratch = await scratchDb();
  await scratch.migrate();
  ({ base, stop } = await startServer(scratch.url, { RELAYER_SLUG: 'e2e-slug' }));
});
test.afterAll(async () => {
  stop?.();
  await scratch?.drop();
});

// 가입부터 사업별 필터까지 한 시험 안에서 잇는다 — 화면이 열 개 남짓이라 기본 60초로는 빠듯하다.
test.setTimeout(180_000);

test('첫 가입에서 마법사, 당사자 등록, 배정, 사업별 필터까지 한 바퀴', async ({ page, browser }) => {
  // S1 API가 아직 main에 없으므로 UI 계약만 실제 응답 모양으로 가로챈다. 성공을 만드는 production shim은 두지 않는다.
  await page.route('**/settings/connections', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ai: { connected: false, provider: 'openai', model: 'gpt-4.1-mini', env: 'OPENAI_API_KEY', source: null },
        stt: { connected: false, provider: 'azure', region: 'koreacentral', source: null },
        voice: { enabled: false, source: null },
        db: { connected: true, checked_at: '2026-09-18T00:00:00.000Z', env: 'DATABASE_URL' },
      }),
    }),
  );
  // ── 랜딩 = 로그인 화면 → 가입하기 ─────────────────────────────
  await page.goto(`${base}/app#/login`);
  await expect(page.locator('#email')).toBeVisible();
  await page.getByRole('link', { name: '가입하기' }).click();
  await expect(page).toHaveURL(/#\/signup$/);
  // 새 DB: 첫 가입 문이 열려 있다. 계정만 만든다.
  await expect(page.getByRole('heading', { name: '관리자 계정 만들기', level: 1 })).toBeVisible();
  await page.locator('#su-email').fill('e2e-admin');
  await page.locator('#su-pw').fill('e2e-admin');
  await page.locator('#su-name').fill('E2E 관리자');
  await page.getByRole('button', { name: '계정 만들기' }).click();

  // ── 1단계: 기관 워크스페이스 만들기 ─────────────────────────────
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole('heading', { name: '기관 워크스페이스 설정하기', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: '1. 기관 워크스페이스', selected: true })).toBeVisible();
  // 주소는 배포 설정(RELAYER_SLUG)에서 온 값 표시다 — 입력칸이 아니다(2026-09-18 Q).
  await expect(page.getByText('e2e-slug', { exact: true })).toBeVisible();
  await expect(page.locator('#ws-slug')).toHaveCount(0);
  // 마치기 전에 다른 화면으로 가면 마법사로 돌아온다.
  await page.goto(`${base}/app#/participants`);
  await expect(page).toHaveURL(/#\/onboarding$/);
  await page.locator('#ws-name').fill(ORG);
  await page.getByRole('button', { name: '기관 워크스페이스 만들기' }).click();

  // 2단계: 기관 정보 — 이름은 1단계에서 들어왔고 주소는 제목 옆 배지다. `다음` 이 저장한다.
  await expect(page.getByRole('tab', { name: '2. 기관 정보', selected: true })).toBeVisible();
  await expect(page.locator('#og-name')).toHaveValue(ORG);
  await expect(page.getByText('e2e-slug', { exact: true })).toBeVisible();
  await page.locator('#og-reg').fill('123-45-67890');
  await page.locator('#og-addr').fill('서울시 어딘가 1');
  await page.locator('#og-tel').fill('02-000-0000');
  await page.getByRole('button', { name: '다음' }).click();

  // 3단계: 사업 — 목록 위 한 줄(입력칸 + `사업 추가`)에서 바로 더한다. 하나 이상 있어야 다음이 열린다.
  await expect(page.getByRole('tab', { name: '3. 사업', selected: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.locator('#pg-new-name').fill(PROGRAM);
  await page.getByRole('button', { name: '사업 추가' }).click();
  // 방금 만든 사업의 아코디언은 펼쳐진 채로 온다 — 바로 설명을 적는다.
  const fold = page.locator('details.wire-card-details', { hasText: PROGRAM });
  await expect(fold).toHaveAttribute('open', '');
  await fold.getByLabel('한 줄 설명').fill('마법사에서 만든 사업');
  await fold.getByRole('button', { name: '저장', exact: true }).click();
  await expect(fold.locator('summary')).toContainText('마법사에서 만든 사업');
  const stepSaved = page.waitForResponse((r) => r.url().endsWith('/settings/onboarding/step') && r.status() === 200);
  await page.getByRole('button', { name: '다음' }).click();

  // 4단계: 실무자 초대 — 링크를 하나 만들어 실무자가 먼저 들어오게 한다. 마법사가 끝나기 전이라 그 사람은 '기관 준비 중' 을 본다.
  await expect(page.getByRole('tab', { name: '4. 실무자 초대', selected: true })).toBeVisible();
  // 재진입(QA P2 #9): 세션이 끊겨 다시 들어와도 서 있던 단계에서 선다 — 1단계로 되돌아가지 않는다.
  await stepSaved;
  await page.reload();
  await expect(page.getByRole('tab', { name: '4. 실무자 초대', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '실무자 초대' })).toBeVisible();
  await page.getByRole('button', { name: '링크 만들기' }).click();
  const inviteLink = (await page.locator('code').first().textContent()) ?? '';
  expect(inviteLink).toMatch(/#\/invite\//);
  // 링크 아래 QR(온보딩 후속 3).
  await expect(page.getByRole('img', { name: '초대 링크 QR' })).toBeVisible();
  const worker = await browser.newPage();
  await worker.goto(inviteLink.replace(/^https?:\/\/[^/]+/, base));
  await worker.locator('#iv-email').fill('e2e-worker');
  await worker.locator('#iv-pw').fill('e2e-worker');
  await worker.locator('#iv-name').fill('E2E 실무자');
  await worker.getByRole('button', { name: '들어가기' }).click();
  await expect(worker).toHaveURL(/#\/setup-pending$/);
  await expect(worker.getByRole('heading', { name: '기관 준비 중', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // 5단계: AI, Speech 키, 녹음 토글, DB 상태를 같은 ConnectionsPane에서 확인한다.
  await expect(page.getByRole('tab', { name: '5. 외부 서비스 연결', selected: true })).toBeVisible();
  for (const name of ['1. AI 정리', '2. 녹음 글로 옮기기', '3. 상담 녹음', '4. 데이터베이스']) {
    await expect(page.locator('details.wire-card-details summary', { hasText: name })).toBeVisible();
  }
  // 상태 배지는 민트/코랄뿐이다(QA P2 #8 — blue 톤 없음).
  await expect(page.locator('.connection-list .wire-badge[data-tone="blue"]')).toHaveCount(0);
  // 설정 가이드는 아코디언 안 알약이고 누르면 팝업이다(온보딩 후속 2).
  const dbFold = page.locator('details.wire-card-details', { hasText: '4. 데이터베이스' });
  await dbFold.locator('summary').click();
  await dbFold.getByRole('button', { name: '설정 가이드' }).click();
  const guide = page.locator('#guide-db-dialog');
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: '데이터베이스 설정 가이드' })).toBeVisible();
  await guide.getByRole('button', { name: '닫기' }).click();
  await expect(guide).toBeHidden();
  await page.getByRole('button', { name: '완료' }).click();

  // ── 완료 화면 = 기관 요약 → 상담 일정 ──────────────────────────
  await expect(page).toHaveURL(/#\/workspace\?done=1$/);
  await expect(page.getByRole('heading', { name: '기관 설정 완료', level: 1 })).toBeVisible();
  await expect(page.getByText(ORG, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '상담 일정으로 이동하기' }).click();
  await expect(page).toHaveURL(/#\/schedule$/);

  // 준비가 끝나면 실무자도 들어온다.
  await worker.getByRole('button', { name: '다시 확인하기' }).click();
  await expect(worker).toHaveURL(/#\/schedule$/);
  await worker.close();

  // 가입 문은 영구히 닫혔다. 로그아웃 상태의 가입하기는 계정을 만들지 않고 초대 안내만 낸다.
  const gate = await page.request.get(`${base}/auth/signup`);
  expect(await gate.json()).toEqual({ open: false, workspace: { name: ORG, slug: 'e2e-slug', public_address: 'e2e-slug' } });
  const stranger = await browser.newPage();
  await stranger.goto(`${base}/app#/signup`);
  await expect(stranger.getByRole('heading', { name: '초대 링크로만 가입 가능', level: 1 })).toBeVisible();
  await expect(stranger.locator('#su-email')).toHaveCount(0);
  await expect(stranger.getByText(ORG, { exact: true })).toBeVisible();
  // 세션 없는 깊은 주소는 랜딩을 거치지 않고 로그인으로 가고, 로그인 뒤 그 주소로 돌아간다.
  await stranger.goto(`${base}/app#/settings/org`);
  await expect(stranger.locator('#email')).toBeVisible();
  await stranger.locator('#email').fill('e2e-admin');
  await stranger.locator('#password').fill('e2e-admin');
  await stranger.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(stranger).toHaveURL(/#\/settings\/org$/);
  await stranger.close();

  // ── 당사자 등록 ─────────────────────────────────────────────
  await page.goto(`${base}/app#/participants/new`);
  await page.locator('#name').fill(PARTICIPANT);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  // 사업이 하나뿐이라 이미 골라져 있다.
  await expect(page.locator('#program')).toHaveValue(/^\d+$/);
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/#\/cases\/\d+\/intake$/);

  // 마법사를 마쳤으니 이제 다른 화면으로 가도 되돌아오지 않는다.
  await page.goto(`${base}/app#/participants`);
  await expect(page).toHaveURL(/#\/participants$/);

  // ── 관리자 배정 — 행의 `실무자 배정` 이 드로어를 열고, 지금 담당은 배지를 단 채 서 있다 ──
  await page.goto(`${base}/app#/settings/staff`);
  const assignCard = page.locator('section.wire-card', { hasText: '담당 실무자 배정' });
  await assignCard.getByRole('button', { name: /실무자 배정$/ }).first().click();
  const drawer = page.locator('dialog.assign-drawer');
  // 등록한 사람이 첫 담당이다 — 이미 목록에 있다. 저장으로 배정을 확정한다.
  await expect(drawer.locator('.assign-pick-row', { hasText: 'E2E 관리자' })).toContainText('담당 실무자');
  await drawer.getByRole('button', { name: '저장', exact: true }).click();
  await expect(assignCard.getByText(/담당 E2E 관리자/)).toBeVisible();

  // ── 사업별 보기 — 아코디언을 펼치면 파생 정보가 있고, 목록은 걸개 주소로 바로 간다 ──
  await page.goto(`${base}/app#/settings/org`);
  const programFold = page.locator('details.wire-card-details', { hasText: PROGRAM });
  await expect(programFold.locator('summary')).toContainText('마법사에서 만든 사업');
  await programFold.locator('summary').click();
  await expect(programFold.getByText('참여 당사자')).toBeVisible();
  await expect(programFold.getByText('E2E 관리자', { exact: true })).toBeVisible();
  const programs = (await (await page.request.get(`${base}/settings/programs`)).json()) as Array<{ id: number; name: string }>;
  const programId = String(programs.find((p) => p.name === PROGRAM)!.id);
  await page.goto(`${base}/app#/participants?program=${programId}`);
  // 걸개가 그 사업으로 걸린 채 열린다.
  await expect(page.locator('#filter-program')).toHaveValue(programId);
  await expect(page.getByRole('link', { name: new RegExp(`^${PARTICIPANT},.*당사자 정보$`) })).toBeVisible();
  await page.goto(`${base}/app#/settings/staff?program=${programId}`);
  await expect(page).toHaveURL(new RegExp(`#/settings/staff\\?program=${programId}$`));
  await expect(page.locator('#wk-program')).toHaveValue(programId);
  const workers = page.locator('section.wire-card', { hasText: '실무자 목록' });
  await expect(workers.locator('details.wire-card-details summary', { hasText: 'E2E 관리자' })).toBeVisible();
});
