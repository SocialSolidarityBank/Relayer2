// v6 상담기록 분석 — 브라우저 증거 수집(2026-09-18). 합성 자료만 쓴다.
// 실행마다 새 사례를 만들고, 회차 1(메모+녹음+승인 전사+분석) · 회차 2(메모만) ·
// 회차 3(메모+녹음, 전사 없음)을 API 로 깐 뒤 화면에서 검증한다.
// stub 은 /tmp/relayer-ai-module/stub.json — 서버가 모델 호출마다 다시 읽는다.
// span id 는 결정적이다: 수기 w:memo:<n>, 전사 t:<transcriptId>:<n>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_PREFIX ?? '/api';
const STUB_FILE = '/tmp/relayer-ai-module/stub.json';
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '../../docs/record-analysis-v6-evidence');
const shot = (name: string) => join(EVIDENCE, name);

// ── 합성 원문 ─────────────────────────────────────────────────────────────
// 문장 순서가 곧 w:memo:<n> 이다. 같은 문장을 세 번 넣어 span id 가 문장이 아니라
// 자리를 가리키는지 본다(T24). `</script>` 문장은 텍스트 노드로만 그려져야 한다(T31).
const MEMO = [
  '월세가 두 달 밀려 있다.', // 0 — 전사와 어긋나는 사실(두 달 ↔ 세 달)
  '다음 주까지 내역서를 떼기로 했다.', // 1 — 약속(change before)
  '내역서를 발급받아 냈다.', // 2 — 결과(change after, change 띠)
  '지난주에 전입신고를 접수함.', // 3 — 완료·해결
  '주민센터 답변은 다음 주에 확인하기로 함.', // 4 — 확인필요
  '동생이 다음 달에 입대한다고 했다.', // 5 — 새로 드러난 것
  '월세가 두 달 밀려 있다.', // 6 — 반복 1
  '</script><img src=x onerror=alert(1)>.', // 7 — T31 (마침표가 없으면 다음 문장과 한 span 이 된다)
  '월세가 두 달 밀려 있다.', // 8 — 반복 2
  '상담을 마쳤다.', // 9
].join(' ');

// 전사는 승인본만 분석 재료다. 0번은 수기 0번과 같은 대상·속성·시기인데 수가 어긋난다(불일치),
// 1번은 표현만 다른 연결, 2번은 연결 없는 문장이다.
const TRANSCRIPT_TEXT = [
  '월세가 세 달 밀려 있다고 말했다.', // t:T:0 — 불일치
  '내역서를 발급받았다고 한다.', // t:T:1 — uncertain 연결
  '주민센터 답변은 다음 주에 확인한다고 했다.', // t:T:2 — 연결 없음
].join(' ');

/** 진짜 PCM WAV 머리 + 무음(api/test/voice-fixture.ts 와 같은 모양). 실인물 녹음은 쓰지 않는다. */
const silentWav = (dataBytes = 3200): Buffer => {
  const data = Buffer.alloc(44 + dataBytes);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  return data;
};

