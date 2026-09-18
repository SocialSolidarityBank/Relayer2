// 당사자 실명·연락처·이메일·생년월일·주소는 금고에만 암호문으로 둔다.
// 자유 글 컬럼과 로그에 평문을 옮겨 적지 않는다(SPEC §2, GLOSSARY §3).
// P1(2026-09-15)부터 **사람이 쓴 문장도 같은 방식으로 암호화**한다 — 상담 내용에 건강·채무가 섞인다.
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

const BINARY_IV_BYTES = 12;
const BINARY_TAG_BYTES = 16;
const BINARY_HEADER_BYTES = 1 + BINARY_IV_BYTES + BINARY_TAG_BYTES;

/**
 * 음성·문서 바이트용 봉투. 문자열 금고와 같은 PII_ENC_KEY를 직접 AES-256-GCM에 쓴다.
 * 첫 바이트는 키 버전, 이어서 IV(12)·인증 태그(16)·암호문 순서다.
 */
export function encryptPiiBytes(plain: Uint8Array): Uint8Array {
  const iv = randomBytes(BINARY_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decryptPiiBytes(packed: Uint8Array): Uint8Array {
  if (packed.byteLength < BINARY_HEADER_BYTES) throw new Error('invalid encrypted bytes');
  const bytes = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
  const version = bytes[0];
  if (version !== KEY_VERSION) throw new Error(`unknown pii key version: ${version}`);
  const iv = bytes.subarray(1, 1 + BINARY_IV_BYTES);
  const tag = bytes.subarray(1 + BINARY_IV_BYTES, BINARY_HEADER_BYTES);
  const body = bytes.subarray(BINARY_HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * 자유 글 암호화(P1). 금고와 같은 열쇠·같은 포맷을 쓴다.
 * 컬럼 타입은 그대로 text 이고 값만 암호문이 된다.
 */
export const encryptText = encryptPii;

/**
 * 자유 글 복호화. **암호문이 아니면 그대로 돌려준다** —
 * P1 이전에 평문으로 저장된 행이 남아 있어도 읽히게 하려는 관용이다.
 * 쓰기는 언제나 암호화하므로 시간이 지나면 평문은 사라진다.
 */
export function decryptText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!/^v\d+\.[^.]+\.[^.]+\./.test(value)) return value;
  try {
    return decryptPii(value);
  } catch {
    return value;
  }
}

/** 인테이크 답(jsonb)은 통째로 암호화해 `{ enc }` 한 칸에 담는다. 컬럼을 늘리지 않는다. */
export function encryptJson(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value || Object.keys(value).length === 0) return {};
  return { enc: encryptPii(JSON.stringify(value)) };
}

export function decryptJson(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  const packed = value.enc;
  if (typeof packed !== 'string') return value;
  const plain = decryptText(packed);
  return plain ? (JSON.parse(plain) as Record<string, unknown>) : {};
}
