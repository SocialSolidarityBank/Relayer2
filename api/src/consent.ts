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
  'document_attachment',
] as const;
export type ConsentDomain = (typeof CONSENT_DOMAINS)[number];

/** 사건은 셋뿐이다. 정본의 `correct`(감사용 정정)는 쓰지 않는다 — 고칠 일은 새 사건으로 쌓는다. */
export const CONSENT_DECISIONS = ['grant', 'withdraw', 'decline'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/**
 * 문안 판. **v2 는 표준 양식 항목을 채운 판이다**(2026-09-16 Q) — 수집 항목·보유기간·
 * 거부 권리를 한 줄 설명 밖에 두지 않고 문안 안에 넣었다. 개인정보보호법이 고지하라는 것들이다.
 *
 * 판이 바뀌면 이미 받은 동의는 전부 `확인 필요`로 떨어진다. 설계대로다 —
 * **문안이 바뀌면 그 문안에 동의한 적 없는 사람이 된다.**
 */
export const COPY_VERSION = 'consent-standard-form-v2';

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

/**
 * 보유기간 문구.
 *
 * 정본(CCC S7)은 `default_temporary_d85`(85일) 하나만 둔다. 릴레이어는 **1년 하나로 통일**한다
 * (2026-09-16 Q 확정) — 음성·기록·문서가 서로 다른 기한을 가지면 무엇이 언제 지워지는지
 * 아무도 설명하지 못한다. 하나로 묶어야 당사자에게 한 문장으로 말할 수 있다.
 *
 * **정본에서 벗어나는 값이다.** 값 이름도 기간을 그대로 담아 오해를 없앤다.
 */
export const RETENTION_DURATIONS = ['institution_retention_1y'] as const;
export type RetentionDuration = (typeof RETENTION_DURATIONS)[number];

/** 보유기간을 날 수로. 한 자리에서만 센다. */
export const RETENTION_DAYS: Record<RetentionDuration, number> = { institution_retention_1y: 365 };

type DomainCopy = {
  label: string;
  copy: string;
  purpose: string;
  /** 무엇을 다루는가. 개인정보보호법이 고지하라는 첫째다. */
  items: string[];
  /** 왜 다루는가 — 사람 말로. `purpose` 는 코드용 열쇠다. */
  purposeText: string;
  /** 얼마나 두는가. */
  retentionText: string;
  /** 거부할 수 있는가, 거부하면 무엇이 달라지는가. 이것을 빼면 동의가 아니라 통보다. */
  refusalText: string;
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
    items: ['이름', '연락처', '이메일', '생년월일', '주소', '상담 신청 내용'],
    purposeText: '상담과 사례관리를 제공하고 그 기록을 관리하기 위해서예요.',
    retentionText: '상담 종결 뒤 1년까지 보관하고 그 뒤에 지워요.',
    refusalText: '동의하지 않을 수 있어요. 다만 이 정보가 없으면 상담 신청을 받을 수 없어요.',
  },
  sensitive_information_processing: {
    label: '민감정보 처리',
    copy: '건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다.',
    purpose: 'sensitive_case_management',
    items: ['건강·질병', '채무·연체', '주거 상황', '가족 관계', '그 밖에 상담에서 말씀하신 사정'],
    purposeText: '어떤 도움이 필요한지 판단하고 알맞은 지원으로 이어 주기 위해서예요.',
    retentionText: '상담 종결 뒤 1년까지 보관하고 그 뒤에 지워요.',
    refusalText:
      '동의하지 않을 수 있어요. 다만 이 내용을 적을 수 없으면 상담 기록에 사정을 남기지 못해, 다음 상담에서 처음부터 다시 말씀하셔야 해요.',
  },
  counseling_recording: {
    label: '상담 녹음',
    copy: '상담 내용을 녹음하여 상담 기록 작성에 이용합니다.',
    purpose: 'counseling_recording',
    items: ['상담 중 음성'],
    purposeText: '상담을 들으며 받아 적지 않아도 되도록, 기록을 나중에 정확히 쓰기 위해서예요.',
    retentionText: '기관 안에만 두고 1년 뒤에 지워요.',
    refusalText: '동의하지 않을 수 있어요. 녹음하지 않고 손으로 적어요. 상담은 그대로 받으실 수 있어요.',
    // 녹음 자체는 기관 안에서 한다. 밖으로 보내는 것은 외부 STT 영역이 따로 받는다.
    provider: { id: 'institution_recording', legalRecipient: '사회연대은행', country: 'KR' },
  },
  external_stt_processing: {
    label: '외부 STT 처리',
    copy: '녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다.',
    purpose: 'speech_to_text',
    items: ['상담 중 음성'],
    purposeText: '녹음을 글로 옮겨 기록 작성을 돕기 위해서예요.',
    retentionText: '보낸 음성은 전사가 끝나면 제공자 쪽에 남기지 않도록 요청해요. 기관 안 원본은 1년 뒤 지워요.',
    refusalText: '동의하지 않을 수 있어요. 녹음은 기관 안에만 두고 글로 옮기는 일은 하지 않아요.',
    provider: STT_PROVIDERS[(process.env.STT_PROVIDER as SttProviderId) ?? 'azure'],
  },
  external_llm_cross_border_processing: {
    label: '외부 LLM·국외 처리',
    copy: '가림 처리한 상담 자료를 외부 LLM에 보내 요약·정리하며 국외에서 처리될 수 있습니다.',
    purpose: 'ai_briefing',
    items: ['이름·연락처·주민등록번호 등을 가린 상담 기록 글'],
    purposeText: '상담 기록을 요약해 다음 상담을 준비하기 위해서예요.',
    retentionText: '보낸 자료를 제공자 쪽 학습에 쓰지 않도록 요청하고, 기관 안 기록은 1년 뒤 지워요.',
    refusalText: '동의하지 않을 수 있어요. 요약을 사람이 직접 쓰고, 상담은 그대로 받으실 수 있어요.',
    // 수신자는 기관이 고른 제공자다. **바뀌면 문안 해시가 달라지고 기존 동의는 `확인 필요`로 떨어진다** —
    // 누구에게 보내는지가 동의의 본체이기 때문이다(정본 §2.1).
    provider: AI_PROVIDERS[(process.env.AI_PROVIDER as AiProviderId) ?? 'openai'],
  },
  voice_original_retention_period: {
    label: '음성 원본 보유기간',
    copy: '상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다.',
    purpose: 'voice_original_retention',
    items: ['상담 음성 원본 파일'],
    purposeText: '기록에 빠진 것이 있을 때 다시 들어 확인하기 위해서예요.',
    retentionText: '1년 동안 기관 안에만 두고, 그날이 지나면 지워요.',
    refusalText: '동의하지 않을 수 있어요. 글로 옮긴 뒤 음성 원본을 바로 지워요.',
    provider: { id: 'institution_private_storage', legalRecipient: '사회연대은행', country: 'KR' },
    retentionDuration: 'institution_retention_1y',
  },
  // 정본 여섯 영역 밖이다(2026-09-16 Q 확정). 서면·파일로 받은 문서에는
  // 채무 내역서·진단서처럼 민감정보가 그대로 들어 있어, 민감정보 처리 동의로 덮지 않고 따로 받는다.
  // 받은 문서는 기관 디스크에만 두고 밖으로 보내지 않는다.
  document_attachment: {
    label: '서면 문서 보관',
    copy: '상담 중 받은 서면·파일 문서를 기관 안에 보관하며, 고지한 보유기간이 지나면 삭제합니다.',
    purpose: 'document_retention',
    items: ['상담 중 주신 서류와 파일(예: 채무 내역서, 진단서, 임대차 계약서)'],
    purposeText: '말씀하신 사정을 서류로 확인하고 지원 신청에 쓰기 위해서예요.',
    retentionText: '기관 안에만 두고 1년 뒤에 지워요. 누가 열어 봤는지 기록에 남아요.',
    refusalText: '동의하지 않을 수 있어요. 서류는 보관하지 않고 확인만 한 뒤 돌려드려요.',
    provider: { id: 'institution_private_storage', legalRecipient: '사회연대은행', country: 'KR' },
    retentionDuration: 'institution_retention_1y',
  },
};

