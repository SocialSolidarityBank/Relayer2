/**
 * 동의 문안의 DB 판(2026-09-18 Q D6). 코드 정본(consent.ts)이 바닥이고, 관리자가 고친 판이 위에 얹힌다.
 *
 * - 저장은 `consent_copy` 에 **행을 쌓는다**(append-only). 판은 전역 하나라 어느 영역을 고치든
 *   `consent-standard-form-v<N+1>` 로 오른다 — 그래서 모든 영역의 지난 동의가 `확인 필요`로 떨어진다.
 *   경고창은 화면이 띄우고, 다시 받는 고지는 기관 절차다(§21-3 을 이 결정이 대체).
 * - 읽기는 프로세스 캐시다. 서버가 뜰 때 한 번, 저장 뒤 한 번 다시 읽는다.
 *   ponytail: 서버가 한 프로세스라 캐시 하나면 된다 — 여러 프로세스가 되면 저장 뒤 재시작이 필요하다.
 */
import { audit } from './audit.ts';
import {
  CODE_COPY_VERSION,
  CONSENT_DOMAINS,
  setLiveCopy,
  type ConsentDomain,
  type EditableCopy,
} from './consent.ts';
import { sql } from './db.ts';

type Row = {
  domain: ConsentDomain;
  version: string;
  copy: string;
  items: string[];
  purpose_text: string;
  retention_text: string;
  refusal_text: string;
};

const versionNumber = (version: string): number => Number(/-v(\d+)$/.exec(version)?.[1] ?? 0);

/** 표의 마지막 행(영역마다)과 가장 높은 판을 캐시에 앉힌다. 표가 비어 있으면 코드 정본 그대로다. */
export async function loadConsentCopy(): Promise<string> {
  const rows = await sql<Row[]>`
    select distinct on (domain) domain, version, copy, items, purpose_text, retention_text, refusal_text
    from consent_copy order by domain, id desc`;
  const text: Partial<Record<ConsentDomain, EditableCopy>> = {};
  let version = CODE_COPY_VERSION;
  for (const r of rows) {
    if (!CONSENT_DOMAINS.includes(r.domain)) continue;
    text[r.domain] = {
      copy: r.copy,
      items: r.items,
      purposeText: r.purpose_text,
      retentionText: r.retention_text,
      refusalText: r.refusal_text,
    };
    if (versionNumber(r.version) > versionNumber(version)) version = r.version;
  }
  setLiveCopy(version, text);
  return version;
}

/** 새 판을 쌓고 캐시를 다시 읽는다. 돌려주는 값은 새 판 이름이다. */
export async function putConsentCopy(actorId: number, domain: ConsentDomain, input: EditableCopy): Promise<string> {
  const [{ max }] = await sql<Array<{ max: string | null }>>`
    select max((regexp_match(version, '-v(\\d+)$'))[1]::int)::text as max from consent_copy`;
  const next = `consent-standard-form-v${Math.max(Number(max ?? 0), versionNumber(CODE_COPY_VERSION)) + 1}`;
  await sql`
    insert into consent_copy (domain, version, copy, items, purpose_text, retention_text, refusal_text, created_by)
    values (${domain}, ${next}, ${input.copy}, ${sql.json(input.items)}, ${input.purposeText},
            ${input.retentionText}, ${input.refusalText}, ${actorId})`;
  await loadConsentCopy();
  await audit({ actorId, action: 'consent.copy.update', fields: [`domain=${domain}`, `version=${next}`] });
  return next;
}
