// 가림 처리(P3). 상담 자료를 외부 LLM 에 보내기 전에 사람을 가리킬 수 있는 것을 지운다.
// 순수 함수다 — DB 도 네트워크도 모른다. 되돌리기(복원)는 하지 않는다: 초안은 가명으로 읽는다.
//
// 두 축으로 가린다.
//  ① 우리가 아는 값 — 금고의 이름·연락처·이메일. 가장 정확하다.
//  ② 형태로 아는 값 — 전화·이메일·주민등록번호·계좌·카드. 자유 글에 남이 섞여 들어온다.
//
// 지우는 게 아니라 **자리표로 바꾼다**. 문장 구조가 무너지면 요약이 엉뚱해진다.

export type MaskSubject = {
  /** 이 당사자의 가명. 자리표로 쓴다. */
  pseudonym: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type MaskResult = {
  text: string;
  /** 무엇을 몇 번 가렸는지. 감사·검증용이며 원문은 담지 않는다. */
  hits: Record<string, number>;
};

const PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; to: string }> = [
  // 주민등록번호가 먼저다 — 숫자 규칙이 전화번호와 겹친다.
  { kind: 'rrn', re: /\b\d{6}[-\s]?[1-4]\d{6}\b/g, to: '[주민번호]' },
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, to: '[이메일]' },
  { kind: 'phone', re: /\b01[016-9][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, to: '[연락처]' },
  { kind: 'phone', re: /\b0\d{1,2}[-\s.]\d{3,4}[-\s.]\d{4}\b/g, to: '[연락처]' },
  { kind: 'card', re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, to: '[카드번호]' },
  { kind: 'account', re: /\b\d{2,3}-\d{2,6}-\d{2,6}\b/g, to: '[계좌번호]' },
];

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 한국 이름은 조사가 붙는다("김민희가", "김민희씨"). 경계를 글자 단위로 잡는다. */
function maskName(text: string, name: string, to: string): [string, number] {
  const trimmed = name.trim();
  if (trimmed.length < 2) return [text, 0];
  let n = 0;
  const out = text.replace(new RegExp(escape(trimmed), 'g'), () => {
    n += 1;
    return to;
  });
  return [out, n];
}

export function maskText(text: string, subject: MaskSubject): MaskResult {
  const hits: Record<string, number> = {};
  let out = text;

  const bump = (kind: string, n: number) => {
    if (n > 0) hits[kind] = (hits[kind] ?? 0) + n;
  };

  // ① 아는 값 먼저. 형태 규칙보다 정확하다.
  if (subject.name) {
    const [next, n] = maskName(out, subject.name, `[${subject.pseudonym}]`);
    out = next;
    bump('name', n);
  }
  for (const [kind, value] of [
    ['phone', subject.phone],
    ['email', subject.email],
  ] as const) {
    if (!value) continue;
    let n = 0;
    out = out.replace(new RegExp(escape(value), 'g'), () => {
      n += 1;
      return kind === 'phone' ? '[연락처]' : '[이메일]';
    });
    bump(kind, n);
  }

  // ② 형태로 아는 값.
  for (const { kind, re, to } of PATTERNS) {
    let n = 0;
    out = out.replace(re, () => {
      n += 1;
      return to;
    });
    bump(kind, n);
  }

  return { text: out, hits };
}

/** 여러 조각을 한 번에. 조각마다 무엇이 가려졌는지 합쳐서 낸다. */
export function maskAll(
  parts: ReadonlyArray<{ label: string; text: string }>,
  subject: MaskSubject,
): { parts: Array<{ label: string; text: string }>; hits: Record<string, number> } {
  const hits: Record<string, number> = {};
  const masked = parts.map((part) => {
    const result = maskText(part.text, subject);
    for (const [kind, n] of Object.entries(result.hits)) hits[kind] = (hits[kind] ?? 0) + n;
    return { label: part.label, text: result.text };
  });
  return { parts: masked, hits };
}
