#!/usr/bin/env node
// 카드 여백·버튼 라벨 정렬 실측(DESIGN.md §6 "카드 여백"). 눈이 아니라 픽셀로 PASS/FAIL 을 낸다.
//
//   node scripts/measure-cards.mjs http://localhost:8799 [test2]
//
// 재는 것
//   1. 모든 `.wire-card`: 첫 내용의 왼쪽·오른쪽·위 거리, 마지막 내용의 아래 거리가 --card-pad(24)+테두리(1)
//      = 25(±1)인지. 제목 구분선(풀블리드)과 펼친 접힘 머리(음수 마진)는 뺀다.
//   2. 모든 `.wire-button`: 라벨(`.wire-button-text`)의 x·y 중심이 버튼 중심과 ±1 안인지.
//   3. 모든 `.wire-item-title/.wire-item-desc`: 한 줄(높이 ≤ line-height×1.5)인지.
// 로그인 계정은 시드의 test2(비밀번호 = 아이디). 화면 목록은 아래 ROUTES.
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';

const base = process.argv[2] ?? 'http://localhost:8799';
const user = process.argv[3] ?? 'test2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${base}/`);
await page.locator('#email').fill(user);
await page.locator('#password').fill(user);
await page.getByRole('button', { name: '로그인' }).click();
await page.locator('.app-nav-me').waitFor();

// 시드 사례 하나를 찾는다 — 목록 첫 카드의 사례 주소.
await page.goto(`${base}/#/participants`);
await page.locator('a.participant-card-link[href*="#/cases/"]').first().waitFor();
const href = await page.locator('a.participant-card-link[href*="#/cases/"]').first().getAttribute('href');
const caseId = href?.match(/#\/cases\/(\d+)/)?.[1];
if (!caseId) throw new Error('시드 사례를 찾지 못함');

const ROUTES = [
  '#/schedule',
  '#/participants',
  '#/participants/new',
  `#/cases/${caseId}/info`,
  `#/cases/${caseId}/info/goals`,
  `#/cases/${caseId}/record`,
  `#/cases/${caseId}/schedule`,
  '#/settings/me',
];

const measure = () => {
  const out = [];
  const near = (a, b) => Math.abs(a - b) <= 1;
  for (const card of document.querySelectorAll('.wire-card, .participant-card, .participant-hero-card')) {
    const r = card.getBoundingClientRect();
    if (r.width === 0) continue;
    const cs = getComputedStyle(card);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const border = parseFloat(cs.borderLeftWidth);
    const title = (card.querySelector('.wire-card-title, .wire-card-summary')?.textContent ?? '').trim().slice(0, 24);
    const isFold = card.matches('details');
    if (isFold && !card.open) {
      // 접힌 카드는 머리 한 줄이 카드 면 전체다(클릭 표적 계약, wire.css) — 머리가 아웃라인까지 채우는지 본다.
      const s = card.querySelector('.wire-card-summary').getBoundingClientRect();
      const l = s.left - r.left, rt = r.right - s.right, t = s.top - r.top, b = r.bottom - s.bottom;
      out.push({ kind: 'fold', name: title, pass: [l, rt, t, b].every((v) => near(v, border)), detail: `border=${border} L=${l.toFixed(1)} R=${rt.toFixed(1)} T=${t.toFixed(1)} B=${b.toFixed(1)}` });
      continue;
    }
    // 펼친 접힘 카드의 머리는 음수 마진으로 아웃라인까지 나간다 — 본문만 잰다. 풀블리드 구분선도 뺀다.
    const kids = [...card.children].filter((k) => {
      if (k.matches('.wire-card-divider, .participant-hero-divider') || (isFold && k.classList.contains('wire-card-summary'))) return false;
      const kr = k.getBoundingClientRect();
      return kr.width > 0 && kr.height > 0;
    });
    if (kids.length === 0) continue;
    const first = kids[0].getBoundingClientRect();
    const last = kids[kids.length - 1].getBoundingClientRect();
    const left = first.left - r.left;
    const right = r.right - Math.max(...kids.map((k) => k.getBoundingClientRect().right));
    const top = first.top - r.top;
    const bottom = r.bottom - last.bottom;
    out.push({
      kind: 'card',
      name: title || card.className,
      pass: near(padY, pad) && (isFold ? near(left, pad) && near(right, pad) && near(bottom, pad) : near(left, pad) && near(right, pad) && near(top, pad) && near(bottom, pad)),
      detail: `pad=${pad}/${padY} L=${left.toFixed(1)} R=${right.toFixed(1)} T=${top.toFixed(1)} B=${bottom.toFixed(1)}${isFold ? ' (open)' : ''}`,
    });
  }
  for (const b of document.querySelectorAll('.wire-button')) {
    const t = b.querySelector('.wire-button-text');
    const br = b.getBoundingClientRect();
    if (!t || br.width === 0) continue;
    const tr = t.getBoundingClientRect();
    const dx = (tr.left + tr.right) / 2 - (br.left + br.right) / 2;
    const dy = (tr.top + tr.bottom) / 2 - (br.top + br.bottom) / 2;
    out.push({
      kind: 'button',
      name: (t.textContent ?? '').trim(),
      pass: Math.abs(dx) <= 1 && Math.abs(dy) <= 1.5,
      detail: `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`,
    });
  }
  for (const el of document.querySelectorAll('.wire-item-title, .wire-item-desc')) {
    const er = el.getBoundingClientRect();
    if (er.width === 0) continue;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
    out.push({
      kind: 'line',
      name: (el.textContent ?? '').trim().slice(0, 24),
      pass: er.height <= lh * 1.5,
      detail: `h=${er.height.toFixed(1)} lh=${lh.toFixed(1)}`,
    });
  }
  return out;
};

let fails = 0;
for (const route of ROUTES) {
  await page.goto(`${base}/${route}`);
  await page.waitForTimeout(600);
  const rows = await page.evaluate(measure);
  const bad = rows.filter((r) => !r.pass);
  fails += bad.length;
  console.log(`\n${route}  cards=${rows.filter((r) => r.kind === 'card').length} buttons=${rows.filter((r) => r.kind === 'button').length} lines=${rows.filter((r) => r.kind === 'line').length}  FAIL=${bad.length}`);
  for (const r of bad) console.log(`  FAIL ${r.kind} "${r.name}"  ${r.detail}`);
}
await browser.close();
console.log(fails === 0 ? '\nPASS' : `\nFAIL ${fails}`);
process.exit(fails === 0 ? 0 : 1);
