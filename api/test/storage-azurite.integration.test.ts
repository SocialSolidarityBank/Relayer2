import { randomBytes, randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../src/storage.ts';

const enabled = process.env.RELAYER_AZURITE_INTEGRATION === '1';
const connectionString = process.env.AZURITE_CONNECTION_STRING;

if (enabled && !connectionString) {
  throw new Error('AZURITE_CONNECTION_STRING is required for the Azurite integration test');
}

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!enabled)('Azurite encrypted storage', () => {
  it('stores ciphertext, returns plaintext, and deletes the blob', async () => {
    vi.stubEnv('PII_ENC_KEY', randomBytes(32).toString('base64'));
    const service = BlobServiceClient.fromConnectionString(connectionString!);
    const storage = createStorage(
      { ...process.env, BLOB_ACCOUNT: 'devstoreaccount1' },
      { blobServiceClient: service },
    );
    const relPath = `integration/${randomUUID()}.wav`;
    const plain = Buffer.from('RIFF-encrypted-storage-integration-WAVE');
    const rawBlob = service.getContainerClient('voice').getBlockBlobClient(relPath);

    try {
      await storage.put('voice', relPath, plain);

      const raw = await rawBlob.downloadToBuffer();
      expect(raw).not.toEqual(plain);
      expect(raw.includes(plain)).toBe(false);
      expect(await storage.exists('voice', relPath)).toBe(true);
      expect(await storage.get('voice', relPath)).toEqual(plain);

      await storage.del('voice', relPath);
      expect(await storage.exists('voice', relPath)).toBe(false);
    } finally {
      await rawBlob.deleteIfExists();
    }
  });
});
