#!/usr/bin/env node
// record-analysis-v6 픽스처 무결성 검사. 사용: node scripts/record-analysis-coverage.mjs <fixtureDir>
// 문서마다 splitSentences → coverageOf 무손실·재조립 일치·sha256 을 재고,
// stub/<이름>.json 은 LlmAnalysisSchema·checkReferences·생성문 말줄임(원문에 없는 …/...) 을 검사한다.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contract = await import(pathToFileURL(join(root, 'api/src/domain/record-analysis.ts')).href);
const { splitSentences, spansOf, coverageOf, checkReferences, LlmAnalysisSchema } = contract;

const fixtureDir = resolve(process.argv[2] ?? 'api/test/fixtures/record-analysis-v6');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// stub 이 만들어 낸 문자열 전부를 재귀로 모은다 — span id·조건 불리언·구조 키는 생성문이 아니다.
const GENERATED_KEYS = new Set(['text', 'title', 'promise', 'result', 'before', 'after', 'meaning', 'conclusion', 'difference', 'worker', 'participant']);
function* generatedStrings(node, key = '') {
  if (typeof node === 'string') {
    if (GENERATED_KEYS.has(key)) yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) yield* generatedStrings(item, key);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* generatedStrings(v, k);
  }
}

const docsOf = (fixture) => {
  // 서버가 만드는 doc id 와 같게: memo → card:<n>(픽스처는 순번, 서버는 실제 id) → intake:<key> → transcript
  const docs = [['memo', fixture.memo]];
  fixture.cards.forEach((card, i) => docs.push([`card:${i + 1}`, card.text]));
  for (const [key, text] of Object.entries(fixture.intake_detail ?? {})) docs.push([`intake:${key}`, text]);
  return docs;
};

