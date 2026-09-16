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

/**
 * 숫자와 단위를 붙여 뽑는다. 상담 기록에서 어긋나면 곤란한 것은 대개 수다 —
 * 건수·금액·기간·횟수. 문장이 달라도 숫자가 같으면 어긋난 것이 아니다.
 */
const NUMBER_FACTS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '연체 건수', re: /연체[^0-9]{0,8}(\d+)\s*건/g },
  { label: '월세', re: /월세[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '보증금', re: /보증금[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '대출금', re: /대출(?:금|액)?[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '채무액', re: /(?:채무|빚)[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '지원금', re: /지원금[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '소득', re: /(?:소득|수입|월급|급여)[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '총 금액', re: /(?:합계|총액|총금액)[^0-9]{0,8}(\d[\d,]*)\s*만\s*원?/g },
  { label: '밀린 개월', re: /(\d+)\s*(?:달|개월)\s*(?:밀|연체|미납)/g },
  { label: '근무 일수', re: /주\s*(\d)\s*일/g },
  { label: '통원 주기', re: /(\d+)\s*주에\s*한\s*번/g },
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
      const value = match[1];
      if (!value) continue;
      found.set(label, {
        label,
        value: value.replace(/,/g, ''),
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
