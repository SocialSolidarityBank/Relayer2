import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalPreimage,
  CODE_COPY_VERSION,
  CONSENT_DOMAINS,
  copyHash,
  copyText,
  copyVersion,
  foldConsent,
  effectiveInstitutionName,
  setLiveCopy,
  type ConsentEventRow,
} from '../src/consent.ts';

const INSTITUTION = '푸른은행';

afterEach(() => setLiveCopy(CODE_COPY_VERSION, {}));

describe('기관명 동의 문안 v4', () => {
  it('binds the processor, trustee, and fixed region into rendered copy and the canonical preimage', () => {
    const copy = copyText('external_stt_processing', INSTITUTION);
    expect(copy.copy).toContain(INSTITUTION);
    expect(copy.copy).toContain('수탁자 사회연대은행');
    expect(copy.copy).toContain('한국 중부(koreacentral)');

    const preimage = canonicalPreimage('external_stt_processing', INSTITUTION);
    expect(preimage).toContain(`processor=${INSTITUTION}`);
    expect(preimage).toContain('trustee=사회연대은행');
    expect(preimage).toContain('region=koreacentral');
  });

  it('keeps hashes stable inside one institution and changes them when the institution name changes', () => {
    const first = copyHash('personal_data_collection_use', INSTITUTION);
    expect(copyHash('personal_data_collection_use', INSTITUTION)).toBe(first);
    expect(copyHash('personal_data_collection_use', '다른기관')).not.toBe(first);
  });

  it('uses one non-empty processor identity before onboarding for both writes and reads', () => {
    const effective = effectiveInstitutionName('');
    expect(effective).toBe('사회연대은행');
    expect(canonicalPreimage('personal_data_collection_use', effective)).toContain(
      'processor=사회연대은행',
    );
  });

  it('keeps the code-wide v4 version ahead of edited v3 DB copy while applying institution replacement last', () => {
    setLiveCopy('consent-standard-form-v3', {
      personal_data_collection_use: {
        copy: '사회연대은행은 편집한 v3 문안을 사용합니다.',
        items: ['편집 항목'],
        purposeText: '사회연대은행의 편집 목적',
        retentionText: '편집 보유기간',
        refusalText: '편집 거부 안내',
      },
    });

    expect(copyVersion()).toBe('consent-standard-form-v4');
    const rendered = copyText('personal_data_collection_use', INSTITUTION);
    expect(rendered.copy).toContain(`${INSTITUTION}은 편집한 v3 문안을 사용합니다.`);
    expect(rendered.copy).not.toContain('사회연대은행은 편집한');
    expect(rendered.copy).toContain('수탁자 사회연대은행');
  });

  it('makes every v3 grant unconfirmed under v4', () => {
    expect(CODE_COPY_VERSION).toBe('consent-standard-form-v4');
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      const event: ConsentEventRow = {
        id: index + 1,
        domain,
        decision: 'grant',
        copy_version: 'consent-standard-form-v3',
        copy_hash: '0'.repeat(64),
        effective_at: '2026-09-18T00:00:00.000Z',
      };
      expect(foldConsent(domain, [event], INSTITUTION)).toBe('unconfirmed');
    }
  });
});
