// 문안 해시와 현재 상태 접기. DB 없이 돈다.
import { describe, expect, it } from 'vitest';
import {
  canonicalPreimage,
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
