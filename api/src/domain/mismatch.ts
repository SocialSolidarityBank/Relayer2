// 불일치 둘(요구 23). `대조` 는 하나가 아니다.
//
//   음성·수기 기록 불일치 — 전사문과 실무자가 손으로 쓴 기록이 어긋난다
//   회차간 기록 불일치     — 지난 회차에 적힌 것과 이번 회차에 적힌 것이 어긋난다
//
// 둘은 원인도 대응도 다르다. 앞은 "못 들었거나 잘못 적었다"이고, 뒤는 "말이 달라졌다"이다.
// **뒤쪽은 틀렸다고 판정하지 않는다** — 당사자가 번복했을 수 있다. 달라진 사실만 보여 준다.
//
// 순수 함수다. DB 도 네트워크도 모른다.

export type MismatchKind = 'voice_vs_written' | 'across_sessions';

export type Mismatch = {
  kind: MismatchKind;
  /** 무엇이 어긋났는지. 사람이 읽는 한 줄이다. */
  label: string;
  /** 비교한 정규화 값. 어느 쪽이 맞다고 말하지 않는다. */
  left: string;
  right: string;
  /** 화면에서 원문 맥락을 확인할 수 있는 실제 출처 조각. */
  leftSnippet?: string;
  rightSnippet?: string;
  /** 어디서 왔는지. 회차간이면 회차 번호가 붙는다. */
  leftFrom: string;
  rightFrom: string;
};

// 전사기가 '네 건', '삼십오만 원'처럼 적어도 수기 숫자와 비교한다.
// 원문은 바꾸지 않고 포착한 수사만 정규화해 출처 위치를 보존한다.
const ONES: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
};
const TENS: Record<string, number> = {
  열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50,
  예순: 60, 일흔: 70, 여든: 80, 아흔: 90,
};
const DIGITS: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const UNITS: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const tensPattern = Object.keys(TENS).join('|');
const NUMERAL = `(\\d[\\d,]*|(?<![가-힣])(?:(?:${tensPattern})?(?:${Object.keys(ONES).join('|')})|(?:${tensPattern})|[영공일이삼사오육칠팔구십백천]+))`;

function numericValue(raw: string): string | null {
  if (/^\d[\d,]*$/.test(raw)) return String(Number(raw.replace(/,/g, '')));
  if (ONES[raw] !== undefined) return String(ONES[raw]);
  for (const [word, value] of Object.entries(TENS)) {
    if (raw === word) return String(value);
    if (raw.startsWith(word) && ONES[raw.slice(word.length)] !== undefined)
      return String(value + ONES[raw.slice(word.length)]);
  }
  let total = 0;
  let digit: number | null = null;
  let previousUnit = Infinity;
  for (const ch of raw) {
    if (DIGITS[ch] !== undefined) {
      if (digit !== null) return null;
      digit = DIGITS[ch];
    } else {
      const unit = UNITS[ch];
      if (!unit || unit >= previousUnit || digit === 0) return null;
      total += (digit ?? 1) * unit;
      previousUnit = unit;
      digit = null;
    }
  }
  return String(total + (digit ?? 0));
}

/**
 * 숫자와 단위를 붙여 뽑는다. 상담 기록에서 어긋나면 곤란한 것은 대개 수다 —
 * 건수·금액·기간·횟수. 문장이 달라도 숫자가 같으면 어긋난 것이 아니다.
 */
const NUMBER_FACTS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '연체 건수', re: new RegExp(`연체[^0-9]{0,8}?${NUMERAL}\\s*건`, 'g') },
  { label: '월세', re: new RegExp(`월세[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '보증금', re: new RegExp(`보증금[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '대출금', re: new RegExp(`대출(?:금|액)?[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '채무액', re: new RegExp(`(?:채무|빚)[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '지원금', re: new RegExp(`지원금[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '소득', re: new RegExp(`(?:소득|수입|월급|급여)[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '총 금액', re: new RegExp(`(?:합계|총액|총금액)[^0-9]{0,8}?${NUMERAL}\\s*만\\s*원?`, 'g') },
  { label: '밀린 개월', re: new RegExp(`${NUMERAL}\\s*(?:달|개월)\\s*(?:밀|연체|미납)`, 'g') },
  { label: '근무 일수', re: new RegExp(`주\\s*${NUMERAL}\\s*일`, 'g') },
  { label: '통원 주기', re: new RegExp(`${NUMERAL}\\s*주에\\s*한\\s*번`, 'g') },
];

type Fact = { label: string; value: string };
type DetailedFact = Fact & { snippet: string };

const sourceSnippet = (text: string, at: number, length: number): string =>
  text
    .slice(Math.max(0, at - 18), Math.min(text.length, at + length + 18))
    .replace(/\s+/g, ' ')
    .trim();

/** 같은 이름이 여러 번 나오면 마지막 것을 쓴다 — 나중 말이 정정이다. */
function detailedFacts(text: string): DetailedFact[] {
  const found = new Map<string, DetailedFact>();
  for (const { label, re } of NUMBER_FACTS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      const value = match[1] ? numericValue(match[1]) : null;
      if (value === null) continue;
      found.set(label, {
        label,
        value,
        snippet: sourceSnippet(text, match.index ?? 0, match[0].length),
      });
    }
  }
  return [...found.values()];
}

export function extractFacts(text: string): Fact[] {
  return detailedFacts(text).map(({ label, value }) => ({ label, value }));
}

/**
 * 음성·수기 기록 불일치. 전사문과 손으로 쓴 기록에서 **같은 이름의 수가 다를 때**만 낸다.
 * 한쪽에만 있는 것은 불일치가 아니다 — 안 적었을 뿐이고, 그건 흔하다.
 */
export function voiceVsWritten(transcript: string, written: string): Mismatch[] {
  const left = detailedFacts(transcript);
  const right = new Map(detailedFacts(written).map((f) => [f.label, f]));
  const out: Mismatch[] = [];
  for (const f of left) {
    const other = right.get(f.label);
    if (!other || other.value === f.value) continue;
    out.push({
      kind: 'voice_vs_written',
      label: f.label,
      left: f.value,
      right: other.value,
      leftSnippet: f.snippet,
      rightSnippet: other.snippet,
      leftFrom: '녹음',
      rightFrom: '수기 기록',
    });
  }
  return out;
}

/**
 * 회차간 기록 불일치. 지난 회차와 이번 회차의 같은 사실이 다를 때 낸다.
 * **틀렸다고 말하지 않는다.** 연체가 3건에서 4건이 된 것은 오류가 아니라 사정이 바뀐 것이다.
 * 판정은 사람이 한다 — 여기서는 달라졌다는 사실만 짚는다.
 */
export function acrossSessions(
  previous: { seq: number; text: string },
  current: { seq: number; text: string },
): Mismatch[] {
  const before = detailedFacts(previous.text);
  const after = new Map(detailedFacts(current.text).map((f) => [f.label, f]));
  const out: Mismatch[] = [];
  for (const f of before) {
    const now = after.get(f.label);
    if (!now || now.value === f.value) continue;
    out.push({
      kind: 'across_sessions',
      label: f.label,
      left: f.value,
      right: now.value,
      leftSnippet: f.snippet,
      rightSnippet: now.snippet,
      leftFrom: `${previous.seq}회차`,
      rightFrom: `${current.seq}회차`,
    });
  }
  return out;
}
