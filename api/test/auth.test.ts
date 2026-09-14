// 쿠키 서명·만료 판정만 검사한다. DB 없이 돈다.
import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_NAME, issueCookie, verifyToken } from '../src/auth.ts';

const SECRET = 'test-secret';
const tokenOf = (cookie: string): string => cookie.slice(`${COOKIE_NAME}=`.length).split(';')[0];

describe('세션 쿠키', () => {
  let token = '';
  beforeAll(() => {
    // 비밀키는 호출 시점에 읽는다. 테스트가 먼저 심어 두면 된다.
    process.env.SESSION_SECRET = SECRET;
    token = tokenOf(issueCookie(7));
  });

  it('제대로 발급한 쿠키는 사용자 id 를 낸다', () => {
    expect(verifyToken(token)).toBe(7);
  });

  it('서명이 바뀌면 거절한다', () => {
    const [id, exp] = token.split('.');
    expect(verifyToken(`${id}.${exp}.deadbeef`)).toBeNull();
  });

  it('사용자 id 만 바꿔치기해도 거절한다', () => {
    const [, exp, sig] = token.split('.');
    expect(verifyToken(`9.${exp}.${sig}`)).toBeNull();
  });

  it('서명이 맞아도 만료됐으면 거절한다', () => {
    const payload = `7.${Math.floor(Date.now() / 1000) - 10}`;
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyToken(`${payload}.${sig}`)).toBeNull();
  });

  it('쿠키는 httpOnly 와 SameSite 를 갖는다', () => {
    const cookie = issueCookie(1);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });
});
