// 녹음 시작 = 회차 생성. 공유 DB를 쓰지 않고 이 spec 전용 DB와 파일 루트를 만든다.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { scratchDb, startServer, type Scratch } from '../../api/test/scratch-db.ts';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = Date.now();
const NAME = `E2E 녹음${stamp}`;
let scratch: Scratch;
let base: string;
let stop: () => void;
let storage: string;

test.beforeAll(async () => {
  execFileSync('pnpm', ['--dir', 'web', 'build'], { cwd: root, stdio: 'ignore' });
  scratch = await scratchDb();
  await scratch.migrate();
  storage = await mkdtemp(join(tmpdir(), 'relayer-voice-e2e-'));
  execFileSync(process.execPath, ['api/src/seed.ts'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: scratch.url,
      PGSCHEMA: '',
      PII_ENC_KEY: Buffer.alloc(32).toString('base64'),
    },
    stdio: 'ignore',
  });
  ({ base, stop } = await startServer(scratch.url, {
    VOICE_ENABLED: '1',
    VOICE_ROOT: join(storage, 'voice'),
    DOC_ROOT: join(storage, 'documents'),
    AZURE_SPEECH_KEY: '',
    AZURE_SPEECH_REGION: '',
    AZURE_SPEECH_ENDPOINT: '',
    PII_ENC_KEY: Buffer.alloc(32).toString('base64'),
  }));
});

test.afterAll(async () => {
  stop?.();
  await scratch?.drop();
  await rm(storage, { recursive: true, force: true });
});

