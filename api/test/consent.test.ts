// 문안 해시와 현재 상태 접기. DB 없이 돈다.
import { describe, expect, it } from 'vitest';
import {
  canonicalPreimage,
  CONSENT_COPY,
  copyHash,
  copyVersion,
  foldConsent,
  type ConsentEventRow,
} from '../src/consent.ts';

const grant = (id: number, hash = copyHash('sensitive_information_processing')): ConsentEventRow => ({
  id,
  domain: 'sensitive_information_processing',
  decision: 'grant',
  copy_version: copyVersion(),
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

  it('원문에 표준 양식 항목이 전부 들어가고 마지막이 줄바꿈이다', () => {
    // 무엇을 받고·왜·얼마나 두고·거부하면 어떻게 되는지가 바뀌면 그것은 다른 동의다.
    const text = canonicalPreimage('personal_data_collection_use');
    expect(text.endsWith('\n')).toBe(true);
    for (const key of ['domain=', 'label=', 'copy=', 'items=', 'purposeText=', 'retentionText=', 'refusalText=', 'provider=', 'purpose=', 'retentionDuration=']) {
      expect(text).toContain(key);
    }
  });

  it('표준 양식 항목이 바뀌면 해시가 바뀐다', () => {
    // 이 계약이 깨지면 문안을 조용히 고칠 수 있게 된다.
    const before = copyHash('personal_data_collection_use');
    const copy = CONSENT_COPY.personal_data_collection_use;
    const kept = copy.refusalText;
    copy.refusalText = '아무 불이익이 없습니다.';
    expect(copyHash('personal_data_collection_use')).not.toBe(before);
    copy.refusalText = kept;
    expect(copyHash('personal_data_collection_use')).toBe(before);
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
describe('음성 세 영역', () => {
  it('보유기간이 해시에 묶인다', () => {
    // 음성 보유기간은 "얼마나 갖고 있는가"가 동의의 내용이다. 기간이 바뀌면 다시 받아야 한다.
    expect(canonicalPreimage('voice_original_retention_period')).toContain(
      'retentionDuration=institution_retention_30d',
    );
    expect(canonicalPreimage('personal_data_collection_use')).toContain('retentionDuration=<null>');
  });

  it('외부 STT 수신자는 정본이 못박은 azure 다', () => {
    // 다른 곳으로 음성을 보내려면 정본을 먼저 고쳐야 한다. 코드가 마음대로 바꾸지 않는다.
    expect(CONSENT_COPY.external_stt_processing.provider?.id).toBe('azure');
    expect(canonicalPreimage('external_stt_processing')).toContain('purpose=speech_to_text');
  });
});
