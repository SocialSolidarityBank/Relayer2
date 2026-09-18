import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, pipeline } from 'node:stream';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';

export const STORAGE_CONTAINERS = ['voice', 'documents'] as const;
export type StorageContainer = (typeof STORAGE_CONTAINERS)[number];
export type DeleteResult = 'deleted' | 'missing';

export type StoredObject = {
  body: Readable;
  plaintextBytes: number;
};

export interface Storage {
  put(
    container: StorageContainer,
    key: string,
    bytes: Uint8Array,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  open(container: StorageContainer, key: string): Promise<StoredObject>;
  delete(container: StorageContainer, key: string): Promise<DeleteResult>;
}

export class StorageObjectNotFound extends Error {}

const isMissing = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (('code' in error && error.code === 'ENOENT') ||
    ('statusCode' in error && error.statusCode === 404));

function safeKey(key: string): string {
  if (!key || key.startsWith('/') || key.includes('\\')) throw new Error('storage key is invalid');
  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('storage key is invalid');
  }
  return parts.join('/');
}

class FileStorage implements Storage {
  readonly #roots: Record<StorageContainer, string>;

  constructor(env: NodeJS.ProcessEnv) {
    this.#roots = {
      voice: resolve(env.VOICE_ROOT ?? './voice'),
      documents: resolve(env.DOC_ROOT ?? './documents'),
    };
  }

  #path(container: StorageContainer, key: string): string {
    return join(this.#roots[container], safeKey(key));
  }

  async put(
    container: StorageContainer,
    key: string,
    bytes: Uint8Array,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const path = this.#path(container, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, {
      mode: 0o600,
      flag: options?.overwrite === false ? 'wx' : 'w',
    });
  }

  async open(container: StorageContainer, key: string): Promise<StoredObject> {
    const path = this.#path(container, key);
    try {
      const info = await stat(path);
      return { body: createReadStream(path), plaintextBytes: info.size };
    } catch (error) {
      if (isMissing(error)) throw new StorageObjectNotFound('stored object not found');
      throw error;
    }
  }

  async delete(container: StorageContainer, key: string): Promise<DeleteResult> {
    try {
      await rm(this.#path(container, key));
      return 'deleted';
    } catch (error) {
      if (isMissing(error)) return 'missing';
      throw error;
    }
  }
}

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = '1';
const IV_BYTES = 12;
const STORAGE_LABEL = Buffer.from('storage', 'utf8');

type EncryptionMetadata = {
  algorithm: string;
  keyversion: string;
  iv: string;
  tag?: string;
  plainbytes: string;
};

function storageKey(env: NodeJS.ProcessEnv): Buffer {
  const encoded = env.PII_ENC_KEY;
  if (!encoded) throw new Error('PII_ENC_KEY is required for blob storage');
  const root = Buffer.from(encoded, 'base64');
  if (root.length !== 32) throw new Error('PII_ENC_KEY must be 32 bytes (base64)');
  return Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), STORAGE_LABEL, 32));
}

function blobService(env: NodeJS.ProcessEnv): BlobServiceClient {
  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString);

  const account = env.AZURE_STORAGE_ACCOUNT?.trim();
  const accountKey = env.AZURE_STORAGE_ACCOUNT_KEY?.trim();
  if (!account || !accountKey) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCOUNT_KEY are required for blob storage',
    );
  }
  if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error('AZURE_STORAGE_ACCOUNT is invalid');
  return new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new StorageSharedKeyCredential(account, accountKey),
  );
}

class BlobStorage implements Storage {
  readonly #service: BlobServiceClient;
  readonly #key: Buffer;
  readonly #ready = new Map<StorageContainer, Promise<ContainerClient>>();

  constructor(env: NodeJS.ProcessEnv) {
    this.#service = blobService(env);
    this.#key = storageKey(env);
  }

  #container(name: StorageContainer): Promise<ContainerClient> {
    let ready = this.#ready.get(name);
    if (!ready) {
      const container = this.#service.getContainerClient(name);
      ready = container.createIfNotExists().then(() => container);
      this.#ready.set(name, ready);
      void ready.catch(() => {
        if (this.#ready.get(name) === ready) this.#ready.delete(name);
      });
    }
    return ready;
  }

