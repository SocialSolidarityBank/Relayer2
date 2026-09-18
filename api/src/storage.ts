import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { decryptPiiBytes, encryptPiiBytes } from './pii.ts';

export const STORAGE_CONTAINERS = ['voice', 'documents'] as const;
export type StorageContainer = (typeof STORAGE_CONTAINERS)[number];

export interface Storage {
  put(container: StorageContainer, relPath: string, bytes: Uint8Array): Promise<void>;
  get(container: StorageContainer, relPath: string): Promise<Uint8Array>;
  del(container: StorageContainer, relPath: string): Promise<void>;
  exists(container: StorageContainer, relPath: string): Promise<boolean>;
}

function safeRelPath(relPath: string): string {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\\')) {
    throw new Error('storage path is invalid');
  }
  const parts = relPath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('storage path is invalid');
  }
  return parts.join('/');
}

abstract class EncryptedStorage implements Storage {
  protected abstract write(container: StorageContainer, relPath: string, bytes: Uint8Array): Promise<void>;
  protected abstract read(container: StorageContainer, relPath: string): Promise<Uint8Array>;
  abstract del(container: StorageContainer, relPath: string): Promise<void>;
  abstract exists(container: StorageContainer, relPath: string): Promise<boolean>;

  async put(container: StorageContainer, relPath: string, bytes: Uint8Array): Promise<void> {
    await this.write(container, safeRelPath(relPath), encryptPiiBytes(bytes));
  }

  async get(container: StorageContainer, relPath: string): Promise<Uint8Array> {
    return decryptPiiBytes(await this.read(container, safeRelPath(relPath)));
  }
}

class FileStorage extends EncryptedStorage {
  readonly #roots: Record<StorageContainer, string>;

  constructor(env: NodeJS.ProcessEnv) {
    super();
    this.#roots = {
      voice: resolve(env.VOICE_ROOT ?? './voice'),
      documents: resolve(env.DOC_ROOT ?? './documents'),
    };
  }

  #path(container: StorageContainer, relPath: string): string {
    return join(this.#roots[container], safeRelPath(relPath));
  }

  protected async write(
    container: StorageContainer,
    relPath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const path = this.#path(container, relPath);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
  }

  protected async read(container: StorageContainer, relPath: string): Promise<Uint8Array> {
    return readFile(this.#path(container, relPath));
  }

  async del(container: StorageContainer, relPath: string): Promise<void> {
    await rm(this.#path(container, relPath), { force: true });
  }

  async exists(container: StorageContainer, relPath: string): Promise<boolean> {
    return access(this.#path(container, relPath)).then(
      () => true,
      () => false,
    );
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream as NodeJS.ReadableStream & AsyncIterable<Uint8Array>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      chunks.push(bytes);
      total += bytes.byteLength;
    }
  } catch (error) {
    // SDK 타입은 destroy를 숨기지만 Node 응답 스트림은 실패 시 반드시 닫아야 한다.
    const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };
    destroyable.destroy?.();
    throw error;
  }
  return Buffer.concat(chunks, total);
}

class BlobStorage extends EncryptedStorage {
  readonly #service: BlobServiceClient;
  readonly #ready = new Map<StorageContainer, Promise<ContainerClient>>();

  constructor(account: string, service?: BlobServiceClient) {
    super();
    if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error('BLOB_ACCOUNT is invalid');
    this.#service =
      service ??
      new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
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

  protected async write(
    container: StorageContainer,
    relPath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const client = (await this.#container(container)).getBlockBlobClient(relPath);
    await client.uploadData(bytes);
  }

  protected async read(container: StorageContainer, relPath: string): Promise<Uint8Array> {
    const client = (await this.#container(container)).getBlockBlobClient(relPath);
    const response = await client.download();
    if (!response.readableStreamBody) throw new Error('stored object body is unavailable');
    return readStream(response.readableStreamBody);
  }

  async del(container: StorageContainer, relPath: string): Promise<void> {
    const client = (await this.#container(container)).getBlockBlobClient(safeRelPath(relPath));
    await client.deleteIfExists();
  }

  async exists(container: StorageContainer, relPath: string): Promise<boolean> {
    const client = (await this.#container(container)).getBlockBlobClient(safeRelPath(relPath));
    return client.exists();
  }
}

type StorageDependencies = {
  blobServiceClient?: BlobServiceClient;
};

export function createStorage(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: StorageDependencies = {},
): Storage {
  const account = env.BLOB_ACCOUNT?.trim();
  return account
    ? new BlobStorage(account, dependencies.blobServiceClient)
    : new FileStorage(env);
}

let cachedSignature: string | undefined;
let cachedStorage: Storage | undefined;

export function getStorage(): Storage {
  const signature = JSON.stringify([
    process.env.BLOB_ACCOUNT,
    process.env.VOICE_ROOT,
    process.env.DOC_ROOT,
    process.env.PII_ENC_KEY,
  ]);
  if (!cachedStorage || cachedSignature !== signature) {
    cachedStorage = createStorage(process.env);
    cachedSignature = signature;
  }
  return cachedStorage;
}
