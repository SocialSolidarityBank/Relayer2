// 문안 해시와 현재 상태 접기. DB 없이 돈다.
import { describe, expect, it } from 'vitest';
import {
  activeDomains,
  canonicalPreimage,
  CONSENT_COPY,
  copyHash,
  COPY_VERSION,
  foldConsent,
  type ConsentEventRow,
} from '../src/consent.ts';

const grant = (id: number, hash = copyHash('sensitive_information_processing')): ConsentEventRow => ({
  id,
  domain: 'sensitive_information_processing',
  decision: 'grant',
  copy_version: COPY_VERSION,
  copy_hash: hash,
  effective_at: '2026-09-15T00:00:00.000Z',
});

describe('문안 해시', () => {
  it('소문자 hex 64 자다', () => {
    expect(copyHash('personal_data_collection_use')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('영역이 다르면 해시도 다르다', () => {
    expect(copyHash('personal_data_collection_use')).not.toBe(copyHash('sensitive_information_processing'));
  });

  it('원문은 여덟 줄이고 마지막이 줄바꿈이다', () => {
    const text = canonicalPreimage('personal_data_collection_use');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd().split('\n')).toHaveLength(8);
  });
});

describe('현재 상태 접기', () => {
  it('사건이 없으면 확인 필요다 — 빈 값을 동의로 읽지 않는다', () => {
    expect(foldConsent('sensitive_information_processing', [])).toBe('unconfirmed');
  });

  it('마지막 사건이 동의면 동의함이다', () => {
    expect(foldConsent('sensitive_information_processing', [grant(1)])).toBe('granted');
  });

  it('철회가 뒤에 오면 동의 없음이다', () => {
    const events: ConsentEventRow[] = [grant(1), { ...grant(2), decision: 'withdraw' }];
    expect(foldConsent('sensitive_information_processing', events)).toBe('not_granted');
  });

  it('철회 뒤 다시 동의하면 동의함이다', () => {
    const events: ConsentEventRow[] = [
      grant(1),
      { ...grant(2), decision: 'withdraw' },
      grant(3),
    ];
    expect(foldConsent('sensitive_information_processing', events)).toBe('granted');
  });

  it('문안이 바뀌면 지난 동의가 자동 승격되지 않는다', () => {
    const stale = grant(1, 'f'.repeat(64));
    expect(foldConsent('sensitive_information_processing', [stale])).toBe('unconfirmed');
  });

  it('다른 영역의 동의를 끌어다 쓰지 않는다', () => {
    const other: ConsentEventRow = { ...grant(1), domain: 'personal_data_collection_use' };
    expect(foldConsent('sensitive_information_processing', [other])).toBe('unconfirmed');
  });
});

// 정본은 여섯 영역이다. 셋은 P4(음성)가 쓴다.
// 문안을 한 글자라도 바꾸면 해시가 달라져 기존 동의가 `확인 필요`로 떨어진다.
describe('음성 세 영역', () => {
  it('정본 문안 그대로다', () => {
    expect(CONSENT_COPY.counseling_recording.copy).toBe('상담 내용을 녹음하여 상담 기록 작성에 이용합니다.');
    expect(CONSENT_COPY.external_stt_processing.copy).toBe(
      '녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다.',
    );
    expect(CONSENT_COPY.voice_original_retention_period.copy).toBe(
      '상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다.',
    );
  });

  it('보유기간이 해시에 묶인다', () => {
    // 음성 보유기간은 "얼마나 갖고 있는가"가 동의의 내용이다. 기간이 바뀌면 다시 받아야 한다.
    expect(canonicalPreimage('voice_original_retention_period')).toContain(
      'retentionDuration=default_temporary_d85',
    );
    expect(canonicalPreimage('personal_data_collection_use')).toContain('retentionDuration=<null>');
  });

  it('외부 STT 수신자는 정본이 못박은 azure 다', () => {
    // 다른 곳으로 음성을 보내려면 정본을 먼저 고쳐야 한다. 코드가 마음대로 바꾸지 않는다.
    expect(CONSENT_COPY.external_stt_processing.provider?.id).toBe('azure');
    expect(canonicalPreimage('external_stt_processing')).toContain('purpose=speech_to_text');
  });

  it('기능이 꺼져 있으면 목록에 두지 않는다', () => {
    // 받을 이유가 없는 동의를 화면에 띄우지 않는다. 저장된 옛 사건은 그대로 남는다.
    delete process.env.AZURE_SPEECH_KEY;
    expect(activeDomains()).not.toContain('external_stt_processing');
    expect(activeDomains()).toContain('external_llm_cross_border_processing');
  });
});
