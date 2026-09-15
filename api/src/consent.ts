// 동의(P1·P4). 정본: CCC `docs/specs/S7-consent-six-domains.md`(2026-09-03 확정).
// 여섯 영역을 전부 쓴다. P1 이 둘(개인정보·민감정보), P3 이 외부 LLM,
// P4 가 나머지 셋(상담 녹음·외부 STT·음성 원본 보유기간)이다.
// 식별자·문안·copyHash 계산 규칙은 정본 그대로다.
import { createHash } from 'node:crypto';

export const CONSENT_DOMAINS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'counseling_recording',
  'external_stt_processing',
  'external_llm_cross_border_processing',
  'voice_original_retention_period',
] as const;
export type ConsentDomain = (typeof CONSENT_DOMAINS)[number];

/** 사건은 셋뿐이다. 정본의 `correct`(감사용 정정)는 쓰지 않는다 — 고칠 일은 새 사건으로 쌓는다. */
export const CONSENT_DECISIONS = ['grant', 'withdraw', 'decline'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

export const COPY_VERSION = 'consent-six-domains-v1';

/** 승인된 LLM 제공자. 여기 없는 곳으로는 보내지 않는다. */
export const AI_PROVIDERS = {
  openai: { id: 'openai', legalRecipient: 'OpenAI, L.L.C.', country: 'US' },
  gemini: { id: 'gemini', legalRecipient: 'Google LLC', country: 'US' },
} as const;
export type AiProviderId = keyof typeof AI_PROVIDERS;

/**
 * 승인된 STT 제공자. 정본은 외부 STT 의 provider 를 **정확히 `azure`** 로 못박는다(§매트릭스).
 * 다른 곳으로 음성을 보내려면 정본을 먼저 고쳐야 한다.
 */
export const STT_PROVIDERS = {
  azure: { id: 'azure', legalRecipient: 'Microsoft Corporation', country: 'US' },
} as const;
export type SttProviderId = keyof typeof STT_PROVIDERS;

/** 보유기간 문구. 정본이 허용하는 값은 지금 하나뿐이다. */
export const RETENTION_DURATIONS = ['default_temporary_d85'] as const;
export type RetentionDuration = (typeof RETENTION_DURATIONS)[number];

type DomainCopy = {
  label: string;
  copy: string;
  purpose: string;
  /** 외부 수신자가 있는 영역만 채운다. 해시 원문에 그대로 들어간다(정본 §2.1). */
  provider?: { id: string; legalRecipient: string; country: string };
  /** 보유기간을 고지하는 영역만 채운다. 이것도 해시에 묶인다. */
  retentionDuration?: RetentionDuration;
};

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
  counseling_recording: {
    label: '상담 녹음',
    copy: '상담 내용을 녹음하여 상담 기록 작성에 이용합니다.',
    purpose: 'counseling_recording',
    // 녹음 자체는 기관 안에서 한다. 밖으로 보내는 것은 외부 STT 영역이 따로 받는다.
    provider: { id: 'institution_recording', legalRecipient: '사회연대은행', country: 'KR' },
  },
  external_stt_processing: {
    label: '외부 STT 처리',
    copy: '녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다.',
    purpose: 'speech_to_text',
    provider: STT_PROVIDERS[(process.env.STT_PROVIDER as SttProviderId) ?? 'azure'],
  },
  external_llm_cross_border_processing: {
    label: '외부 LLM·국외 처리',
    copy: '가림 처리한 상담 자료를 외부 LLM에 보내 요약·정리하며 국외에서 처리될 수 있습니다.',
    purpose: 'ai_briefing',
    // 수신자는 기관이 고른 제공자다. **바뀌면 문안 해시가 달라지고 기존 동의는 `확인 필요`로 떨어진다** —
    // 누구에게 보내는지가 동의의 본체이기 때문이다(정본 §2.1).
    provider: AI_PROVIDERS[(process.env.AI_PROVIDER as AiProviderId) ?? 'openai'],
  },
  voice_original_retention_period: {
    label: '음성 원본 보유기간',
    copy: '상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다.',
    purpose: 'voice_original_retention',
    provider: { id: 'institution_private_storage', legalRecipient: '사회연대은행', country: 'KR' },
    retentionDuration: 'default_temporary_d85',
  },
};

/**
 * 문안 해시의 원문(정본 §2.1). 외부 수신자가 없는 영역은 provider 세 칸이 `<null>` 이고,
 * 외부 LLM 처럼 수신자가 있으면 그 스냅샷이 해시에 함께 묶인다 — 수신자가 바뀌면 동의도 다시 받는다.
 * NFC 정규화 → 줄바꿈 LF → 줄 끝 공백 제거 → 마지막 LF 하나.
 */
export function canonicalPreimage(domain: ConsentDomain): string {
  const { label, copy, purpose, provider, retentionDuration } = CONSENT_COPY[domain];
  const lines = [
    `domain=${domain}`,
    `label=${label}`,
    `copy=${copy}`,
    `provider=${provider?.id ?? '<null>'}`,
    `providerLegalRecipient=${provider?.legalRecipient ?? '<null>'}`,
    `providerCountry=${provider?.country ?? '<null>'}`,
    `purpose=${purpose}`,
    `retentionDuration=${retentionDuration ?? '<null>'}`,
  ];
  return `${lines
    .join('\n')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')}\n`;
}

/**
 * 화면에 보이는 동의 영역. **기능이 없으면 동의를 받을 이유가 없다.**
 * 녹음·STT·음성 보유기간 셋은 STT 가 붙어야 의미가 있고, 그 전에는 목록에 두지 않는다.
 * 서버는 여섯 영역을 전부 알고 있다 — 저장된 옛 사건은 기능이 꺼져도 그대로 남는다.
 */
const VOICE_DOMAINS: ReadonlySet<string> = new Set([
  'counseling_recording',
  'external_stt_processing',
  'voice_original_retention_period',
]);

export const sttEnabled = (): boolean => Boolean(process.env.AZURE_SPEECH_KEY);

export const activeDomains = (): readonly ConsentDomain[] =>
  sttEnabled() ? CONSENT_DOMAINS : CONSENT_DOMAINS.filter((d) => !VOICE_DOMAINS.has(d));

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
