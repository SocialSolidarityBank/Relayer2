// 동의(P1). 정본: CCC `docs/specs/S7-consent-six-domains.md`(2026-09-03 확정).
// 릴레이어 P1 은 여섯 영역 중 **둘**만 쓴다 — 녹음·STT·LLM·음성 보유기간은 P3·P4 의 몫이다.
// 식별자·문안·copyHash 계산 규칙은 정본 그대로라 영역을 늘려도 해시가 호환된다.
import { createHash } from 'node:crypto';

export const CONSENT_DOMAINS = ['personal_data_collection_use', 'sensitive_information_processing'] as const;
export type ConsentDomain = (typeof CONSENT_DOMAINS)[number];

/** 사건은 셋뿐이다. 정본의 `correct`(감사용 정정)는 쓰지 않는다 — 고칠 일은 새 사건으로 쌓는다. */
export const CONSENT_DECISIONS = ['grant', 'withdraw', 'decline'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

export const COPY_VERSION = 'consent-six-domains-v1';

type DomainCopy = { label: string; copy: string; purpose: string };

/** 문안은 정본 표 그대로다. 한 글자라도 바꾸면 새 `copyVersion` 을 발행한다. */
export const CONSENT_COPY: Record<ConsentDomain, DomainCopy> = {
  personal_data_collection_use: {
    label: '개인정보 수집·이용',
    copy: '개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다.',
    purpose: 'case_management',
  },
  sensitive_information_processing: {
    label: '민감정보 처리',
    copy: '건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다.',
    purpose: 'sensitive_case_management',
  },
};

/**
 * 문안 해시의 원문(정본 §2.1). 릴레이어는 외부 수신자가 없어 provider 세 칸이 `<null>` 이다.
 * NFC 정규화 → 줄바꿈 LF → 줄 끝 공백 제거 → 마지막 LF 하나.
 */
export function canonicalPreimage(domain: ConsentDomain): string {
  const { label, copy, purpose } = CONSENT_COPY[domain];
  const lines = [
    `domain=${domain}`,
    `label=${label}`,
    `copy=${copy}`,
    'provider=<null>',
    'providerLegalRecipient=<null>',
    'providerCountry=<null>',
    `purpose=${purpose}`,
    'retentionDuration=<null>',
  ];
  return `${lines
    .join('\n')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')}\n`;
}

export const copyHash = (domain: ConsentDomain): string =>
  createHash('sha256').update(canonicalPreimage(domain), 'utf8').digest('hex');

export type ConsentEventRow = {
  domain: ConsentDomain;
  decision: ConsentDecision;
  copy_version: string;
  copy_hash: string;
  effective_at: string;
  id: number;
};

export type ConsentStatus = 'granted' | 'not_granted' | 'unconfirmed';

/**
 * 현재 상태는 저장하지 않고 사건을 접어 계산한다(정본 §5).
 * 마지막 사건이 `grant` 이고 **지금 문안 해시와 같을 때만** `granted` 다.
 * 문안이 바뀌면 지난 동의는 자동으로 승격되지 않고 `unconfirmed` 로 떨어진다.
 */
export function foldConsent(domain: ConsentDomain, events: ConsentEventRow[]): ConsentStatus {
  const mine = events.filter((e) => e.domain === domain).sort((a, b) => a.id - b.id);
  const last = mine.at(-1);
  if (!last) return 'unconfirmed';
  if (last.decision !== 'grant') return 'not_granted';
  if (last.copy_version !== COPY_VERSION || last.copy_hash !== copyHash(domain)) return 'unconfirmed';
  return 'granted';
}
