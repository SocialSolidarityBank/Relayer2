// 불일치 둘. 정본이 하나가 아니라 둘로 나누라고 했다(요구 23).
import { describe, expect, it } from 'vitest';
import { acrossSessions, extractFacts, voiceVsWritten } from '../src/domain/mismatch.ts';

describe('숫자 사실 뽑기', () => {
  it('건수·금액·기간을 뽑는다', () => {
    const facts = extractFacts('연체 4건, 합계 420만 원. 월세 35만 원이 두 달 밀렸다고 함.');
    expect(facts).toContainEqual({ label: '연체 건수', value: '4' });
    expect(facts).toContainEqual({ label: '월세', value: '35' });
  });

  it('같은 것을 두 번 말했으면 나중 것을 쓴다', () => {
    // 상담에서 말을 고쳐 하는 일은 흔하다. 나중 말이 정정이다.
    const facts = extractFacts('처음엔 연체 3건이라고 했다가, 다시 세어 보니 연체 4건이라고 함.');
    expect(facts).toContainEqual({ label: '연체 건수', value: '4' });
    expect(facts).not.toContainEqual({ label: '연체 건수', value: '3' });
  });
});

describe('음성·수기 기록 불일치', () => {
  it('한글로 전사된 건수를 숫자 기록과 비교하고 원문 근거를 보존한다', () => {
    const found = voiceVsWritten('연체는 네 건입니다.', '연체 3건 확인.');
    expect(found).toEqual([expect.objectContaining({ label: '연체 건수', left: '4', right: '3' })]);
    expect(found[0].leftSnippet).toContain('네 건');
  });

  it('한글 숫자와 아라비아 숫자의 표기 차이는 불일치가 아니다', () => {
    const spoken = '연체는 열두 건입니다. 월세는 삼십오만 원이고 두 달 밀렸습니다.';
    expect(extractFacts(spoken)).toEqual(expect.arrayContaining([
      { label: '연체 건수', value: '12' },
      { label: '월세', value: '35' },
      { label: '밀린 개월', value: '2' },
    ]));
    expect(voiceVsWritten(spoken, '연체 12건. 월세 35만 원. 2개월 밀림.')).toEqual([]);
  });

  it('숫자가 아닌 동음어를 추측해서 건수로 바꾸지 않는다', () => {
    expect(voiceVsWritten('연체는 내 건입니다.', '연체 3건.')).toEqual([]);
  });

  it('한두 건 같은 범위를 하나의 정확한 건수로 추측하지 않는다', () => {
    expect(extractFacts('연체는 한두 건입니다.')).toEqual([]);
  });

  it('같은 이름의 수가 다르면 짚는다', () => {
    const found = voiceVsWritten('연체 4건이라고 말함.', '연체 3건 확인함.');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'voice_vs_written',
      label: '연체 건수',
      left: '4',
      right: '3',
      leftFrom: '녹음',
      rightFrom: '수기 기록',
    });
  });

  it('한쪽에만 있는 것은 불일치가 아니다', () => {
    // 안 적었을 뿐이다. 그걸 불일치라고 하면 화면이 경고로 뒤덮인다.
    expect(voiceVsWritten('연체 4건, 월세 35만 원.', '연체 4건.')).toEqual([]);
  });

  it('문장이 달라도 수가 같으면 어긋난 것이 아니다', () => {
    expect(voiceVsWritten('연체가 4건이나 된다고 함.', '연체 4건.')).toEqual([]);
  });

  it('서로 다른 돈 종류를 하나의 금액으로 섞지 않는다', () => {
    expect(voiceVsWritten('대출금 300만 원이라고 함.', '지원금 400만 원을 받음.')).toEqual([]);
  });

  it('같은 돈 종류가 다르면 실제 출처 조각을 함께 낸다', () => {
    const [found] = voiceVsWritten(
      '현재 대출금은 300만 원이라고 말함.',
      '확인한 대출금은 400만 원임.',
    );
    expect(found.label).toBe('대출금');
    expect(found.leftSnippet).toContain('대출금은 300만 원');
    expect(found.rightSnippet).toContain('대출금은 400만 원');
  });
});

describe('회차간 기록 불일치', () => {
  it('달라진 사실을 회차와 함께 짚는다', () => {
    const found = acrossSessions(
      { seq: 2, text: '연체 3건이라고 함.' },
      { seq: 3, text: '연체 4건으로 늘었다고 함.' },
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'across_sessions',
      left: '3',
      right: '4',
      leftFrom: '2회차',
      rightFrom: '3회차',
    });
  });

  it('어느 쪽이 맞다고 말하지 않는다', () => {
    // 연체가 는 것은 오류가 아니라 사정이 바뀐 것이다. 판정은 사람이 한다.
    const [m] = acrossSessions({ seq: 1, text: '주 3일 근무.' }, { seq: 2, text: '주 4일 근무.' });
    expect(Object.keys(m)).not.toContain('correct');
    expect(Object.keys(m)).not.toContain('wrong');
    expect(m.leftFrom).toBe('1회차');
  });

  it('두 종류는 섞이지 않는다', () => {
    // 원인도 대응도 다르다. 한 목록에 섞으면 무엇을 해야 할지 알 수 없다.
    const voice = voiceVsWritten('연체 4건.', '연체 3건.');
    const across = acrossSessions({ seq: 1, text: '연체 3건.' }, { seq: 2, text: '연체 4건.' });
    expect(voice[0].kind).not.toBe(across[0].kind);
  });
});
