// 음성 경로의 경계. DB 없이 도는 것만 본다 — 실제 저장·삭제는 통합에서 확인했다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeDomains,
  canonicalPreimage,
  CONSENT_COPY,
  copyHash,
  sttEnabled,
  voiceEnabled,
} from '../src/consent.ts';

beforeEach(() => {
  for (const name of ['VOICE_ENABLED', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_ENDPOINT', 'AZURE_SPEECH_REGION'])
    vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('음성 스위치', () => {
  it('꺼져 있으면 음성 세 영역이 목록에 없다', () => {
    // 받을 이유가 없는 동의를 화면에 띄우지 않는다.
    expect(voiceEnabled()).toBe(false);
    const shown = activeDomains();
    expect(shown).not.toContain('counseling_recording');
    expect(shown).not.toContain('external_stt_processing');
    expect(shown).not.toContain('voice_original_retention_period');
    expect(shown).toContain('personal_data_collection_use');
  });

  it('녹음을 켜도 키가 없으면 전사만 막힌다', () => {
    // 녹음은 디스크만 있으면 되고 전사는 외부 제공자가 필요하다. 다른 일이다.
    process.env.VOICE_ENABLED = '1';
    expect(voiceEnabled()).toBe(true);
    expect(sttEnabled()).toBe(false);
    expect(activeDomains()).toContain('counseling_recording');
  });

  it('키만 있고 엔드포인트나 지역이 없으면 준비되지 않는다', () => {
    process.env.VOICE_ENABLED = '1';
    process.env.AZURE_SPEECH_KEY = 'x';
    expect(sttEnabled()).toBe(false);

    process.env.AZURE_SPEECH_REGION = 'koreacentral';
    expect(sttEnabled()).toBe(true);

    delete process.env.AZURE_SPEECH_REGION;
    process.env.AZURE_SPEECH_ENDPOINT = 'https://speech.example.test';
    expect(sttEnabled()).toBe(true);
  });

  it('키가 생겼다고 녹음이 열리지 않는다', () => {
    // 기관이 켜야 열린다. 키의 존재가 결정하지 않는다.
    process.env.AZURE_SPEECH_KEY = 'x';
    expect(voiceEnabled()).toBe(false);
    expect(sttEnabled()).toBe(false);
  });
});

describe('음성 동의 문안', () => {
  it('보유기간이 해시에 묶인다', () => {
    // "얼마나 갖고 있는가"가 동의의 내용이다. 기간이 바뀌면 다시 받아야 한다.
    const before = copyHash('voice_original_retention_period');
    expect(canonicalPreimage('voice_original_retention_period')).toContain(
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
    ].map((d) => copyHash(d as Parameters<typeof copyHash>[0]));
    expect(new Set(hashes).size).toBe(7);
  });
});
