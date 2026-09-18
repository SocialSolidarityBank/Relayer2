import { randomBytes, randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { describe, expect, it } from 'vitest';
import { createStorage, readStoredBytes } from '../src/storage.ts';

const enabled = process.env.RELAYER_AZURITE_INTEGRATION === '1';
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (enabled && !connectionString) {
  throw new Error('AZURE_STORAGE_CONNECTION_STRING is required for the Azurite integration test');
}

describe.skipIf(!enabled)('Azure Blob encrypted storage', () => {
  it('encrypts an upload, streams plaintext for playback, and deletes the blob', async () => {
    const key = `integration/${randomUUID()}.wav`;
    const plain = Buffer.from('RIFF-encrypted-storage-integration-WAVE');
    const storage = createStorage({
      ...process.env,
      STORAGE_BACKEND: 'blob',
      AZURE_STORAGE_CONNECTION_STRING: connectionString,
      PII_ENC_KEY: randomBytes(32).toString('base64'),
    });
    const rawBlob = BlobServiceClient.fromConnectionString(connectionString!)
      .getContainerClient('voice')
      .getBlockBlobClient(key);

    try {
      await storage.put('voice', key, plain);

      const raw = await rawBlob.downloadToBuffer();
      const properties = await rawBlob.getProperties();
      expect(raw).not.toEqual(plain);
      expect(properties.metadata).toMatchObject({
        algorithm: 'aes-256-gcm',
        keyversion: '1',
        plainbytes: String(plain.byteLength),
      });
      expect(properties.metadata?.iv).toBeTruthy();
      expect(properties.metadata?.tag).toBeTruthy();

      const stored = await storage.open('voice', key);
      expect(stored.plaintextBytes).toBe(plain.byteLength);
      expect(await readStoredBytes(stored, plain.byteLength)).toEqual(plain);

      expect(await storage.delete('voice', key)).toBe('deleted');
      expect(await rawBlob.exists()).toBe(false);
    } finally {
      await rawBlob.deleteIfExists();
    }
  });
});
