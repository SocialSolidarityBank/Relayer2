import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { BlobServiceClient } from '@azure/storage-blob';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../src/storage.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'relayer-storage-'));
  vi.stubEnv('PII_ENC_KEY', randomBytes(32).toString('base64'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('encrypted filesystem storage', () => {
  it('stores ciphertext and returns the original bytes', async () => {
    const plain = Buffer.from('RIFF-encrypted-storage-WAVE');
    const storage = createStorage({
      ...process.env,
      VOICE_ROOT: join(root, 'voice'),
      DOC_ROOT: join(root, 'documents'),
      BLOB_ACCOUNT: undefined,
    });

    await storage.put('voice', 'case-1/recording.wav', plain);

    const raw = await readFile(join(root, 'voice', 'case-1', 'recording.wav'));
    expect(raw).not.toEqual(plain);
    expect(raw.includes(plain)).toBe(false);
    expect(await storage.get('voice', 'case-1/recording.wav')).toEqual(plain);
  });

  it('preserves private directory and file permissions', async () => {
    const storage = createStorage({
      ...process.env,
      VOICE_ROOT: join(root, 'voice'),
      DOC_ROOT: join(root, 'documents'),
      BLOB_ACCOUNT: undefined,
    });

    await storage.put('documents', 'case-2/document', Buffer.from('private'));

    expect((await stat(join(root, 'documents', 'case-2'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'documents', 'case-2', 'document'))).mode & 0o777).toBe(0o600);
  });

  it('reports existence and deletes the encrypted object', async () => {
    const storage = createStorage({
      ...process.env,
      VOICE_ROOT: join(root, 'voice'),
      DOC_ROOT: join(root, 'documents'),
      BLOB_ACCOUNT: undefined,
    });
    const path = 'case-3/recording.wav';

    expect(await storage.exists('voice', path)).toBe(false);
    await storage.put('voice', path, Buffer.from('audio'));
    expect(await storage.exists('voice', path)).toBe(true);
    await storage.del('voice', path);
    expect(await storage.exists('voice', path)).toBe(false);
    await expect(storage.del('voice', path)).resolves.toBeUndefined();
  });
});

describe('encrypted Blob storage', () => {
  it('uses encrypted bytes for Blob I/O and decrypts reads', async () => {
    let raw: Buffer | undefined;
    const blockBlob = {
      uploadData: async (bytes: Uint8Array) => {
        raw = Buffer.from(bytes);
      },
      download: async () => ({
        readableStreamBody: Readable.from(raw ? [raw] : []),
      }),
      deleteIfExists: async () => {
        const existed = raw !== undefined;
        raw = undefined;
        return { succeeded: existed };
      },
      exists: async () => raw !== undefined,
    };
    const service = {
      getContainerClient: () => ({
        createIfNotExists: async () => undefined,
        getBlockBlobClient: () => blockBlob,
      }),
    } as unknown as BlobServiceClient;
    const storage = createStorage(
      { ...process.env, BLOB_ACCOUNT: 'relayerstore' },
      { blobServiceClient: service },
    );
    const plain = Buffer.from('blob plaintext');

    await storage.put('documents', 'case-4/document', plain);

    expect(raw).toBeDefined();
    expect(raw).not.toEqual(plain);
    expect(raw?.includes(plain)).toBe(false);
    expect(await storage.get('documents', 'case-4/document')).toEqual(plain);
    expect(await storage.exists('documents', 'case-4/document')).toBe(true);
    await storage.del('documents', 'case-4/document');
    expect(await storage.exists('documents', 'case-4/document')).toBe(false);
  });
});
