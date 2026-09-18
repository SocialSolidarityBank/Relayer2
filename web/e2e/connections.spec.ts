import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { scratchDb, startServer, type Scratch } from '../../api/test/scratch-db.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SPEECH_KEY = 'e2e-valid-speech-key';
const INVALID_SPEECH_KEY = 'e2e-invalid-speech-key';
const PII_ENC_KEY = Buffer.alloc(32).toString('base64');
const speechFixture = new URL('./speech-fetch-fixture.ts', import.meta.url).href;

let scratch: Scratch;
let base: string;
let stop: () => void;

test.setTimeout(120_000);

test.beforeAll(async () => {
  execFileSync('pnpm', ['--dir', 'web', 'build'], { cwd: root, stdio: 'ignore' });
  scratch = await scratchDb();
  await scratch.migrate();
  execFileSync(process.execPath, ['api/src/seed.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: scratch.url, PGSCHEMA: '', PII_ENC_KEY },
    stdio: 'ignore',
  });

  const voiceEnabled = process.env.VOICE_ENABLED;
  delete process.env.VOICE_ENABLED;
  try {
    ({ base, stop } = await startServer(scratch.url, {
      PII_ENC_KEY,
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: '',
      AZURE_SPEECH_ENDPOINT: '',
      RELAYER_E2E_SPEECH_KEY: SPEECH_KEY,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${speechFixture}`.trim(),
    }));
  } finally {
    if (voiceEnabled === undefined) delete process.env.VOICE_ENABLED;
    else process.env.VOICE_ENABLED = voiceEnabled;
  }
});

test.beforeEach(async () => {
  await scratch.db`
    update organization
    set enc_speech_key = null, voice_enabled = null, onboarded_at = now(), onboarding_step = 4
    where id = 1`;
});

test.afterAll(async () => {
  stop?.();
  await scratch?.drop();
});

async function login(page: Page, email = 'test1') {
  await page.goto(`${base}/app#/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(email);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('.app-nav-me')).toBeVisible();
}

test('실제 API로 Speech 키와 녹음 토글의 전체 생명주기를 저장한다', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/app#/settings/connections`);

  const speech = page.locator('details.connection-stt-card');
  await expect(speech.locator('summary')).toContainText('연결 안 됨');
  await speech.locator('summary').click();
  await expect(speech.getByText('한국 중부(koreacentral)', { exact: true })).toBeVisible();
  await expect(speech.getByLabel(/지역|리전|endpoint/i)).toHaveCount(0);

  const key = speech.getByLabel('Azure Speech 키');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(speech.locator('input[type="password"]')).toHaveCount(1);
  await key.fill(INVALID_SPEECH_KEY);
  const invalidPending = page.waitForResponse(
    (response) => response.url().endsWith('/settings/stt-key') && response.request().method() === 'PUT',
  );
  await speech.getByRole('button', { name: '저장', exact: true }).click();
  const invalid = await invalidPending;
  expect(invalid.status()).toBe(400);
  expect(await invalid.text()).not.toContain(INVALID_SPEECH_KEY);
  await expect(speech.getByRole('alert')).toHaveText(
    'Azure Speech가 이 키를 받지 않았어요. 한국 중부 리전 키인지 확인해 주세요.',
  );
  await expect(key).toHaveValue(INVALID_SPEECH_KEY);
  const [afterInvalid] = await scratch.db<Array<{ enc_speech_key: string | null }>>`
    select enc_speech_key from organization where id = 1`;
  expect(afterInvalid.enc_speech_key).toBeNull();

  await key.fill(SPEECH_KEY);
  const validPending = page.waitForResponse(
    (response) => response.url().endsWith('/settings/stt-key') && response.request().method() === 'PUT',
  );
  await speech.getByRole('button', { name: '저장', exact: true }).click();
  const valid = await validPending;
  expect(valid.status()).toBe(200);
  expect(await valid.text()).not.toContain(SPEECH_KEY);
  await expect(key).toHaveValue('');
  await expect(speech.locator('summary')).toContainText('연결됨');
  await expect(speech.locator('summary')).toContainText('저장된 키 ••••••••');
  await expect(page.locator('body')).not.toContainText(SPEECH_KEY);

  const [stored] = await scratch.db<Array<{ enc_speech_key: string | null }>>`
    select enc_speech_key from organization where id = 1`;
  expect(stored.enc_speech_key).not.toBeNull();
  expect(stored.enc_speech_key).not.toContain(SPEECH_KEY);
  const connected = await page.request.get(`${base}/settings/connections`);
  const connectedText = await connected.text();
  expect(connected.status()).toBe(200);
  expect(connectedText).not.toContain(SPEECH_KEY);
  expect(JSON.parse(connectedText).stt).toEqual({
    connected: true,
    provider: 'azure',
    region: 'koreacentral',
    source: 'db',
  });


  const voice = page.locator('details.connection-voice-card');
  await expect(voice.locator('summary')).toContainText('녹음 끔');
  await voice.locator('summary').click();
  const onPending = page.waitForResponse(
    (response) => response.url().endsWith('/settings/voice') && response.request().method() === 'PUT',
  );
  await voice.getByRole('checkbox', { name: '상담 녹음' }).check();
  expect((await onPending).status()).toBe(200);
  await expect(voice.locator('summary')).toContainText('녹음 켬');
  expect((await (await page.request.get(`${base}/settings/connections`)).json()).voice).toEqual({
    enabled: true,
    source: 'db',
  });
  expect(await (await page.request.get(`${base}/speech/status`)).json()).toMatchObject({
    enabled: true,
    transcription_ready: true,
  });

  const offPending = page.waitForResponse(
    (response) => response.url().endsWith('/settings/voice') && response.request().method() === 'PUT',
  );
  await voice.getByRole('checkbox', { name: '상담 녹음' }).uncheck();
  expect((await offPending).status()).toBe(200);
  await expect(voice.locator('summary')).toContainText('녹음 끔');
  expect((await (await page.request.get(`${base}/settings/connections`)).json()).voice).toEqual({
    enabled: false,
    source: 'db',
  });
  await speech.locator('summary').click();
  const deletePending = page.waitForResponse(
    (response) => response.url().endsWith('/settings/stt-key') && response.request().method() === 'PUT',
  );
  await speech.getByRole('button', { name: '키 지우기' }).click();
  expect((await deletePending).status()).toBe(200);
  await expect(speech.locator('summary')).toContainText('연결 안 됨');
  const removed = await (await page.request.get(`${base}/settings/connections`)).json();
  expect(removed.stt).toEqual({
    connected: false,
    provider: 'azure',
    region: 'koreacentral',
    source: null,
  });
  await expect(speech.locator('summary')).toContainText('연결 안 됨');

  const database = page.locator('details.connection-db-card');
  await database.locator('summary').click();
  await expect(database.locator('input')).toHaveCount(0);
});

test('실무자는 실제 연결 API를 읽거나 바꾸지 못한다', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, 'test2');

  const speech = await context.request.put(`${base}/settings/stt-key`, { data: { key: SPEECH_KEY } });
  expect(speech.status()).toBe(403);
  expect(await speech.text()).not.toContain(SPEECH_KEY);
  expect((await context.request.put(`${base}/settings/voice`, { data: { enabled: true } })).status()).toBe(403);
  expect((await context.request.get(`${base}/settings/connections`)).status()).toBe(403);

  const [organization] = await scratch.db<Array<{ enc_speech_key: string | null; voice_enabled: boolean | null }>>`
    select enc_speech_key, voice_enabled from organization where id = 1`;
  expect(organization).toEqual({ enc_speech_key: null, voice_enabled: null });
  await context.close();
});

test('온보딩 연결 단계와 설정이 같은 실제 연결 상태를 쓴다', async ({ page }) => {
  await scratch.db`update organization set onboarded_at = null, onboarding_step = 4 where id = 1`;
  await login(page);
  await expect(page.getByRole('tab', { name: '5. 외부 서비스 연결', selected: true })).toBeVisible();
  await expect(page.locator('details.connection-stt-card summary')).toContainText('연결 안 됨');
  await expect(page.locator('details.connection-voice-card summary')).toContainText('녹음 끔');
  await expect(page.locator('details.connection-db-card summary')).toContainText('연결됨');
});

test('연결 카드는 right, width, top을 boundingBox로 직접 맞춘다', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/app#/settings/connections`);
  const list = page.locator('.connection-list');
  const listBox = await list.boundingBox();
  const cards = list.locator(':scope > details');
  expect(listBox).not.toBeNull();
  await expect(cards).toHaveCount(4);

  let previousBottom: number | null = null;
  for (let index = 0; index < 4; index += 1) {
    const card = cards.nth(index);
    const cardBox = await card.boundingBox();
    const summaryBox = await card.locator(':scope > summary').boundingBox();
    expect(cardBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    if (!cardBox || !summaryBox || !listBox) throw new Error('connection card bounding box missing');

    const cardRight = cardBox.x + cardBox.width;
    const summaryRight = summaryBox.x + summaryBox.width;
    expect(Math.abs(cardBox.width - listBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(summaryRight - cardRight)).toBeLessThanOrEqual(1);
    if (index === 0) expect(Math.abs(cardBox.y - listBox.y)).toBeLessThanOrEqual(1);
    if (previousBottom !== null) expect(Math.abs(cardBox.y - previousBottom - 16)).toBeLessThanOrEqual(1);
    previousBottom = cardBox.y + cardBox.height;
  }
});

test('랜딩과 설정이 같은 Speech 설정 가이드 문안을 연다', async ({ page }) => {
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: '외부 서비스 설정 가이드' }).click();
  const landingGuide = page.getByRole('dialog', { name: '외부 서비스 설정 가이드' });
  const landingSpeech = landingGuide.locator('.setup-guide-steps[data-guide-id="stt"]');
  await expect(landingSpeech).toContainText('한국 중부(koreacentral)');
  const landingText = (await landingSpeech.innerText()).replace(/\s+/g, ' ').trim();
  await landingGuide.getByRole('button', { name: '닫기' }).click();

  await login(page);
  await page.goto(`${base}/app#/settings/connections`);
  const speech = page.locator('details.connection-stt-card');
  await speech.locator('summary').click();
  await speech.getByRole('button', { name: '설정 가이드' }).click();
  const settingsGuide = page.getByRole('dialog', { name: '녹음 글로 옮기기 설정 가이드' });
  const settingsSpeech = settingsGuide.locator('.connection-guide[data-guide-id="stt"]');
  await expect(settingsSpeech).toContainText('한국 중부(koreacentral)');
  expect((await settingsSpeech.innerText()).replace(/\s+/g, ' ').trim()).toBe(landingText);
});

test('실제 v4 동의 문안 저장 전에 재동의 경고를 유지한다', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/app#/settings/consent`);
  const consent = page.locator('details.wire-card-details', { hasText: '개인정보 수집·이용' });
  await consent.locator('summary').click();
  await consent.getByRole('button', { name: '개인정보 수집·이용 문안 수정' }).click();
  await page.locator('dialog.consent-editor').getByRole('button', { name: '저장', exact: true }).click();
  const warning = page.getByRole('dialog', { name: '개인정보 수집·이용 문안 저장' });
  await expect(warning).toContainText('모든 당사자의 이 항목 동의가 `확인 필요` 로 변경');
  await expect(warning).toContainText('이메일 등 정해진 방식으로 고지 후 재동의 필요');
});
