// 금고와 자유 글 암호화. DB 없이 돈다.
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptJson, decryptText, encryptJson, encryptText } from '../src/pii.ts';

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString('base64');
});

describe('자유 글 암호화', () => {
  it('넣은 글을 그대로 되돌린다', () => {
    const text = '간병으로 근로시간이 줄어 카드대금이 연체됐다고 말함.';
    expect(decryptText(encryptText(text))).toBe(text);
  });

  it('같은 글도 매번 다른 암호문이 된다(IV 가 다르다)', () => {
    expect(encryptText('같은 글')).not.toBe(encryptText('같은 글'));
  });

  it('암호문에 본문이 비치지 않는다', () => {
    const packed = encryptText('채무 조정 서류') ?? '';
    expect(packed).toMatch(/^v1\./);
    expect(packed).not.toContain('채무');
  });

  it('빈 값은 null 로 둔다 — 빈 문자열을 암호화해 쌓지 않는다', () => {
    expect(encryptText('')).toBeNull();
    expect(encryptText(null)).toBeNull();
    expect(decryptText(null)).toBeNull();
  });

  it('P1 이전 평문 행은 그대로 읽힌다', () => {
    expect(decryptText('예전에 평문으로 저장된 상담 내용')).toBe('예전에 평문으로 저장된 상담 내용');
  });

  it('인테이크 답은 통째로 한 칸에 담기고 되돌아온다', () => {
    const detail = { basic_livelihood_status: '비수급', economy_detail: '카드대금 2개월 연체' };
    const packed = encryptJson(detail);
    expect(Object.keys(packed)).toEqual(['enc']);
    expect(JSON.stringify(packed)).not.toContain('연체');
    expect(decryptJson(packed)).toEqual(detail);
  });

  it('빈 답은 빈 객체 그대로 둔다', () => {
    expect(encryptJson({})).toEqual({});
    expect(decryptJson({})).toEqual({});
  });
});
