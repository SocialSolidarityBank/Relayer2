#!/usr/bin/env node
// 합성 데이터셋에서 record-analysis-v6 픽스처 뼈대를 만든다. 텍스트만 받는다 — 오디오는 절대 안 받는다.
// 사용: node scripts/fetch-testdata-fixture.mjs <case> <seq> [출력경로]
//   예) node scripts/fetch-testdata-fixture.mjs C10 10 api/test/fixtures/record-analysis-v6/c10-s10.json
// expected·cards 는 사람이 채운다 — 데이터셋에 없는 판정값을 스크립트가 지어내지 않는다.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const BASE = 'https://pub-0acad9da70b54900924fea276388490a.r2.dev/2026-09-17';
const USER_AGENT = 'relayer-curated-dataset/0.2.0';

const [caseId, seqArg, outArg] = process.argv.slice(2);
if (!caseId || !seqArg) {
  console.error('사용: node scripts/fetch-testdata-fixture.mjs <case> <seq> [출력경로]');
  process.exit(2);
}
const seq = Number(seqArg);

const get = async (url, kind) => {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!r.ok) throw new Error(`GET ${r.status}: ${url}`);
  const text = await r.text();
  return kind === 'json' ? JSON.parse(text) : text;
};

const manifest = await get(`${BASE}/manifest.json`, 'json');
const entry = manifest.cases.find((c) => c.id === caseId);
if (!entry) throw new Error(`manifest 사례 없음: ${caseId}`);
const session = entry.sessions.find((s) => s.seq === seq);
if (!session) throw new Error(`${caseId} 회차 없음: ${seq}`);
if (!session.note) throw new Error(`${caseId} s${seq} 수기 없음 — 픽스처는 수기가 있어야 한다`);

const source = await get(entry.case_json.url, 'json');
const memo = await get(session.note.url, 'text');

// 전사문은 서버가 저장하는 형태(화자 라벨 + ': ' + 발화, 줄바꿈 결합)로 만든다 — load-dataset.mjs transcriptFromDialogue 와 같다.
let transcript;
if (session.dialogue) {
  const dialogue = await get(session.dialogue.url, 'json');
  const speakers = source.speakers ?? {};
  transcript = {
    text: dialogue.turns
      .filter((t) => String(t.t ?? '').trim())
      .map((t) => `${speakers[t.s] ?? t.s}: ${String(t.t ?? '').trim()}`)
      .join('\n'),
  };
}

const isIntake = seq === 1;
const freeText = {};
if (isIntake) {
  for (const k of ['welfare_other', 'contact_caution', 'application_reason_detail', 'previous_support_detail', 'strength_detail', 'reference_memo']) {
    const v = source.intake?.detail?.[k];
    if (typeof v === 'string' && v.trim()) freeText[k] = v;
  }
}

const fixture = {
  source: {
    case: caseId,
    seq,
    kind: isIntake ? 'intake' : 'regular',
    url_hints: [session.note.url, session.dialogue?.url, entry.case_json.url].filter(Boolean),
  },
  memo,
  cards: isIntake
    ? [
        ...(source.intake?.promises ?? []).map((text) => ({ kind: 'promise', text })),
        ...(source.intake?.questions ?? []).map((text) => ({ kind: 'question', text })),
      ]
    : [],
  ...(isIntake && Object.keys(freeText).length ? { intake_detail: freeText } : {}),
  ...(transcript ? { transcript } : {}),
  ...(source.intake?.overall_goal ? { overall_goal: source.intake.overall_goal } : {}),
  expected: { promise_result: false, discrepancy_count_min: 0, notes: 'TODO: 사람이 채움' },
};

const out = outArg ?? `api/test/fixtures/record-analysis-v6/${caseId.toLowerCase()}-s${seq}.json`;
await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${out} (memo ${memo.length}자, transcript ${transcript ? transcript.text.length : 0}자)`);