/** 검증기를 통과하는 stub 본문. span id 는 위 MEMO·전사 문장 순서와 짝이다. */
const stubBody = (tid: number) => ({
  record: {
    topics: [
      { id: '01', title: '월세와 내역서', paragraph_ids: ['1-1', '1-2'] },
      { id: '02', title: '가족과 상담 마무리', paragraph_ids: ['2-1'] },
    ],
    paragraphs: [
      { id: '1-1', title: '월세와 내역서', spans: ['w:memo:0', 'w:memo:1', 'w:memo:2'] },
      { id: '1-2', title: '전입신고와 주민센터', spans: ['w:memo:3', 'w:memo:4'] },
      {
        id: '2-1',
        title: '가족과 상담 마무리',
        spans: ['w:memo:5', 'w:memo:6', 'w:memo:7', 'w:memo:8', 'w:memo:9'],
      },
    ],
    annotations: [
      { span: 'w:memo:2', status: 'change', before: ['w:memo:1'], after: ['w:memo:2'] },
      { span: 'w:memo:4', status: 'follow_up' },
      { span: 'w:memo:3', status: 'completed' },
    ],
  },
  summary: {
    core: [{ text: '월세가 두 달 밀려 있다', spans: ['w:memo:0'], goal: null }],
    changes: {
      promise_result: [
        {
          promise: '다음 주까지 내역서를 떼기로 했다',
          result: '내역서를 발급받아 냈다',
          promise_spans: ['w:memo:1'],
          result_spans: ['w:memo:2'],
          changes: [
            { before: '다음 주까지 내역서를 떼기로 했다.', after: '내역서를 발급받아 냈다.', meaning: '내역서 발급' },
          ],
          goal: null,
        },
      ],
      newly_revealed: [
        {
          mode: 'confirmed',
          lines: ['동생이 다음 달에 입대한다고 했다'],
          spans: ['w:memo:5'],
          summary_only_exception: true,
          goal: null,
        },
      ],
      new_possibility: [],
    },
    follow_up: [{ text: '주민센터 답변은 다음 주에 확인하기로 함', spans: ['w:memo:4'], goal: null }],
    completed: [{ text: '지난주에 전입신고를 접수함', spans: ['w:memo:3'], goal: null }],
  },
  links: [
    { transcript_span: `t:${tid}:0`, written_spans: ['w:memo:0'], match: 'match' },
    { transcript_span: `t:${tid}:1`, written_spans: ['w:memo:2'], match: 'uncertain' },
  ],
  discrepancies: [
    {
      transcript_span: `t:${tid}:0`,
      written_spans: ['w:memo:0'],
      paragraph_id: '1-1',
      difference: '수기는 두 달, 녹음은 세 달',
      conditions: { same_subject: true, same_attribute: true, same_time: true, incompatible: true },
    },
  ],
  keywords: [{ text: '내역서', spans: ['w:memo:1', 'w:memo:2'] }],
  tasks: ['내역서 떼기'],
  questions: [],
});

// ── 공통 ──────────────────────────────────────────────────────────────────
const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('#email').fill('test2');
  await page.locator('#password').fill('test2');
  await page.getByRole('button', { name: '로그인' }).click();
  // 좁은 화면에서는 이름이 숨는다 — 보임이 아니라 붙음으로 로그인 완료를 본다.
  await expect(page.locator('.app-nav-me')).toBeAttached();
};

const openSummaryTab = async (page: Page, caseId: number) => {
  await page.goto(`/#/cases/${caseId}/info`);
  await page.getByRole('tab', { name: '회차별 요약', exact: true }).click();
};

/** `N회차` 접힘 카드. hasText 는 부분 일치라 `1회차` 가 `11회차` 에 걸리지 않게 정확히 집는다. */
const foldFor = (page: Page, seq: string) =>
  page.locator('details', { has: page.getByText(seq, { exact: true }) }).first();

const openOriginal = async (page: Page, seq: string) => {
  await foldFor(page, seq).getByRole('button', { name: '수기 원본 보기' }).click();
  const dialog = page.getByRole('dialog', { name: `${seq} 원본` });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** var(--x) 가 풀린 색과 같은지 — 16진 리터럴이 아니라 계산된 rgb() 끼리 비교한다. */
const resolvedVar = async (page: Page, name: string): Promise<string> =>
  page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.borderInlineStartColor = `var(${v})`;
    document.body.appendChild(el);
    const color = getComputedStyle(el).borderInlineStartColor;
    el.remove();
    return color;
  }, name);

const pageErrors: string[] = [];

