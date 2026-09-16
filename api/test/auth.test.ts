// 쿠키 서명·만료 판정만 검사한다. DB 없이 돈다.
import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_NAME, issueCookie, verifyToken } from '../src/auth.ts';
import { isWebAsset } from '../src/routes.ts';

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

/**
 * 로그인 없이 줄 수 있는 것(2026-09-16 검수에서 뚫려 있던 자리).
 *
 * 전에는 "경로 끝에 점이 있으면 정적 파일"로 보아 `GET /sessions/1.0` 이 인증을 건너뛰고
 * 상담 기록을 통째로 내주었다. Hono 는 그것을 `/sessions/:id` 로 받고 `Number('1.0')` 은 1 이다.
 * 이 테스트가 그 그물을 다시 못 치게 막는다.
 */
describe('로그인 없이 열리는 경로', () => {
  const open = ['/', '/test', '/index.html', '/favicon.ico', '/assets/app-abc123.js'];
  const shut = [
    '/sessions/1',
    '/sessions/1.0',
    '/cases/1.0/briefing',
    '/participants',
    '/participants/x.js',
    '/audit.json',
    '/settings/workers.csv',
    '/settings/org.json',
  ];

  it('화면 껍데기만 연다', () => {
    for (const path of open) expect(isWebAsset(path)).toBe(true);
  });

  it('자료를 내는 경로는 확장자가 붙어도 막힌다', () => {
    for (const path of shut) expect(isWebAsset(path)).toBe(false);
  });
});