test('녹음 시작이 회차를 만들고 요약과 전문 보기로 이어진다', async ({ page }) => {
  // ── 로그인 ──────────────────────────────────────────────────
  await page.goto(`${base}/app#/login`);
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();

  // ── 당사자 등록(녹음·STT 동의 포함) ─────────────────────────
  await page.goto(`${base}/app#/participants/new`);
  await page.locator('#name').fill(NAME);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await page.getByRole('checkbox', { name: /민감정보 처리/ }).check();
  await page.getByRole('checkbox', { name: /상담 녹음/ }).check();
  await page.getByRole('checkbox', { name: /외부 STT 처리/ }).check();
  await page.getByRole('checkbox', { name: /음성 원본 보유기간/ }).check();
  await page.locator('#program').selectOption({ label: '함께온기금 울타리대출' });
  await page.getByRole('button', { name: '등록하고 인테이크 쓰기' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  const caseId = page.url().match(/#\/cases\/(\d+)\/intake/)?.[1];
  expect(caseId).toBeTruthy();

  // ── 상담 기록하기 — 녹음 시작이 곧 회차 ─────────────────────
  // 인테이크는 건너뛴다 — 시작 경로가 만드는 회차가 1회차다.
  await page.goto(`${base}/app#/cases/${caseId}/record`);
  await expect(page).toHaveURL(/\/record$/);
  await expect(page.locator('.page-header')).toContainText('1회차');

  await page.getByRole('button', { name: '녹음 시작' }).click();
  await expect(page.getByText('녹음 중')).toBeVisible();
  // 회차는 시작과 함께 생긴다 — 멈추기 전에 이미 서버에 있다.
  await expect
    .poll(async () => {
      const res = await page.request.get(`${base}/cases/${caseId}/detail`);
      const detail = (await res.json()) as {
        sessions: Array<{ status: string; written: boolean }>;
      };
      return detail.sessions.filter((s) => s.status === 'done').length;
    })
    .toBe(1);

  await page.getByRole('button', { name: '녹음 멈춤' }).click();
  await expect(page.locator('audio')).toHaveCount(1);
  // STT 키가 없는 서버라 자동 전사는 건너뛴다.
  await expect(page.getByText('전사 건너뜀')).toBeVisible();

  // ── 회차별 요약 — 수기 미작성·녹음 1건·전사 상태 ────────────
  // 당사자 정보는 당사자 카드(HERO) + 탭 4개다(2026-09-17 Q). 기본 탭은 `당사자 정보`.
  await page.goto(`${base}/app#/cases/${caseId}/info`);
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await page.getByRole('tab', { name: '회차별 요약' }).click();
  // 한 회차가 한 접힘 카드다(2026-09-17 Q). 기록 상태는 펼친 본문의 `기록 상태` 구역에 있다.
  const fold = page.locator('details', { hasText: '1회차' }).first();
  // 머리 가운데는 행동 버튼 넷이 차지한다(2026-09-18 Q F4) — 제목 글자를 눌러 펼친다.
  await fold.locator('.seq-head-no').click();
  await expect(fold).toContainText('수기 미작성');
  // 수를 단위 없이 두지 않는다(2026-09-18 Q 결정 D14 — 녹음·전사는 `건`).
  await expect(fold).toContainText('녹음 1건');
  await expect(fold).toContainText('전사 건너뜀');

  // ── 원본 팝업 — 큰 모달 두 열, 왼쪽 수기·오른쪽 녹음 전사(2026-09-18 Q E2) ──
  // 전용 화면(`/full`)으로 떠나지 않는다. 두 열이 늘 같이 서므로 오가는 탭이 없다.
  await page.getByRole('tab', { name: '회차별 원본 보기' }).click();
  await page
    .locator('.wire-repeat-card', { hasText: '1회차' })
    .getByRole('button', { name: '원본 보기' })
    .click();
  const original = page.getByRole('dialog', { name: '1회차 원본' });
  await expect(original.getByRole('region', { name: '수기 기록' })).toContainText('수기 미작성');
  const voiceCol = original.getByRole('region', { name: '녹음 전사' });
  await expect(voiceCol.locator('audio')).toHaveCount(1);
  await expect(voiceCol).toContainText('전사 건너뜀');
  await original.getByRole('button', { name: '닫기' }).click();
  await expect(original).toBeHidden();

  // ── 팝업을 닫으면 목록이 그대로 있다 ───────────────────────
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(page.getByRole('tab', { name: '회차별 원본 보기' })).toBeVisible();

  // ── 미작성 회차 이어 쓰기(2026-09-18 Q D12) ─────────────────
  // 녹음만 하고 나갔다가 다시 들어오면 `이어 쓰기 / 새 회차`를 묻는다. 이어 쓰면 같은 1회차다.
  await page.goto(`${base}/app#/cases/${caseId}/record`);
  const resume = page.getByRole('dialog', { name: '미작성 회차 있음' });
  await expect(resume).toContainText('1회차, 녹음 1건, 수기 없음');
  await resume.getByRole('button', { name: '이어 쓰기' }).click();
  await expect(resume).toBeHidden();
  await expect(page.locator('.page-header')).toContainText('1회차');
  await expect(page.locator('audio')).toHaveCount(1);
  await page.locator('#memo').fill('녹음 뒤 적은 수기.');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/\/info$/);
  const res = await page.request.get(`${base}/cases/${caseId}/detail`);
  const detail = (await res.json()) as { sessions: Array<{ seq: number; written: boolean }> };
  expect(detail.sessions.map((s) => [s.seq, s.written])).toEqual([[1, true]]);
  // 수기가 채워졌으니 다시 들어와도 묻지 않는다.
  await page.goto(`${base}/app#/cases/${caseId}/record`);
  await expect(page.locator('.record-main')).toBeVisible();
  await expect(resume).toBeHidden();
  await expect(page.locator('.page-header')).toContainText('2회차');

  // 새 회차를 고르면 미작성 2회차를 덮지 않고 3회차를 만든다.
  await page.getByRole('button', { name: '녹음 시작' }).click();
  await expect(page.getByText('녹음 중')).toBeVisible();
  await page.getByRole('button', { name: '녹음 멈춤' }).click();
  await expect(page.locator('audio')).toHaveCount(1);
  await page.goto(`${base}/app#/cases/${caseId}/info`);
  await page.goto(`${base}/app#/cases/${caseId}/record`);
  await expect(resume).toContainText('2회차, 녹음 1건, 수기 없음');
  await resume.getByRole('button', { name: '새 회차' }).click();
  await expect(resume).toBeHidden();
  await expect(page.locator('.page-header')).toContainText('3회차');
  await page.locator('#memo').fill('미작성 회차와 분리한 새 기록.');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/\/info$/);
  const afterNew = await page.request.get(`${base}/cases/${caseId}/detail`);
  const afterNewDetail = (await afterNew.json()) as { sessions: Array<{ seq: number; written: boolean }> };
  expect(afterNewDetail.sessions.map((s) => [s.seq, s.written])).toEqual([
    [1, true],
    [2, false],
    [3, true],
  ]);
});