const rows = [];
const files = (await readdir(fixtureDir)).filter((f) => f.endsWith('.json')).sort();
for (const file of files) {
  const fixture = JSON.parse(await readFile(join(fixtureDir, file), 'utf8'));
  const name = basename(file, '.json');
  const allSpans = [];
  const sourceText = [];

  for (const [doc, text] of docsOf(fixture)) {
    const spans = spansOf('w', doc, text);
    allSpans.push(...spans);
    sourceText.push(text);
    const cov = coverageOf(text, spans);
    // span 사이의 원문 공백을 그대로 끼워 이어 붙였을 때 원문이 되는지 — 무손실의 직접 증명
    let rebuilt = '';
    let cursor = 0;
    for (const s of spans) {
      rebuilt += text.slice(cursor, s.start) + text.slice(s.start, s.end);
      cursor = s.end;
    }
    rebuilt += text.slice(cursor);
    const ok = cov.ok && rebuilt === text;
    if (!ok) fail(`${name} ${doc}: coverage ok=${cov.ok} rebuild=${rebuilt === text} gaps=${cov.gaps_nonblank} overlaps=${cov.overlaps}`);
    rows.push([name, doc, text.split('\n').length, text.length, spans.length, sha256(text), ok ? 'ok' : 'FAIL']);
  }

  if (fixture.transcript) {
    const text = fixture.transcript.text;
    const spans = spansOf('t', '1', text);
    allSpans.push(...spans);
    sourceText.push(text);
    const cov = coverageOf(text, spans);
    let rebuilt = '';
    let cursor = 0;
    for (const s of spans) {
      rebuilt += text.slice(cursor, s.start) + text.slice(s.start, s.end);
      cursor = s.end;
    }
    rebuilt += text.slice(cursor);
    const ok = cov.ok && rebuilt === text;
    if (!ok) fail(`${name} transcript: coverage ok=${cov.ok} rebuild=${rebuilt === text}`);
    rows.push([name, 'transcript:1', text.split('\n').length, text.length, spans.length, sha256(text), ok ? 'ok' : 'FAIL']);
  }

  // stub 정답지 검사 — 있을 때만
  let stub;
  try {
    stub = JSON.parse(await readFile(join(fixtureDir, 'stub', `${name}.json`), 'utf8'));
  } catch {
    continue;
  }
  const parsed = LlmAnalysisSchema.safeParse(stub);
  if (!parsed.success) {
    fail(`${name} stub: LlmAnalysisSchema ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  for (const p of checkReferences(stub, allSpans)) {
    fail(`${name} stub: ${p.where} ${p.span} ${p.reason}`);
  }
  const joined = sourceText.join('\n');
  const spanText = new Map(allSpans.map((s) => {
    const doc = docsOf(fixture).find(([d]) => d === s.doc)?.[1] ?? (s.doc === '1' ? fixture.transcript?.text : '');
    return [s.id, (doc ?? '').slice(s.start, s.end)];
  }));
  const referencedText = (ids) => (ids ?? []).map((id) => spanText.get(id) ?? '').join('\n');
  // T18: 인용문은 참조 span 텍스트에 그대로 있어야 한다
  for (const [where, item, ids] of [
    ...stub.summary.changes.newly_revealed.map((x, i) => [`newly_revealed ${i}`, x, x.spans]),
    ...stub.summary.changes.new_possibility.map((x, i) => [`new_possibility ${i}`, x, [...x.change_spans, ...x.plan_spans]]),
  ]) {
    for (const quote of Object.values(item.dialogue ?? {})) {
      if (!referencedText(ids).includes(quote)) fail(`${name} stub: ${where} 인용문이 참조 span 에 없음 ${JSON.stringify(quote)}`);
    }
  }
  // llm 키워드는 참조 span 의 부분 문자열이어야 한다
  stub.keywords.forEach((k, i) => {
    if (!referencedText(k.spans).includes(k.text)) fail(`${name} stub: keyword ${i} ${JSON.stringify(k.text)} 가 참조 span 에 없음`);
  });
  for (const s of generatedStrings(stub)) {
    for (const m of s.matchAll(/…|\.\.\./g)) {
      if (!joined.includes(m[0])) fail(`${name} stub: 원문에 없는 말줄임 ${JSON.stringify(m[0])} in ${JSON.stringify(s)}`);
    }
  }
  rows.push([name, 'stub', '-', '-', '-', '-', 'ok']);
}

// default.json 은 정해진 짧은 수기로 검사한다 — 픽스처 파일이 아니라 계약상 임의 입력용이다.
const DEFAULT_MEMO = '월세 두 달 밀림. 내역서는 못 뗐다고 함. 다음 주까지 내역서를 떼기로 함.';
try {
  const stub = JSON.parse(await readFile(join(fixtureDir, 'stub', 'default.json'), 'utf8'));
  const parsed = LlmAnalysisSchema.safeParse(stub);
  if (!parsed.success) fail(`default stub: LlmAnalysisSchema ${parsed.error.message}`);
  else {
    for (const p of checkReferences(stub, spansOf('w', 'memo', DEFAULT_MEMO))) {
      fail(`default stub: ${p.where} ${p.span} ${p.reason}`);
    }
    for (const s of generatedStrings(stub)) {
      for (const m of s.matchAll(/…|\.\.\./g)) {
        if (!DEFAULT_MEMO.includes(m[0])) fail(`default stub: 원문에 없는 말줄임 in ${JSON.stringify(s)}`);
      }
    }
    rows.push(['default', 'stub', '-', '-', '-', '-', 'ok']);
  }
} catch (e) {
  if (e?.code !== 'ENOENT') fail(`default stub: ${e.message}`);
}

// stub-file.json 집계본 — StubFile 모양이고 각 항목이 스키마를 통과하는지
try {
  const agg = JSON.parse(await readFile(join(fixtureDir, 'stub', 'stub-file.json'), 'utf8'));
  if (!agg.default || typeof agg.by_seq !== 'object') fail('stub-file: { default, by_seq } 모양 아님');
  else {
    for (const [seq, a] of Object.entries(agg.by_seq)) {
      if (!LlmAnalysisSchema.safeParse(a).success) fail(`stub-file by_seq[${seq}]: 스키마 실패`);
    }
    if (!LlmAnalysisSchema.safeParse(agg.default).success) fail('stub-file default: 스키마 실패');
    rows.push(['stub-file', 'aggregate', '-', '-', '-', '-', 'ok']);
  }
} catch (e) {
  if (e?.code !== 'ENOENT') fail(`stub-file: ${e.message}`);
}

const widths = [0, 0, 0, 0, 0, 0, 0];
for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i], String(c).length)));
console.log(['fixture', 'doc', 'lines', 'chars', 'spans', 'sha256', 'cov'].map((h, i) => h.padEnd(widths[i])).join('  '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(widths[i])).join('  '));

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('COVERAGE_OK');
