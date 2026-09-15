// 외부로 **실제로 나가는 글**을 붙잡아 본다.
//
// masking.test.ts 는 함수가 맞게 가리는지를 본다. 이 시험은 다르다.
// 금고 복호화 → 가림 → 전송까지 이어진 길 끝에서 요청 본문을 가로채,
// 원문이 한 글자라도 실려 나가는지 본다. 가림이 어디선가 빠지면 여기서 걸린다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskAll } from '../src/domain/masking.ts';

/** 이 당사자의 실제 값. 이 중 하나라도 나가면 사고다. */
const REAL = {
  name: '김민희',
  phone: '010-2345-6789',
  email: 'minhee@example.com',
  rrn: '850312-2345678',
  card: '5412-7512-3412-3456',
  account: '110-234-567890',
  other_phone: '010-9876-5432',
  other_email: 'kim.official@seoul.go.kr',
};

const MEMO = [
  `${REAL.name}가 약속보다 20분 늦게 왔다. ${REAL.name}씨 남편은 함께 오지 않았다.`,
  `연락은 ${REAL.phone} 로 하면 되고, 급하면 딸 번호 ${REAL.other_phone} 로 해달라고 함.`,
  `주민등록번호 ${REAL.rrn} 로 서류를 넣었는데 반려됐다고 함.`,
  `급여는 신한 ${REAL.account} 계좌로 들어온다고 함.`,
  `카드값은 ${REAL.card} 으로 밀려 있다고 함.`,
  `담당 주무관 이메일 ${REAL.other_email} 로 문의하라는 안내를 받았다고 함.`,
  '월세 40만 원이 두 달 밀렸다고 함.',
].join(' ');

const SUBJECT = {
  pseudonym: 'lynx-099',
  name: REAL.name,
  phone: REAL.phone,
  email: REAL.email,
};

describe('외부로 나가는 글', () => {
  const outbound = () =>
    maskAll(
      [
        { label: '상담 내용', text: MEMO },
        { label: '수행할 과제', text: `${REAL.name} 본인 명의 통장 사본 떼어 오기` },
      ],
      SUBJECT,
    );

  it('당사자를 가리킬 수 있는 값이 하나도 실려 나가지 않는다', () => {
    const sent = outbound()
      .parts.map((p) => p.text)
      .join('\n');

    // 하나씩 이름을 달아 확인한다. 실패했을 때 무엇이 샜는지 바로 보이게.
    for (const [kind, value] of Object.entries(REAL)) {
      expect(sent, `${kind} 가 그대로 나갔다`).not.toContain(value);
    }
  });

  it('카드에 적힌 이름도 같은 길을 탄다', () => {
    // 상담 내용만 가리고 카드를 빠뜨리는 실수가 잦다. 카드도 사람이 쓴 글이다.
    const card = outbound().parts[1].text;
    expect(card).not.toContain(REAL.name);
    expect(card).toContain(SUBJECT.pseudonym);
  });

  it('금액·기간은 남긴다', () => {
    // 다 지우면 요약할 것이 없다. 사람을 가리키지 않는 사실은 그대로 둔다.
    const sent = outbound()
      .parts.map((p) => p.text)
      .join('\n');
    expect(sent).toContain('40만 원');
    expect(sent).toContain('두 달');
    expect(sent).toContain('20분');
  });

  it('무엇을 몇 건 가렸는지 센다 — 가린 값은 세지 않는다', () => {
    const { hits } = outbound();
    expect(hits).toEqual({ name: 3, phone: 2, rrn: 1, email: 1, card: 1, account: 1 });

    // 건수만 남고 값은 어디에도 없다. 감사 기록에 그대로 실리는 값이다.
    const asText = JSON.stringify(hits);
    for (const value of Object.values(REAL)) expect(asText).not.toContain(value);
  });
});
