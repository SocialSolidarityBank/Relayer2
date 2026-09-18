import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { app } from '../src/routes.ts';
import { sql } from '../src/db.ts';
import { sweepExpiredDocuments } from '../src/documents.ts';
import { getStorage } from '../src/storage.ts';
import { cookie, enabled, fixture } from './voice-fixture.ts';

const DOCUMENT_CONSENTS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'document_attachment',
] as const;

describe.skipIf(!enabled)('document encrypted storage', () => {
  it('stores ciphertext, downloads plaintext, and sweeps the object', async () => {
    const owner = await fixture(DOCUMENT_CONSENTS);
    const plain = Buffer.from('%PDF-1.7\nprivate document\n%%EOF');
    const uploaded = await app.request(`/cases/${owner.case_id}/documents?label=${encodeURIComponent('상담 문서.pdf')}`, {
      method: 'POST',
      headers: {
        cookie: cookie(owner.worker),
        'content-type': 'application/pdf',
      },
      body: plain,
    });
    expect(uploaded.status).toBe(201);
    const document = (await uploaded.json()) as { id: number };
    const [{ rel_path: relPath }] = await sql<Array<{ rel_path: string }>>`
      select rel_path from documents where id = ${document.id}`;

    const raw = await readFile(join(process.env.DOC_ROOT ?? './documents', relPath));
    expect(raw).not.toEqual(plain);
    expect(raw.includes(plain)).toBe(false);

    const downloaded = await app.request(`/documents/${document.id}`, {
      headers: { cookie: cookie(owner.worker) },
    });
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(plain);

    await sql`update documents set delete_after = now() - interval '1 second' where id = ${document.id}`;
    expect(await getStorage().exists('documents', relPath)).toBe(true);
    expect(await sweepExpiredDocuments()).toEqual({ deleted: 1, missing: 0, failed: 0 });
    expect(await getStorage().exists('documents', relPath)).toBe(false);
  });

  it('marks an already missing expired object without retrying forever', async () => {
    const owner = await fixture(DOCUMENT_CONSENTS);
    const plain = Buffer.from('%PDF-1.7\nmissing document\n%%EOF');
    const uploaded = await app.request(`/cases/${owner.case_id}/documents?label=missing.pdf`, {
      method: 'POST',
      headers: {
        cookie: cookie(owner.worker),
        'content-type': 'application/pdf',
      },
      body: plain,
    });
    const document = (await uploaded.json()) as { id: number };
    const [{ rel_path: relPath }] = await sql<Array<{ rel_path: string }>>`
      select rel_path from documents where id = ${document.id}`;
    await getStorage().del('documents', relPath);
    await sql`update documents set delete_after = now() - interval '1 second' where id = ${document.id}`;

    expect(await sweepExpiredDocuments()).toEqual({ deleted: 0, missing: 1, failed: 0 });
    const [row] = await sql<Array<{ deleted_at: string | null }>>`
      select deleted_at from documents where id = ${document.id}`;
    expect(row.deleted_at).not.toBeNull();
  });
});
