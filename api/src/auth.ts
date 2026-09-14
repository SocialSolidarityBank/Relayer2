// 베타 인증: Argon2id 비밀번호 + HMAC 서명 httpOnly 쿠키(PLAN D1).
// 세션 테이블을 두지 않는다 — 베타는 단일 기관·합성 데이터이고, 만료는 쿠키가 들고 있다.
// 강제 로그아웃·기기 관리가 필요해지면 그때 세션 표를 만든다(P1).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { sql } from './db.ts';

export const COOKIE_NAME = 'relayer_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;

export type Actor = { id: number; name: string; role: 'worker' | 'admin' };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is required');
  return value;
}

export const hashPassword = (plain: string): Promise<string> => hash(plain);

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueCookie(userId: number): string {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS}`;
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export const clearCookie = (): string => `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function readToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

/** 서명과 만료를 확인하고 사용자 id 를 낸다. 둘 중 하나라도 어긋나면 null 이다. */
export function verifyToken(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawId, rawExp, signature] = parts;
  const expected = sign(`${rawId}.${rawExp}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  if (Number(rawExp) * 1000 < Date.now()) return null;
  return Number(rawId);
}

export async function actorFromCookie(cookieHeader: string | undefined): Promise<Actor | null> {
  const userId = verifyToken(readToken(cookieHeader));
  if (!userId) return null;
  const [user] = await sql<Actor[]>`
    select id, name, role from users where id = ${userId} and deactivated_at is null`;
  return user ?? null;
}

/** 로그인. 이메일이 없거나 비밀번호가 틀리면 같은 결과를 낸다(어느 쪽인지 알려주지 않는다). */
export async function login(email: string, password: string): Promise<Actor | null> {
  const [user] = await sql<Array<Actor & { password_hash: string | null }>>`
    select id, name, role, password_hash from users
    where email = ${email} and deactivated_at is null`;
  if (!user?.password_hash) return null;
  if (!(await verify(user.password_hash, password))) return null;
  return { id: user.id, name: user.name, role: user.role };
}