test.describe('v6 상담기록 분석', () => {
  test.describe.configure({ mode: 'serial' });

  let caseId = 0;
  let session1 = 0;
  let session2 = 0;
  let session3 = 0;
  let transcriptId = 0;

  test.beforeEach(({ page }) => {
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  });

  test('준비 — 사례·회차·녹음·승인 전사를 API 로 깐다', async ({ page }) => {
    mkdirSync(EVIDENCE, { recursive: true });
    await login(page);

    const programs = (await (await page.request.get(`${API}/settings/programs`)).json()) as Array<{
      id: number;
      retired_at: string | null;
    }>;
    const program = programs.find((p) => !p.retired_at);
    expect(program, '활성 사업이 있어야 한다').toBeTruthy();

    const created = await page.request.post(`${API}/cases`, {
      data: {
        name: `E2E v6 ${Date.now()}`,
        program_id: program!.id,
        consents: [
          'personal_data_collection_use',
          'sensitive_information_processing',
          'counseling_recording',
          'external_stt_processing',
          'external_llm_cross_border_processing',
          'voice_original_retention_period',
        ].map((domain) => ({ domain, decision: 'grant' })),
      },
    });
    expect(created.status()).toBe(201);
    caseId = ((await created.json()) as { case_id: number }).case_id;

    const start = async () => {
      const res = await page.request.post(`${API}/cases/${caseId}/sessions/start`, { data: {} });
      expect(res.status()).toBe(201);
      return (await res.json()) as { session_id: number; seq: number };
    };
    const patch = async (sessionId: number, memo: string) => {
      const res = await page.request.patch(`${API}/sessions/${sessionId}`, { data: { memo } });
      expect(res.ok()).toBeTruthy();
    };
    const upload = async (sessionId: number) => {
      const res = await page.request.post(`${API}/sessions/${sessionId}/recordings`, {
        data: silentWav(),
        headers: { 'content-type': 'audio/wav' },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };

    session1 = (await start()).session_id;
    await patch(session1, MEMO);
    const recording1 = await upload(session1);

    session2 = (await start()).session_id;
    await patch(session2, '메모만 있는 회차.');

    session3 = (await start()).session_id;
    await patch(session3, '녹음만 올린 회차.');
    await upload(session3);

    // 전사 가져오기는 관리자 전용이다 — test4 를 사례에 배정하고 불러온다.
    const admin: APIRequestContext = await apiRequest.newContext();
    const adminLogin = await admin.post(`${API}/auth/login`, { data: { email: 'test4', password: 'test4' } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminId = ((await admin.get(`${API}/me`)).json() as Promise<{ id: number }>).then((m) => m.id);
    const workerId = ((await page.request.get(`${API}/me`)).json() as Promise<{ id: number }>).then((m) => m.id);
    const assigned = await admin.put(`${API}/cases/${caseId}/assignments`, {
      data: { user_ids: [await workerId, await adminId] },
    });
    expect(assigned.ok()).toBeTruthy();

    const imported = await admin.post(`${API}/sessions/${session1}/transcript/import`, {
      data: { recording_id: recording1, text: TRANSCRIPT_TEXT },
    });
    expect(imported.status()).toBe(201);
    transcriptId = ((await imported.json()) as { id: number }).id;
    expect(transcriptId).toBeGreaterThan(0);
    await admin.dispose();
  });

  test('검토 — stub 초안을 만들고 승인한다', async ({ page }) => {
    writeFileSync(STUB_FILE, JSON.stringify({ default: stubBody(transcriptId) }));
    await login(page);
    await openSummaryTab(page, caseId);

    await foldFor(page, '1회차').getByRole('button', { name: 'AI 정리 검토' }).click();
    await page.waitForURL(/\/review$/);
    await page.getByRole('button', { name: 'AI로 정리하기' }).click();

    // 초안이 서면 요약·구조화 기록·녹음 전사·과제 카드가 선다.
    await expect(page.getByRole('heading', { name: '요약' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '구조화 기록' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '녹음 전사' })).toBeVisible();
    await expect(page.getByRole('button', { name: '승인', exact: true })).toBeVisible();
    await page.screenshot({ path: shot('00-review-draft.png'), fullPage: true });

    await page.getByRole('button', { name: '승인', exact: true }).click();
    await expect(page.getByText('승인 완료')).toBeVisible();
  });

  test('(a) 회차 카드 — 내용 있는 구역만, ①② 번호, 키워드 칩', async ({ page }) => {
    await login(page);
    await openSummaryTab(page, caseId);
    const fold = foldFor(page, '1회차');
    await fold.locator('.seq-head-no').click();

    const sections = fold.locator('.seq-sections');
    await expect(sections).toContainText('이번 상담의 핵심');
    await expect(sections).toContainText('이번 회차에서 확인된 변화');
    await expect(sections).toContainText('확인필요');
    await expect(sections).toContainText('완료·해결');
    // 새로운 가능성이 비었으니 ③ 은 없고, 빈 자리를 채우는 `없음` 문구도 없다(T06·T12).
    await expect(sections.locator('.summary-subsection-title')).toHaveText([
      '① 약속 이행 여부',
      '② 상담 중 새로 드러난 것',
    ]);
    await expect(sections).not.toContainText('③');
    await expect(sections).not.toContainText('없음');
    await expect(fold.locator('.keyword-chip', { hasText: '내역서' })).toBeVisible();
    await fold.screenshot({ path: shot('01-session-card.png') });
  });

  test('(b–e) 원본 팝업 — 구조화·전사 행·대조 패널·불일치 모아보기', async ({ page }) => {
    await login(page);
    await openSummaryTab(page, caseId);
    const dialog = await openOriginal(page, '1회차');
    const written = dialog.getByRole('region', { name: '수기 기록' });
    const voice = dialog.getByRole('region', { name: '녹음 전사' });
    const panel = dialog.getByRole('region', { name: '대조' });

    // ── (b) 구조화 전환 — 주제·단락 제목, 반복 문장의 서로 다른 span id, 상태 띠 색 ──
    await written.getByRole('tab', { name: '구조화' }).click();
    await expect(written.locator('.record-topic-title').first()).toContainText('월세와 내역서');
    await expect(written.locator('.record-paragraph-title').first()).toContainText('1-1');
    // 같은 문장 세 번 — span id 는 자리를 가리키므로 전부 다르다(T24).
    const repeated = written.locator('.record-span', { hasText: '월세가 두 달 밀려 있다.' });
    await expect(repeated).toHaveCount(3);
    const spanIds = await repeated.evaluateAll((els) => els.map((el) => el.getAttribute('data-span-id')));
    expect(new Set(spanIds).size).toBe(3);
    // `</script>` 는 실행되지 않고 글자로 선다(T31).
    await expect(written.locator('.record-span', { hasText: '</script>' })).toHaveCount(1);
    // 상태 띠는 토큰 색 그대로다(T25) — 리터럴 16진이 아니라 var() 가 풀린 값과 비교한다.
    const band = (id: string) =>
      written.locator(`[data-span-id="${id}"]`).evaluate((el) => getComputedStyle(el).borderInlineStartColor);
    expect(await band('w:memo:2')).toBe(await resolvedVar(page, '--mint'));
    expect(await band('w:memo:4')).toBe(await resolvedVar(page, '--badge-coral'));
    expect(await band('w:memo:3')).toBe(await resolvedVar(page, '--blue'));
    await dialog.screenshot({ path: shot('02-structured.png') });

    // ── (c) 전사 행 — 불일치 배경·연결 밑줄·무연결 무상태(T26) ──
    const rowA = voice.locator(`[data-span-id="t:${transcriptId}:0"]`);
    const rowB = voice.locator(`[data-span-id="t:${transcriptId}:1"]`);
    const rowC = voice.locator(`[data-span-id="t:${transcriptId}:2"]`);
    await expect(rowA).toHaveAttribute('data-discrepancy', 'true');
    const bg = await rowA.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
    await expect(rowB).toHaveAttribute('data-linked', 'uncertain');
    await expect(rowB).not.toHaveAttribute('data-discrepancy', /.*/);
    await expect(rowC).not.toHaveAttribute('data-status', /.*/);
    await expect(rowC).not.toHaveAttribute('data-linked', /.*/);
    // 행에는 전사 문장 자체가 있어야 한다 — span.doc 이 문서 id 와 어긋나 행이 비어 보인 적이 있다(2026-09-18).
    await expect(rowA).toContainText('월세가 세 달 밀려 있다고 말했다');

    // ── (d) 대조 패널 — 불일치 4항목 → 연결 3항목 → 연결된 수기 단락 이동(T32) ──
    await rowA.click();
    await expect(panel).toContainText('차이점');
    await expect(panel).toContainText('수기는 두 달, 녹음은 세 달');
    await expect(panel).toContainText('녹음 내용');
    await expect(panel.getByText('녹음 내용').locator('..')).toContainText('월세가 세 달 밀려 있다고 말했다');
    await expect(panel).toContainText('수기 내용');
    await expect(panel).toContainText('연결된 수기 단락');
    await dialog.screenshot({ path: shot('03-panel-discrepancy.png') });

    // 수기를 원문으로 되돌린 뒤 연결 행을 누른다 — `연결된 수기 단락` 이 구조화로 바꾸는지 본다.
    await written.getByRole('tab', { name: '원문 그대로' }).click();
    await rowB.click();
    await expect(panel).toContainText('녹음 내용');
    await expect(panel).toContainText('수기 내용');
    await expect(panel).not.toContainText('차이점');
    await expect(panel).toContainText('연결된 수기 단락');
    await dialog.screenshot({ path: shot('04-panel-link.png') });

    await panel.getByRole('button', { name: /연결된 수기 단락|1-1/ }).click();
    await expect(written.getByRole('tab', { name: '구조화' })).toHaveAttribute('aria-selected', 'true');
    await expect(written.locator('[data-paragraph-id="1-1"] .record-paragraph-title')).toBeInViewport();
    await expect(written.locator('[data-span-id="w:memo:0"]')).toHaveAttribute('aria-current', 'true');

    // ── (e) 기록 불일치 모아보기 — 켜면 불일치만, 끄면 전부(T33) ──
    const filter = voice.getByRole('button', { name: '기록 불일치 모아보기' });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(voice.locator('.transcript-row')).toHaveCount(1);
    await expect(voice).toContainText('불일치 1건만 표시');
    await dialog.screenshot({ path: shot('05-discrepancy-filter.png') });
    await filter.click();
    await expect(voice.locator('.transcript-row')).toHaveCount(3);
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
  });

  test('(f·k) 키워드 백링크와 인쇄', async ({ page }) => {
    await login(page);
    await openSummaryTab(page, caseId);
    const fold = foldFor(page, '1회차');
    await fold.locator('.seq-head-no').click();

    // ── (f) 키워드 칩 → 백링크 패널 → 항목을 누르면 구조화에서 span 선택(T34) ──
    await fold.locator('.keyword-chip', { hasText: '내역서' }).click();
    const dialog = page.getByRole('dialog', { name: '1회차 원본' });
    await expect(dialog).toBeVisible();
    const panel = dialog.getByRole('region', { name: '대조' });
    await expect(panel).toContainText('내역서');
    const backlink = panel.getByRole('button', { name: /1회차 · 1-1/ }).first();
    await expect(backlink).toContainText('다음 주까지 내역서를 떼기로 했다.');
    await backlink.click();
    const written = dialog.getByRole('region', { name: '수기 기록' });
    await expect(written.getByRole('tab', { name: '구조화' })).toHaveAttribute('aria-selected', 'true');
    await expect(written.locator('[data-span-id="w:memo:1"]')).toHaveAttribute('aria-current', 'true');
    await dialog.screenshot({ path: shot('06-backlinks.png') });

    // ── (k) 인쇄 — 상태 띠·불일치 색이 빠지면 판정이 사라지므로 색을 강제한다 ──
    await page.emulateMedia({ media: 'print' });
    const changeSpan = written.locator('[data-span-id="w:memo:2"]');
    await expect(changeSpan).toHaveCount(1);
    expect(await changeSpan.evaluate((el) => getComputedStyle(el).printColorAdjust)).toBe('exact');
    await dialog.screenshot({ path: shot('07-print.png') });
    await page.emulateMedia({ media: 'screen' });
    await dialog.getByRole('button', { name: '닫기' }).click();
  });

  test('(g–i) 요약 수정·원본 수정·빈 회차', async ({ page }) => {
    await login(page);
    await openSummaryTab(page, caseId);
    const fold1 = foldFor(page, '1회차');
    await fold1.locator('.seq-head-no').click();

    // ── (g) 요약 수정 — 사람이 고친 핵심만 바뀌고 배지가 붙는다 ──
    await fold1.getByRole('button', { name: '수정', exact: true }).click();
    await fold1.getByRole('textbox', { name: '이번 상담의 핵심' }).fill('월세 두 달 연체를 확인했다');
    await fold1.getByRole('button', { name: '저장', exact: true }).click();
    await expect(fold1).toContainText('사람이 고침');
    await expect(fold1).toContainText('월세 두 달 연체를 확인했다');
    if (!(await fold1.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await fold1.locator('.seq-head-no').click();
    }
    await fold1.screenshot({ path: shot('08-override.png') });

    // ── (h) 원본 수정 — 메모 리비전 뒤 카드는 재정리 필요로 바뀐다 ──
    const dialog = await openOriginal(page, '1회차');
    const written = dialog.getByRole('region', { name: '수기 기록' });
    await written.getByRole('button', { name: '수정', exact: true }).click();
    const memoBox = dialog.getByRole('textbox', { name: '오늘 상담 내용' });
    await memoBox.fill(`${MEMO} 추가로 확인한 내용.`);
    await written.getByRole('button', { name: '저장', exact: true }).click();
    await expect(written).toContainText('추가로 확인한 내용.');
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
    await expect(fold1).toContainText('원본 수정됨, 재정리 필요');
    await expect(fold1.getByRole('button', { name: 'AI 정리 다시 하기' })).toBeVisible();
    await fold1.screenshot({ path: shot('09-stale.png') });

    // ── (i) 빈 회차 — 분석 없음은 토글 없이 `AI 정리 없음`, 전사 없음은 `전사문 없음` ──
    const fold2 = foldFor(page, '2회차');
    await fold2.locator('.seq-head-no').click();
    await expect(fold2).toContainText('AI 정리 없음');
    const dialog2 = await openOriginal(page, '2회차');
    await expect(dialog2.getByRole('region', { name: '수기 기록' })).toContainText('메모만 있는 회차.');
    await expect(dialog2.getByRole('tab', { name: '구조화' })).toHaveCount(0);
    await expect(dialog2.getByRole('region', { name: '녹음 전사' })).toContainText('전사문 없음');
    await dialog2.getByRole('button', { name: '닫기' }).click();

    const dialog3 = await openOriginal(page, '3회차');
    await expect(dialog3.getByRole('region', { name: '녹음 전사' })).toContainText('전사문 없음');
    await dialog3.getByRole('button', { name: '닫기' }).click();
  });

  test('(j) 좁은 화면 — 패널이 열 아래로 내리고 Escape 가 연 버튼으로 돌아간다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await openSummaryTab(page, caseId);
    const opener = foldFor(page, '1회차').getByRole('button', { name: '수기 원본 보기' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '1회차 원본' });
    await expect(dialog).toBeVisible();
    const voice = dialog.getByRole('region', { name: '녹음 전사' });
    const panel = dialog.getByRole('region', { name: '대조' });
    const voiceBox = await voice.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(voiceBox).toBeTruthy();
    expect(panelBox).toBeTruthy();
    expect(panelBox!.y).toBeGreaterThan(voiceBox!.y);
    await dialog.screenshot({ path: shot('10-mobile.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('(l) 페이지 오류가 없다', async () => {
    expect(pageErrors).toEqual([]);
  });
});
