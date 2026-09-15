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