/**
 * 문안 해시의 원문(정본 §2.1). 외부 수신자가 없는 영역은 provider 세 칸이 `<null>` 이고,
 * 외부 LLM 처럼 수신자가 있으면 그 스냅샷이 해시에 함께 묶인다 — 수신자가 바뀌면 동의도 다시 받는다.
 * NFC 정규화 → 줄바꿈 LF → 줄 끝 공백 제거 → 마지막 LF 하나.
 */
export function canonicalPreimage(domain: ConsentDomain): string {
  const { label, copy, purpose, provider, retentionDuration, items, purposeText, retentionText, refusalText } =
    CONSENT_COPY[domain];
  const lines = [
    `domain=${domain}`,
    `label=${label}`,
    `copy=${copy}`,
    // 표준 양식 항목도 문안이다(2026-09-16 Q). 무엇을 받고 얼마나 두고 거부하면 어떻게 되는지가
    // 바뀌면 그것은 다른 동의다 — 해시에 넣어야 바뀐 사실이 드러난다.
    `items=${items.join('|')}`,
    `purposeText=${purposeText}`,
    `retentionText=${retentionText}`,
    `refusalText=${refusalText}`,
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
 * 저장된 옛 사건은 기능이 꺼져도 그대로 남는다 — 목록에서 감출 뿐 지우지 않는다.
 */
const VOICE_DOMAINS: ReadonlySet<string> = new Set([
  'counseling_recording',
  'external_stt_processing',
  'voice_original_retention_period',
]);

/**
 * 음성 경로를 여는 스위치. **녹음과 전사는 다른 일이다.**
 * 녹음은 디스크만 있으면 되고, 전사는 외부 제공자 키가 따로 필요하다.
 * 그래서 키가 아니라 기관이 켜는 플래그로 연다 — 키가 생겼다고 녹음이 시작되면 안 된다.
 */
export const voiceEnabled = (): boolean => process.env.VOICE_ENABLED === '1';

/** 전사까지 되는가. 키와 엔드포인트(직접 또는 지역)를 모두 설정해야 한다. */
export const sttEnabled = (): boolean =>
  voiceEnabled() &&
  Boolean(process.env.AZURE_SPEECH_KEY?.trim()) &&
  Boolean(
    process.env.AZURE_SPEECH_ENDPOINT?.trim() || process.env.AZURE_SPEECH_REGION?.trim(),
  );

export const activeDomains = (): readonly ConsentDomain[] =>
  voiceEnabled() ? CONSENT_DOMAINS : CONSENT_DOMAINS.filter((d) => !VOICE_DOMAINS.has(d));

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