  #aad(container: StorageContainer, key: string, plaintextBytes: string): Buffer {
    return Buffer.from(`${KEY_VERSION}\0${plaintextBytes}\0${container}\0${key}`, 'utf8');
  }

  async put(
    containerName: StorageContainer,
    rawKey: string,
    bytes: Uint8Array,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const key = safeKey(rawKey);
    const container = await this.#container(containerName);
    const blob = container.getBlockBlobClient(key);
    const iv = randomBytes(IV_BYTES);
    const metadata: EncryptionMetadata = {
      algorithm: ALGORITHM,
      keyversion: KEY_VERSION,
      iv: iv.toString('base64url'),
      plainbytes: String(bytes.byteLength),
    };
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    cipher.setAAD(this.#aad(containerName, key, metadata.plainbytes));
    const first = cipher.update(bytes);
    const final = cipher.final();
    const encrypted = final.byteLength > 0
      ? Buffer.concat([first, final], first.byteLength + final.byteLength)
      : first;
    metadata.tag = cipher.getAuthTag().toString('base64url');
    await blob.uploadData(encrypted, {
      conditions: options?.overwrite === false ? { ifNoneMatch: '*' } : undefined,
      metadata,
    });
  }

  async open(containerName: StorageContainer, rawKey: string): Promise<StoredObject> {
    const key = safeKey(rawKey);
    const container = await this.#container(containerName);
    try {
      const response = await container.getBlobClient(key).download();
      const metadata = response.metadata;
      if (
        metadata?.algorithm !== ALGORITHM ||
        metadata.keyversion !== KEY_VERSION ||
        !metadata.iv ||
        !metadata.tag ||
        !metadata.plainbytes
      ) {
        throw new Error('stored object encryption metadata is invalid');
      }
      const plaintextBytes = Number(metadata.plainbytes);
      if (!Number.isSafeInteger(plaintextBytes) || plaintextBytes < 0) {
        throw new Error('stored object plaintext size is invalid');
      }
      if (!response.readableStreamBody) throw new Error('stored object body is unavailable');

      const source = response.readableStreamBody;
      const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(metadata.iv, 'base64url'));
      decipher.setAAD(this.#aad(containerName, key, metadata.plainbytes));
      decipher.setAuthTag(Buffer.from(metadata.tag, 'base64url'));
      pipeline(source, decipher, () => undefined);
      return {
        body: decipher,
        plaintextBytes,
      };
    } catch (error) {
      if (isMissing(error)) throw new StorageObjectNotFound('stored object not found');
      throw error;
    }
  }

  async delete(containerName: StorageContainer, rawKey: string): Promise<DeleteResult> {
    const container = await this.#container(containerName);
    return (await container.deleteBlob(safeKey(rawKey)).then(
      () => true,
      (error) => {
        if (isMissing(error)) return false;
        throw error;
      },
    ))
      ? 'deleted'
      : 'missing';
  }
}

let cachedSignature: string | undefined;
let cachedStorage: Storage | undefined;

export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const backend = env.STORAGE_BACKEND?.trim() || 'fs';
  if (backend === 'fs') return new FileStorage(env);
  if (backend === 'blob') return new BlobStorage(env);
  throw new Error('STORAGE_BACKEND must be fs or blob');
}

export function getStorage(): Storage {
  const signature = JSON.stringify([
    process.env.STORAGE_BACKEND,
    process.env.VOICE_ROOT,
    process.env.DOC_ROOT,
    process.env.AZURE_STORAGE_CONNECTION_STRING,
    process.env.AZURE_STORAGE_ACCOUNT,
    process.env.AZURE_STORAGE_ACCOUNT_KEY,
    process.env.PII_ENC_KEY,
  ]);
  if (!cachedStorage || cachedSignature !== signature) {
    cachedStorage = createStorage(process.env);
    cachedSignature = signature;
  }
  return cachedStorage;
}

export async function peekStoredBody(
  stored: StoredObject,
  minimumBytes: number,
): Promise<{ prefix: Buffer; body: Readable }> {
  const iterator = stored.body[Symbol.asyncIterator]();
  const buffered: Buffer[] = [];
  let total = 0;
  while (total < minimumBytes) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = Buffer.isBuffer(next.value)
      ? next.value
      : Buffer.from(next.value as Uint8Array);
    buffered.push(chunk);
    total += chunk.byteLength;
  }
  const prefix = Buffer.concat(buffered, total).subarray(0, minimumBytes);
  const body = Readable.from(
    (async function* () {
      try {
        yield* buffered;
        for (;;) {
          const next = await iterator.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await iterator.return?.();
      }
    })(),
  );
  body.once('close', () => {
    if (!stored.body.destroyed) stored.body.destroy();
  });
  return { prefix, body };
}

export async function readStoredBytes(stored: StoredObject, maxBytes: number): Promise<Buffer> {
  if (stored.plaintextBytes > maxBytes) throw new Error('stored object exceeds allowed size');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stored.body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maxBytes) {
      stored.body.destroy();
      throw new Error('stored object exceeds allowed size');
    }
    chunks.push(bytes);
  }
  if (total !== stored.plaintextBytes) throw new Error('stored object size mismatch');
  return Buffer.concat(chunks, total);
}
