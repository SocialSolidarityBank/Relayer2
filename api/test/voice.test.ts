// 음성 동의 문안의 순수 경계. DB 우선 비동기 게이트는 voice-toggle.integration.test.ts가 검증한다.
import { describe, expect, it } from 'vitest';
import { canonicalPreimage, CONSENT_COPY, copyHash } from '../src/consent.ts';

const INSTITUTION = '푸른은행';

describe('음성 동의 문안', () => {
  it('보유기간이 해시에 묶인다', () => {
    // "얼마나 갖고 있는가"가 동의의 내용이다. 기간이 바뀌면 다시 받아야 한다.
    const before = copyHash('voice_original_retention_period', INSTITUTION);
    expect(canonicalPreimage('voice_original_retention_period', INSTITUTION)).toContain(
      'retentionDuration=institution_retention_30d',
    );
    expect(before).toMatch(/^[0-9a-f]{64}$/);
  });

  it('녹음은 기관 안, 전사는 밖이다', () => {
    // 두 영역의 수신자가 다르다. 그래서 동의도 따로 받는다.
    expect(CONSENT_COPY.counseling_recording.provider?.country).toBe('KR');
    expect(CONSENT_COPY.external_stt_processing.provider?.country).toBe('US');
    expect(CONSENT_COPY.external_stt_processing.provider?.id).toBe('azure');
  });

  it('영역마다 해시가 서로 다르다', () => {
    // 한 영역의 동의가 다른 영역을 대신하지 않는다(정본 §5).
    // 일곱째 `document_attachment` 는 정본 밖이다(2026-09-16 Q).
    const hashes = [
      'personal_data_collection_use',
      'sensitive_information_processing',
      'counseling_recording',
      'external_stt_processing',
      'external_llm_cross_border_processing',
      'voice_original_retention_period',
      'document_attachment',
    ].map((domain) => copyHash(domain as Parameters<typeof copyHash>[0], INSTITUTION));
    expect(new Set(hashes).size).toBe(7);
  });
});
