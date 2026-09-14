// 당사자 실명·연락처·이메일·생년월일·주소는 금고에만 암호문으로 둔다.
// 자유 글 컬럼과 로그에 평문을 옮겨 적지 않는다(SPEC §2, GLOSSARY §3).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const KEY_VERSION = 1;

function key(): Buffer {
  const raw = process.env.PII_ENC_KEY;
  if (!raw) throw new Error('PII_ENC_KEY is required');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('PII_ENC_KEY must be 32 bytes (base64)');
  return buf;
}

export function encryptPii(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v${KEY_VERSION}.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

export function decryptPii(packed: string | null | undefined): string | null {
  if (!packed) return null;
  const [version, iv, tag, body] = packed.split('.');
  if (version !== `v${KEY_VERSION}`) throw new Error(`unknown pii key version: ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}
