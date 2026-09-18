// 이 폴더의 한글을 검수한다. 의존성 없음. 글을 고친 뒤 한 번 돌린다.
//
//   node scripts/site-check-text.mjs
//
// 세 가지를 잡는다.
//   1. 쓰지 않기로 한 기호: 가운데점, 긴 대시, 짧은 대시, 깨진 글자(U+FFFD)
//   2. 자모 분리(NFD)와 호환 자모: 눈으로는 같아 보이지만 검색과 읽기가 깨진다
//   3. 이 저장소의 다른 한글에 한 번도 나오지 않은 음절
//      모델이 한글을 유니코드 이스케이프로 쓰다가 한 글자를 틀리면 '멀쩡'이 '멀잩'처럼
//      멀쩡한 글자로 바뀐다(anthropics/claude-code#83033). 기계는 틀린 줄 모르니 사람이 본다.
//      새 표현을 쓰면 여기 걸리는 것이 정상이다. 목록을 읽고 말이 되는지만 확인한다.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 파일은 scripts/ 에 있고 검사 대상은 site/ 다. site/ 에 두면 그 파일까지 공개된다.
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const here = join(repo, 'site');
const targets = readdirSync(here).filter((f) => /\.(html|css|js)$/.test(f));

const FORBIDDEN = [
  ['\u00B7', '가운데점'],
  ['\u2014', '긴 대시'],
  ['\u2013', '짧은 대시'],
  ['\uFFFD', '깨진 글자'],
];
const SYLLABLE = /[\uAC00-\uD7A3]/gu;
const JAMO = /[\u1100-\u11FF\u3130-\u318F]/gu;

// 비교할 한글 뭉치. 이 저장소가 지금까지 써 온 글이다.
const corpus = new Set();
for (const path of ['DESIGN.md', 'SPEC.md', 'GLOSSARY.md', 'PLAN.md', 'README.md']) {
  try {
    for (const ch of readFileSync(join(repo, path), 'utf8').match(SYLLABLE) ?? []) corpus.add(ch);
  } catch {
    // 파일이 없어도 검사는 계속한다.
  }
}

let problems = 0;
const unseen = new Map();

for (const name of targets) {
  const text = readFileSync(join(here, name), 'utf8');
  const lineOf = (i) => text.slice(0, i).split('\n').length;

  for (const [ch, label] of FORBIDDEN) {
    let i = text.indexOf(ch);
    while (i !== -1) {
      console.log(`${label} ${name}:${lineOf(i)} ${JSON.stringify(text.slice(i - 30, i + 30))}`);
      problems += 1;
      i = text.indexOf(ch, i + 1);
    }
  }
  for (const m of text.matchAll(JAMO)) {
    console.log(`자모 분리 ${name}:${lineOf(m.index)} ${JSON.stringify(text.slice(m.index - 30, m.index + 30))}`);
    problems += 1;
  }
  if (text !== text.normalize('NFC')) {
    console.log(`NFC 아님 ${name}`);
    problems += 1;
  }
  for (const m of text.matchAll(SYLLABLE)) {
    if (!corpus.has(m[0])) {
      const list = unseen.get(m[0]) ?? [];
      if (list.length < 3) list.push(`${name}:${lineOf(m.index)} ${text.slice(m.index - 14, m.index + 14).replace(/\s+/g, ' ')}`);
      unseen.set(m[0], list);
    }
  }
}

if (unseen.size) {
  console.log(`\n처음 쓰는 음절 ${unseen.size}개. 말이 되는지 눈으로 확인한다.`);
  for (const [ch, list] of unseen) console.log(`  ${ch}  ${list.join(' | ')}`);
}

console.log(problems ? `\n고칠 것 ${problems}개` : '\n쓰지 않기로 한 기호와 자모 분리 없음');
process.exit(problems ? 1 : 0);
