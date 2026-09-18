// 서면 문서(2026-09-16 Q). 상담 중 받은 종이·파일을 사례에 붙인다.
//
//   동의 확인 → 기관 전용 저장소에 저장 → 목록 → 내려받기(감사에 남긴다) → 기한이 지나면 삭제
//
// 음성과 같은 규칙이다. 바이트는 DB 에 넣지 않고, 지울 날을 처음부터 박고, 지운 뒤에도 행은 남긴다.
// 다른 점 하나 — **문서는 다시 열어 본다.** 그래서 내려받을 때마다 누가 언제 열었는지 남긴다.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { getStorage, StorageObjectNotFound } from './storage.ts';
import { assertConsent } from './service.ts';
import { audit } from './audit.ts';
import { CONSENT_COPY, RETENTION_DAYS } from './consent.ts';
import { sql } from './db.ts';


/** 받는 형식. 실행 파일과 압축을 받지 않는다 — 상담에서 주고받을 물건이 아니다. */
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/haansofthwp',
]);

/** 한 파일 20MB. 스캔한 등본 몇 장이면 넉넉하고, 그 이상은 대개 실수다. */
const MAX_BYTES = 20 * 1024 * 1024;

export class DocumentRejected extends Error {}

export type DocumentRow = {
  id: number;
  case_id: number;
  session_id: number | null;
  label: string;
  bytes: number;
  content_type: string;
  delete_after: string;
  deleted_at: string | null;
  created_at: string;
};

const COLUMNS = sql`id, case_id, session_id, label, bytes, content_type,
  delete_after, deleted_at, created_at`;

/**
 * 문서를 받는다. `서면 문서 보관` 동의가 없으면 받지 않는다 —
 * 받아 두고 나중에 동의를 받는 순서는 없다.
 */
export async function saveDocument(input: {
  caseId: number;
  sessionId?: number | null;
  label: string;
  contentType: string;
  bytes: Uint8Array;
  actorId: number;
}): Promise<DocumentRow> {
  if (input.bytes.byteLength === 0) throw new DocumentRejected('빈 파일');
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new DocumentRejected(`파일 크기 초과, ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 까지`);
  }
  if (!ALLOWED.has(input.contentType)) {
    throw new DocumentRejected('받지 않는 형식, 가능한 형식: PDF, 이미지, 문서');
  }
  const label = input.label.trim();
  if (!label) throw new DocumentRejected('문서 이름 필요');

  await assertConsent(input.caseId, 'document_attachment');

  const days = RETENTION_DAYS[CONSENT_COPY.document_attachment.retentionDuration ?? 'institution_retention_30d'];
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  // 사례별로 나눠 둔다. 사례를 통째로 지울 때 같은 접두사를 쓴다.
  // 원본 파일명은 쓰지 않는다 — `김민희_진단서.pdf` 는 그 자체로 정보가 샌다.
  const relPath = `${input.caseId}/${Date.now()}-${sha256.slice(0, 12)}`;
  const storage = getStorage();
  await storage.put('documents', relPath, input.bytes);

  const deleteAfter = new Date(Date.now() + days * 86_400_000).toISOString();
  let row: DocumentRow;
  try {
    [row] = await sql<DocumentRow[]>`
      insert into documents (case_id, session_id, label, rel_path, bytes, content_type, sha256, delete_after, created_by)
      values (${input.caseId}, ${input.sessionId ?? null}, ${label}, ${relPath},
              ${input.bytes.byteLength}, ${input.contentType}, ${sha256}, ${deleteAfter}, ${input.actorId})
      returning ${COLUMNS}`;
  } catch (error) {
    await storage.delete('documents', relPath).catch(() => undefined);
    throw error;
  }

  await audit({
    actorId: input.actorId,
    action: 'document.add',
    caseId: input.caseId,
    fields: [`bytes=${input.bytes.byteLength}`, `type=${input.contentType}`, `retention=${days}일`],
  });

  return row;
}

/** 사례의 문서 목록. 지운 것도 낸다 — 있었다는 사실이 기록이다. */
export async function listDocuments(caseId: number): Promise<DocumentRow[]> {
  return await sql<DocumentRow[]>`
    select ${COLUMNS} from documents where case_id = ${caseId} order by id desc`;
}

/**
 * 내려받기. **열 때마다 감사에 남긴다** — 문서는 다시 열어 보는 물건이라,
 * 누가 언제 열었는지가 남지 않으면 열람 통제가 없는 것과 같다.
 */
export async function readDocument(
  id: number,
  actorId: number,
): Promise<{ row: DocumentRow; body: Readable; bytes: number }> {
  const [row] = await sql<Array<DocumentRow & { rel_path: string }>>`
    select ${COLUMNS}, rel_path from documents where id = ${id}`;
  if (!row) throw new DocumentRejected('문서 없음');
  if (row.deleted_at) throw new DocumentRejected('보유기간 만료로 삭제된 문서');

  const stored = await getStorage().open('documents', row.rel_path).catch((error: unknown) => {
    if (error instanceof StorageObjectNotFound) throw new DocumentRejected('문서 파일 없음');
    throw error;
  });

  await audit({
    actorId,
    action: 'document.read',
    caseId: row.case_id,
    fields: [`document=${id}`, `label=${row.label}`],
  });

  return { row, body: stored.body, bytes: stored.plaintextBytes };
}

/**
 * 기한이 지난 문서를 지운다. 파일을 지우고 행은 남긴다 —
 * 음성과 같은 규칙이다.
 */
export async function sweepExpiredDocuments(): Promise<{
  deleted: number;
  missing: number;
  failed: number;
}> {
  const due = await sql<Array<{ id: number; rel_path: string; case_id: number }>>`
    select id, rel_path, case_id from documents
    where deleted_at is null and delete_after <= now()`;

  let deleted = 0;
  let missing = 0;
  let failed = 0;
  const storage = getStorage();
  for (const doc of due) {
    try {
      const result = await storage.delete('documents', doc.rel_path);
      if (result === 'deleted') deleted += 1;
      else missing += 1;
    } catch {
      failed += 1;
      continue;
    }
    await sql`update documents set deleted_at = now() where id = ${doc.id}`;
  }
  if (due.length > 0) {
    await audit({
      actorId: 0,
      action: 'document.sweep',
      fields: [`deleted=${deleted}`, `missing=${missing}`, `failed=${failed}`],
    });
  }
  return { deleted, missing, failed };
}
