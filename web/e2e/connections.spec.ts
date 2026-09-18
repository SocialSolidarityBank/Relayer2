import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { Connections, Me } from '../src/api.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const appBase = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const appRoot = `${appBase.replace(/\/$/, '')}${process.env.PLAYWRIGHT_API_PREFIX === '' ? '/app#' : '/#'}`;
const admin: Me = {
  id: 1,
  name: '연결 관리자',
  role: 'admin',
  onboarded: true,
  onboarding_step: 4,
  workspace: { name: '연결 기관', slug: 'connections', public_address: 'connections.example' },
};

const initialConnections = (): Connections => ({
  ai: { connected: true, provider: 'openai', model: 'gpt-4.1-mini', env: 'OPENAI_API_KEY', source: 'env' },
  stt: { connected: false, provider: 'azure', region: 'koreacentral', source: null },
  voice: { enabled: false, source: null },
  db: { connected: true, checked_at: '2026-09-18T00:00:00.000Z', env: 'DATABASE_URL' },
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubSettings(page: Page, start = initialConnections(), me: Me = admin) {
  let connections = start;
  await page.route((url) => ['/me', '/settings/connections', '/settings/stt-key', '/settings/voice'].includes(url.pathname.replace(/^\/api/, '')), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (path === '/me' && request.method() === 'GET') return json(route, me);
    if (path === '/settings/connections' && request.method() === 'GET') return json(route, connections);
    if (path === '/settings/stt-key' && request.method() === 'PUT') {
      const body = request.postDataJSON() as { key?: unknown };
      if (body.key === 'invalid') return json(route, { error: '한국 중부 Azure Speech 키를 확인하세요' }, 400);
      if (body.key !== null && body.key !== 'valid-speech-key') return json(route, { error: '요청 형식 오류: key' }, 400);
      connections = {
        ...connections,
        stt: { ...connections.stt, connected: body.key !== null, source: body.key === null ? null : 'db' },
      };
      return json(route, { ok: true });
    }
    if (path === '/settings/voice' && request.method() === 'PUT') {
      const body = request.postDataJSON() as { enabled?: unknown };
      if (typeof body.enabled !== 'boolean') return json(route, { error: '요청 형식 오류: enabled' }, 400);
      connections = { ...connections, voice: { enabled: body.enabled, source: 'db' } };
      return json(route, { ok: true });
    }
    return json(route, { error: `unhandled ${request.method()} ${path}` }, 404);
  });
}

let siteServer: Server;
let siteBase: string;

test.beforeAll(async () => {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  siteServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    try {
      const bytes = readFileSync(join(root, 'site', relative));
      response.writeHead(200, { 'content-type': types[extname(relative)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  const address = siteServer.address();
  if (!address || typeof address === 'string') throw new Error('site server address missing');
  siteBase = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => siteServer.close((error) => (error ? reject(error) : resolve())));
});

test('Speech 키와 녹음 토글을 각각 저장하고 상태를 다시 읽는다', async ({ page }) => {
  await stubSettings(page);
  await page.goto(`${appRoot}/settings/connections`);

  const speech = page.locator('details.connection-stt-card');
  await expect(speech.locator('summary')).toContainText('연결 안 됨');
  await speech.locator('summary').click();
  await expect(speech.getByText('한국 중부(koreacentral)', { exact: true })).toBeVisible();
  await expect(speech.getByLabel(/지역|리전|endpoint/i)).toHaveCount(0);

  const key = speech.getByLabel('Azure Speech 키');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(speech.locator('input[type="password"]')).toHaveCount(1);
  await key.fill('invalid');
  await speech.getByRole('button', { name: '저장', exact: true }).click();
  await expect(speech.getByRole('alert')).toHaveText('한국 중부 Azure Speech 키를 확인하세요');
  await expect(key).toHaveValue('invalid');

  await key.fill('valid-speech-key');
  await speech.getByRole('button', { name: '저장', exact: true }).click();
  await expect(key).toHaveValue('');
  await expect(speech.locator('summary')).toContainText('연결됨');
  await expect(page.locator('body')).not.toContainText('valid-speech-key');

  await speech.getByRole('button', { name: '키 지우기' }).click();
  await expect(speech.locator('summary')).toContainText('연결 안 됨');

  const voice = page.locator('details.connection-voice-card');
  await expect(voice.locator('summary')).toContainText('녹음 끔');
  await voice.locator('summary').click();
  await voice.getByRole('checkbox', { name: '상담 녹음' }).check();
  await expect(voice.locator('summary')).toContainText('녹음 켬');
  await expect(speech.locator('summary')).toContainText('연결 안 됨');
  await voice.getByRole('checkbox', { name: '상담 녹음' }).uncheck();
  await expect(voice.locator('summary')).toContainText('녹음 끔');

  const database = page.locator('details.connection-db-card');
  await database.locator('summary').click();
  await expect(database.locator('input')).toHaveCount(0);
});

test('온보딩 연결 단계와 설정이 같은 ConnectionsPane 상태를 쓴다', async ({ page }) => {
  await stubSettings(page, initialConnections(), { ...admin, onboarded: false });
  await page.goto(`${appRoot}/onboarding`);
  await expect(page.getByRole('tab', { name: '5. 외부 서비스 연결', selected: true })).toBeVisible();
  await expect(page.locator('details.connection-stt-card summary')).toContainText('연결 안 됨');
  await expect(page.locator('details.connection-voice-card summary')).toContainText('녹음 끔');
  await expect(page.locator('details.connection-db-card summary')).toContainText('연결됨');
});

test('연결 카드는 right, width, top을 boundingBox로 직접 맞춘다', async ({ page }) => {
  await stubSettings(page);
  await page.goto(`${appRoot}/settings/connections`);
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
  await page.goto(`${siteBase}/`);
  await page.getByRole('button', { name: '외부 서비스 설정 가이드' }).click();
  const landingGuide = page.getByRole('dialog', { name: '외부 서비스 설정 가이드' });
  const landingSpeech = landingGuide.locator('.setup-guide-steps[data-guide-id="stt"]');
  await expect(landingSpeech).toContainText('한국 중부(koreacentral)');
  const landingText = (await landingSpeech.innerText()).replace(/\s+/g, ' ').trim();
  await landingGuide.getByRole('button', { name: '닫기' }).click();

  await stubSettings(page);
  await page.goto(`${appRoot}/settings/connections`);
  const speech = page.locator('details.connection-stt-card');
  await speech.locator('summary').click();
  await speech.getByRole('button', { name: '설정 가이드' }).click();
  const settingsGuide = page.getByRole('dialog', { name: '녹음 글로 옮기기 설정 가이드' });
  const settingsSpeech = settingsGuide.locator('.connection-guide[data-guide-id="stt"]');
  await expect(settingsSpeech).toContainText('한국 중부(koreacentral)');
  expect((await settingsSpeech.innerText()).replace(/\s+/g, ' ').trim()).toBe(landingText);
});

test('동의 문안 저장 전에 v4 재동의 경고를 유지한다', async ({ page }) => {
  await page.route((url) => ['/me', '/consent-copy'].includes(url.pathname.replace(/^\/api/, '')), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, admin);
    if (path === '/consent-copy') {
      return json(route, [{
        domain: 'privacy',
        label: '개인정보 수집·이용',
        body: '연결 기관이 개인정보를 처리합니다.',
        items: ['이름'],
        purpose_text: '상담 제공',
        retention_text: '종료 후 5년',
        refusal_text: '거부 시 상담 기록 기능을 이용할 수 없습니다.',
        recipient: null,
        version: 'consent-standard-form-v4',
        hash: 'v4-hash',
        required: true,
        editable: true,
      }]);
    }
    return json(route, { error: `unhandled ${request.method()} ${path}` }, 404);
  });
  await page.goto(`${appRoot}/settings/consent`);
  const consent = page.locator('details.wire-card-details', { hasText: '개인정보 수집·이용' });
  await consent.locator('summary').click();
  await consent.getByRole('button', { name: '개인정보 수집·이용 문안 수정' }).click();
  await page.locator('dialog.consent-editor').getByRole('button', { name: '저장', exact: true }).click();
  const warning = page.getByRole('dialog', { name: '개인정보 수집·이용 문안 저장' });
  await expect(warning).toContainText('모든 당사자의 이 항목 동의가 `확인 필요` 로 변경');
  await expect(warning).toContainText('이메일 등 정해진 방식으로 고지 후 재동의 필요');
});
