// 동의(P1·P4). 정본: CCC `docs/specs/S7-consent-six-domains.md`(2026-09-03 확정).
// 여섯 영역을 전부 쓴다. P1 이 둘(개인정보·민감정보), P3 이 외부 LLM,
// P4 가 나머지 셋(상담 녹음·외부 STT·음성 원본 보유기간)이다.
// 식별자·문안·copyHash 계산 규칙은 정본 그대로다.
import { createHash } from 'node:crypto';
import { sql } from './db.ts';
import { decryptPii } from './pii.ts';

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
 * 문안 판. v4 는 처리자를 현재 `organization.name` 으로 치환하고, 수탁자
 * 사회연대은행과 고정 처리 리전 koreacentral 을 문안·해시에 함께 묶는다.
 *
 * 코드 판은 DB 편집본의 바닥값이다. v3 편집본이 있어도 문안 자체는 보존하되
 * 기관명 치환을 마지막에 적용하고 전역 판은 v4 로 올린다.
 */
export const CODE_COPY_VERSION = 'consent-standard-form-v4';

/** 관리자가 고칠 수 있는 칸. 나머지(label·purpose·provider·retentionDuration)는 코드 정본이다. */
export type EditableCopy = {
  copy: string;
  items: string[];
  purposeText: string;
  retentionText: string;
  refusalText: string;
};

let live: { version: string; text: Partial<Record<ConsentDomain, EditableCopy>> } = {
  version: CODE_COPY_VERSION,
  text: {},
};

const versionNumber = (version: string): number => Number(/-v(\d+)$/.exec(version)?.[1] ?? 0);

/** DB 편집본을 앉히되 코드가 올린 전역 판을 과거 DB 판이 되돌리지 못하게 한다. */
export function setLiveCopy(version: string, text: Partial<Record<ConsentDomain, EditableCopy>>): void {
  live = {
    version: versionNumber(version) > versionNumber(CODE_COPY_VERSION) ? version : CODE_COPY_VERSION,
    text,
  };
}

export const copyVersion = (): string => live.version;

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
 * 정본(CCC S7)은 `default_temporary_d85`(85일) 하나만 둔다. 릴레이어는 **파일 30일** 하나를 쓴다
 * (2026-09-18 Q 확정) — 음성 원본·서면 문서는 크기가 커 저장소를 먹으므로 짧게 둔다.
 * 글(개인정보·민감정보·기록·전사문·요약)은 상담 종결 후 1년이며 문안 본문이 말한다 —
 * 파기는 사례 종결에 매여 있어 파일처럼 저장일 기준 날 수로 세지 않는다.
 *
 * **정본에서 벗어나는 값이다.** 값 이름도 기간을 그대로 담아 오해를 없앤다.
 */
export const RETENTION_DURATIONS = ['institution_retention_30d'] as const;
export type RetentionDuration = (typeof RETENTION_DURATIONS)[number];

/** 보유기간을 날 수로. 한 자리에서만 센다. */
export const RETENTION_DAYS: Record<RetentionDuration, number> = { institution_retention_30d: 30 };

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
    purpose: 'case_management',
    copy:
      '사회연대은행은 「개인정보 보호법」 제15조제1항제1호에 따라 상담과 사례관리를 제공하고 그 기록을 관리하기 위하여 다음과 같이 개인정보를 수집·이용하고자 하오니, 내용을 충분히 읽으신 뒤 동의 여부를 결정하여 주시기 바랍니다. 수집·이용 목적은 상담 신청 접수, 상담과 사례관리 제공, 상담 기록의 작성·관리, 상담 일정 안내와 연락입니다. 수집·이용하는 항목은 이름, 연락처, 이메일, 생년월일, 주소, 상담 신청 내용입니다. 수집한 개인정보는 상담 종결 후 1년까지 보유·이용하며, 그 기간이 지나면 지체 없이 파기합니다. 이 개인정보는 사회연대은행(대한민국) 안에서만 처리하며, 이 동의만으로 외부에 제공하거나 국외로 보내지 않습니다. 위의 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다. 그러나 위 항목은 상담 신청을 접수하기 위하여 반드시 필요한 최소한의 정보이므로, 동의를 거부할 경우 상담 신청을 접수할 수 없습니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 개인정보를 더 이용하지 않으며, 이미 저장한 기록은 위 보유기간에 따라 파기합니다.',
    items: ['이름', '연락처', '이메일', '생년월일', '주소', '상담 신청 내용'],
    purposeText: '상담 신청을 접수하고 상담과 사례관리를 제공하며, 그 기록을 작성·관리하고 상담 일정을 안내하기 위하여 이용합니다.',
    retentionText: '상담 종결 후 1년까지 보관하고, 그 기간이 지나면 지체 없이 파기합니다.',
    refusalText: '위의 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다. 그러나 상담 신청에 반드시 필요한 최소한의 정보이므로, 동의를 거부할 경우 상담 신청을 접수할 수 없습니다.',
  },
  sensitive_information_processing: {
    label: '민감정보 처리',
    purpose: 'sensitive_case_management',
    copy:
      '사회연대은행은 「개인정보 보호법」 제23조에 따라 다음과 같이 민감정보를 처리하고자 하오니, 일반 개인정보와 별도로 동의 여부를 결정하여 주시기 바랍니다. 상담 과정에서 말씀하시는 내용에는 건강·질병, 채무·연체, 주거 상황, 가족 관계 등 사생활을 현저히 침해할 우려가 있어 특히 신중하게 다루어야 하는 정보가 포함될 수 있습니다. 처리 목적은 어떤 도움이 필요한지 판단하고, 알맞은 지원으로 연결하며, 이를 상담 기록에 남겨 다음 상담에서 이어 가기 위한 것이며, 이 목적에 필요한 범위에서만 처리합니다. 처리하는 항목은 건강·질병, 채무·연체, 주거 상황, 가족 관계, 그 밖에 상담에서 말씀하신 사정입니다. 민감정보는 상담 종결 후 1년까지 보유·이용하며, 그 기간이 지나면 지체 없이 파기합니다. 이 정보는 사회연대은행(대한민국) 안에서만 처리하며, 이 동의만으로 외부에 제공하거나 국외로 보내지 않습니다. 외부 인공지능에 보내는 경우가 있더라도 이름·연락처·주민등록번호 등 식별정보를 마스킹한 뒤 별도의 동의를 받아 진행합니다. 위의 민감정보 처리에 대한 동의를 거부할 권리가 있으며, 동의를 거부하셔도 상담은 그대로 받으실 수 있습니다. 그러나 동의를 거부할 경우 위 사정을 상담 기록에 남길 수 없어, 다음 상담에서 처음부터 다시 말씀하셔야 할 수 있습니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 민감정보를 더 기록하지 않으며, 이미 저장한 기록은 위 보유기간에 따라 파기합니다.',
    items: ['건강·질병', '채무·연체', '주거 상황', '가족 관계', '그 밖에 상담에서 말씀하신 사정'],
    purposeText: '어떤 도움이 필요한지 판단하고 알맞은 지원으로 연결하며, 이를 상담 기록에 남겨 다음 상담에서 이어 가기 위하여 처리합니다.',
    retentionText: '상담 종결 후 1년까지 보관하고, 그 기간이 지나면 지체 없이 파기합니다.',
    refusalText: '위의 민감정보 처리에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 그러나 동의를 거부할 경우 이 내용을 상담 기록에 남길 수 없어, 다음 상담에서 처음부터 다시 말씀하셔야 할 수 있습니다.',
  },
  counseling_recording: {
    label: '상담 녹음',
    purpose: 'counseling_recording',
    copy:
      '사회연대은행은 「개인정보 보호법」 제15조제1항제1호에 따라 상담 내용을 녹음하고자 하오니, 동의 여부를 결정하여 주시기 바랍니다. 녹음 목적은 실무자가 상담 중에 받아 적는 대신 상담에 집중하고, 상담이 끝난 뒤 녹음을 들으며 상담 기록을 정확하게 작성하기 위한 것입니다. 수집하는 항목은 상담 중 음성(녹음 파일)입니다. 녹음 파일은 사회연대은행(대한민국) 서버 안에만 저장하며, 저장일부터 30일까지 보관한 뒤 지체 없이 파기합니다. 녹음 파일은 이 동의만으로 외부에 제공하거나 국외로 보내지 않으며, 외부 음성인식(STT) 제공자에게 보내 글로 옮기는 처리는 별도의 동의를 받아야만 진행합니다. 녹음을 바탕으로 작성한 상담 기록(글)은 상담 종결 후 1년까지 보관합니다. 위의 상담 녹음에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 녹음하지 않고 실무자가 직접 기록합니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 녹음하지 않으며, 해당 사례의 음성 원본 파일은 즉시 삭제합니다. 이미 작성한 상담 기록(글)은 남으며 위 보유기간에 따라 파기합니다.',
    items: ['상담 중 음성(녹음 파일)'],
    purposeText: '실무자가 상담 중에 받아 적지 않고 상담에 집중하며, 상담 뒤 녹음을 들으며 기록을 정확하게 작성하기 위하여 녹음합니다.',
    retentionText: '사회연대은행 서버 안에만 두고 저장일부터 30일까지 보관한 뒤 파기합니다. 녹음으로 작성한 상담 기록(글)은 상담 종결 후 1년까지 보관합니다.',
    refusalText: '위의 상담 녹음에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 녹음하지 않고 실무자가 직접 기록합니다.',
    // 녹음 자체는 기관 안에서 한다. 밖으로 보내는 것은 외부 STT 영역이 따로 받는다.
    provider: { id: 'institution_recording', legalRecipient: '사회연대은행', country: 'KR' },
  },
  external_stt_processing: {
    label: '외부 STT 처리',
    purpose: 'speech_to_text',
    copy:
      '사회연대은행은 「개인정보 보호법」 제26조 및 제28조의8에 따라 상담 녹음 파일을 외부 음성인식(STT) 제공자에게 보내 글로 옮기는 처리를 위탁하고자 하오니, 동의 여부를 결정하여 주시기 바랍니다. 개인정보를 이전받는 자는 Microsoft Corporation(미국 법인, 개인정보 문의: privacy.microsoft.com)이며, Azure Speech(Fast transcription) 서비스를 이용합니다. 음성은 Azure 한국 중부(Korea Central) 리전에서 처리되며 그 리전 밖에 저장하거나 처리하지 않습니다. 이전하는 항목은 상담 중 음성(녹음 파일)이고, 이전 목적은 녹음 음성을 글로 옮겨 상담 기록 작성을 돕기 위한 것입니다. 이전 시기와 방법은 녹음 파일이 저장된 직후 자동으로 암호화된 통신(TLS)을 통해 전송하는 방식입니다. Microsoft Corporation은 글로 옮기는 처리가 끝나면 음성을 보관하지 않으며, 보낸 음성을 인공지능 학습에 사용하지 않습니다. 사회연대은행 안의 녹음 원본은 저장일부터 30일까지 보관한 뒤 파기하고, 글로 옮긴 전사문은 이름·연락처·주민등록번호 등 식별정보를 마스킹한 뒤 실무자가 확인하여야 상담 기록이 되며, 상담 기록으로서 상담 종결 후 1년까지 보관합니다. 위의 외부 처리에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 녹음 파일은 사회연대은행 안에만 두고 외부로 보내지 않으며, 글로 옮기는 처리는 하지 않고 실무자가 직접 기록합니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 녹음 파일을 외부로 보내지 않으며, 이미 작성된 전사문은 위 보유기간에 따라 파기합니다.',
    items: ['상담 중 음성(녹음 파일)'],
    purposeText: '녹음 음성을 글로 옮겨 상담 기록 작성을 돕기 위하여 Microsoft Corporation의 Azure Speech(한국 중부 리전)에 전송합니다. 전송은 녹음 저장 직후 자동으로 암호화된 통신(TLS)으로 이루어집니다.',
    retentionText: 'Microsoft Corporation은 글로 옮기는 처리가 끝나면 음성을 보관하지 않고 학습에도 사용하지 않습니다. 사회연대은행 안의 녹음 원본은 저장일부터 30일, 전사문은 상담 기록으로서 상담 종결 후 1년까지 보관한 뒤 파기합니다.',
    refusalText: '위의 외부 처리에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 녹음은 사회연대은행 안에만 두고 외부로 보내지 않으며, 글로 옮기는 처리는 하지 않습니다.',
    // 수신자 스냅샷은 법인 국적이다. 처리 리전(koreacentral)은 문안 본문이 말한다 — 리전이 바뀌면 문안도 바뀐다.
    provider: STT_PROVIDERS[(process.env.STT_PROVIDER as SttProviderId) ?? 'azure'],
  },
  external_llm_cross_border_processing: {
    label: '외부 LLM·국외 처리',
    purpose: 'ai_briefing',
    copy:
      '사회연대은행은 「개인정보 보호법」 제26조 및 제28조의8에 따라 상담 기록을 국외의 외부 인공지능(LLM) 제공자에게 보내 요약·정리하는 처리를 위탁하고자 하오니, 동의 여부를 결정하여 주시기 바랍니다. 개인정보를 이전받는 자는 OpenAI, L.L.C.(미국, 개인정보 문의: privacy.openai.com)입니다. 이전하는 항목은 이름·연락처·주민등록번호 등 식별정보를 마스킹한 상담 기록 글이며, 마스킹하지 않은 원본 기록이나 음성은 보내지 않습니다. 이전 목적은 상담 기록을 요약·정리한 초안을 만들어 실무자가 다음 상담을 준비하도록 돕기 위한 것이며, 인공지능이 만든 요약은 실무자가 검토하고 승인하여야 상담 기록이 됩니다. 이전 시기와 방법은 실무자가 인공지능 초안을 요청할 때마다 암호화된 통신(TLS)을 통해 미국으로 전송하는 방식입니다. 보낸 자료는 인공지능 모델 학습에 사용되지 않습니다. 또한 요청마다 응답을 다시 쓰기 위한 저장을 끄는 설정(store:false)으로 보내어 OpenAI, L.L.C. 쪽에서 응답을 보관하지 않도록 합니다. 다만 이와 별개로 OpenAI, L.L.C.는 서비스 남용·오용을 감시하기 위한 목적으로 보낸 자료를 최대 30일까지 보관할 수 있으며, 그 뒤 삭제합니다. 사회연대은행 안의 상담 기록과 승인된 요약은 상담 종결 후 1년까지 보관한 뒤 파기합니다. 위의 국외 이전에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 상담 기록을 외부 인공지능에 보내지 않고 실무자가 직접 요약합니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 상담 기록을 외부 인공지능에 보내지 않으며, 이미 작성된 요약은 위 보유기간에 따라 파기합니다. 이전받는 자가 바뀌는 경우에는 기존 동의로 처리하지 않고 새로 동의를 받습니다.',
    items: ['이름·연락처·주민등록번호 등 식별정보를 마스킹한 상담 기록 글'],
    purposeText: '상담 기록을 요약·정리한 초안을 만들어 실무자가 다음 상담을 준비하도록 돕기 위하여 OpenAI, L.L.C.(미국)에 전송합니다. 전송은 실무자가 인공지능 초안을 요청할 때 암호화된 통신(TLS)으로 이루어지며, 요약은 실무자가 검토·승인하여야 기록이 됩니다.',
    retentionText: '보낸 자료는 인공지능 학습에 사용되지 않으며, 응답을 저장하지 않는 설정(store:false)으로 보냅니다. 다만 OpenAI, L.L.C.는 남용·오용 감시 목적으로 최대 30일까지 보관할 수 있습니다. 사회연대은행 안의 기록과 요약은 상담 종결 후 1년까지 보관한 뒤 파기합니다.',
    refusalText: '위의 국외 이전에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 상담 기록을 외부 인공지능에 보내지 않고 실무자가 직접 요약합니다.',
    // 수신자는 기관이 고른 제공자다. **바뀌면 문안 해시가 달라지고 기존 동의는 `확인 필요`로 떨어진다** —
    // 누구에게 보내는지가 동의의 본체이기 때문이다(정본 §2.1).
    provider: AI_PROVIDERS[(process.env.AI_PROVIDER as AiProviderId) ?? 'openai'],
  },
  voice_original_retention_period: {
    label: '음성 원본 보유기간',
    purpose: 'voice_original_retention',
    copy:
      '사회연대은행은 「개인정보 보호법」 제15조제1항제1호에 따라 상담 음성 원본 파일을 다음과 같이 보관하고자 하오니, 동의 여부를 결정하여 주시기 바랍니다. 보관 목적은 상담 기록에 빠지거나 잘못 적힌 내용이 있을 때 음성을 다시 들어 확인하기 위한 것입니다. 보관하는 항목은 상담 음성 원본 파일입니다. 음성 원본 파일은 사회연대은행(대한민국) 서버 안에만 두고 저장일부터 30일까지 보관하며, 그 기간이 지나면 지체 없이 파기합니다. 이 파일은 외부에 제공하거나 국외로 보내지 않으며, 외부 음성인식(STT) 제공자에게 보내는 처리는 별도의 동의를 받아야만 진행합니다. 위의 음성 원본 보관에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 음성을 글로 옮긴 직후 음성 원본 파일을 바로 삭제합니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 해당 사례의 음성 원본 파일을 즉시 삭제합니다. 글로 옮긴 전사문은 상담 기록으로서 남으며 상담 종결 후 1년까지 보관한 뒤 파기합니다.',
    items: ['상담 음성 원본 파일'],
    purposeText: '상담 기록에 빠지거나 잘못 적힌 내용이 있을 때 음성을 다시 들어 확인하기 위하여 보관합니다.',
    retentionText: '사회연대은행 서버 안에만 두고 저장일부터 30일까지 보관하며, 그 기간이 지나면 지체 없이 파기합니다. 동의를 철회하시면 음성 원본 파일을 즉시 삭제합니다.',
    refusalText: '위의 음성 원본 보관에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 음성을 글로 옮긴 직후 음성 원본 파일을 바로 삭제합니다.',
    provider: { id: 'institution_private_storage', legalRecipient: '사회연대은행', country: 'KR' },
    retentionDuration: 'institution_retention_30d',
  },
  // 정본 여섯 영역 밖이다(2026-09-16 Q 확정). 서면·파일로 받은 문서에는
  // 채무 내역서·진단서처럼 민감정보가 그대로 들어 있어, 민감정보 처리 동의로 덮지 않고 따로 받는다.
  // 받은 문서는 기관 디스크에만 두고 밖으로 보내지 않는다.
  document_attachment: {
    label: '서면 문서 보관',
    purpose: 'document_retention',
    copy:
      '사회연대은행은 「개인정보 보호법」 제15조제1항제1호 및 제23조에 따라 상담 중 주신 서면·파일 문서를 다음과 같이 보관하고자 하오니, 동의 여부를 결정하여 주시기 바랍니다. 보관 목적은 말씀하신 사정을 서류로 확인하고, 지원 신청에 필요한 자료로 사용하기 위한 것입니다. 보관하는 항목은 상담 중 주신 서류와 파일(예: 채무 내역서, 진단서, 임대차 계약서)이며, 이러한 문서에는 건강·질병, 채무 등 민감정보가 그대로 담겨 있을 수 있으므로 별도로 동의를 받습니다. 문서는 사회연대은행(대한민국) 서버 안에만 두고 저장일부터 30일까지 보관하며, 그 기간이 지나면 지체 없이 파기합니다. 문서는 외부에 제공하거나 국외로 보내지 않으며, 누가 언제 열어 보았는지 열람 기록을 남겨 3년 동안 보관합니다. 위의 문서 보관에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 서류는 보관하지 않고 실무자가 내용을 확인한 뒤 돌려드립니다. 동의한 뒤에도 언제든지 동의를 철회하거나 처리 정지를 요구할 수 있으며, 담당 실무자에게 말씀하시면 됩니다. 철회하시면 그때부터 새로운 문서를 보관하지 않으며, 이미 보관한 문서는 위 보유기간에 따라 파기합니다.',
    items: ['상담 중 주신 서류와 파일(예: 채무 내역서, 진단서, 임대차 계약서)'],
    purposeText: '말씀하신 사정을 서류로 확인하고, 지원 신청에 필요한 자료로 사용하기 위하여 보관합니다.',
    retentionText: '사회연대은행 서버 안에만 두고 저장일부터 30일까지 보관한 뒤 파기합니다. 누가 열어 보았는지 남기는 열람 기록은 3년 동안 보관합니다.',
    refusalText: '위의 문서 보관에 대한 동의를 거부할 권리가 있으며, 거부하셔도 상담은 그대로 받으실 수 있습니다. 동의를 거부할 경우 서류는 보관하지 않고 실무자가 내용을 확인한 뒤 돌려드립니다.',
    provider: { id: 'institution_private_storage', legalRecipient: '사회연대은행', country: 'KR' },
    retentionDuration: 'institution_retention_30d',
  },
};

const TRUSTEE = '사회연대은행';
const SPEECH_REGION = 'koreacentral';

/** 온보딩 전후 모든 동의 쓰기·읽기가 공유하는 처리자 이름 규칙. */
export const effectiveInstitutionName = (name: string | null | undefined): string =>
  name?.trim() || TRUSTEE;

const renderInstitutionText = (text: string, institutionName: string): string =>
  text
    .replaceAll(TRUSTEE, institutionName)
    .replaceAll('한국 중부(Korea Central)', `한국 중부(${SPEECH_REGION})`)
    .replaceAll('한국 중부 리전', `한국 중부(${SPEECH_REGION}) 리전`);

/**
 * 지금 쓰는 문안. DB 편집본을 먼저 고른 뒤 기관명 치환을 마지막에 적용한다.
 * 수탁자 문장은 코드가 붙여 DB v3 편집본도 v4 필수 고지를 빠뜨릴 수 없다.
 */
export function copyText(domain: ConsentDomain, institutionName: string): DomainCopy {
  const source = { ...CONSENT_COPY[domain], ...live.text[domain] };
  const provider =
    source.provider?.id.startsWith('institution_')
      ? { ...source.provider, legalRecipient: institutionName }
      : source.provider;
  return {
    ...source,
    copy: `${institutionName}의 개인정보 처리 수탁자 ${TRUSTEE}은 시스템 운영을 담당합니다. ${renderInstitutionText(source.copy, institutionName)}`,
    items: source.items.map((item) => renderInstitutionText(item, institutionName)),
    purposeText: renderInstitutionText(source.purposeText, institutionName),
    retentionText: renderInstitutionText(source.retentionText, institutionName),
    refusalText: renderInstitutionText(source.refusalText, institutionName),
    provider,
  };
}

/**
 * 현재 기관명. 호출마다 DB 를 읽어 이름 변경이 즉시 새 동의 해시가 되게 한다.
 * 온보딩 전 빈 이름은 종전 처리자 이름을 써 문안·수신자를 빈 문자열로 내보내지 않는다.
 */
export async function consentInstitutionName(): Promise<string> {
  const [row] = await sql<Array<{ name: string }>>`select name from organization where id = 1`;
  return effectiveInstitutionName(row?.name);
}

/**
 * 문안 해시의 원문. 처리자·수탁자·고정 STT 리전을 명시적으로 묶고,
 * NFC 정규화 → 줄바꿈 LF → 줄 끝 공백 제거 → 마지막 LF 하나를 지킨다.
 */
export function canonicalPreimage(domain: ConsentDomain, institutionName: string): string {
  const { label, copy, purpose, provider, retentionDuration, items, purposeText, retentionText, refusalText } =
    copyText(domain, institutionName);
  const lines = [
    `domain=${domain}`,
    `processor=${institutionName}`,
    `trustee=${TRUSTEE}`,
    `region=${domain === 'external_stt_processing' ? SPEECH_REGION : '<null>'}`,
    `label=${label}`,
    `copy=${copy}`,
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

export type ConnectionSource = 'db' | 'env' | null;

export async function voiceConnection(): Promise<{ enabled: boolean; source: ConnectionSource }> {
  const [row] = await sql<Array<{ voice_enabled: boolean | null }>>`
    select voice_enabled from organization where id = 1`;
  if (row?.voice_enabled !== null && row?.voice_enabled !== undefined) {
    return { enabled: row.voice_enabled, source: 'db' };
  }
  if (process.env.VOICE_ENABLED !== undefined) {
    return { enabled: process.env.VOICE_ENABLED === '1', source: 'env' };
  }
  return { enabled: false, source: null };
}

/** 녹음 스위치. DB 값이 우선이고 null 일 때만 env 로 떨어진다. */
export async function voiceEnabled(): Promise<boolean> {
  return (await voiceConnection()).enabled;
}

/** 복호한 Speech 키. 값은 호출자 내부에서만 쓰고 응답·감사·로그에는 싣지 않는다. */
export async function speechKey(): Promise<{ key: string; source: Exclude<ConnectionSource, null> } | null> {
  const [row] = await sql<Array<{ enc_speech_key: string | null }>>`
    select enc_speech_key from organization where id = 1`;
  const stored = decryptPii(row?.enc_speech_key ?? null);
  if (stored) return { key: stored, source: 'db' };
  const env = process.env.AZURE_SPEECH_KEY?.trim();
  return env ? { key: env, source: 'env' } : null;
}

/** 녹음이 켜져 있고 DB 또는 env Speech 키가 있을 때만 전사한다. 리전은 koreacentral 고정이다. */
export async function sttEnabled(): Promise<boolean> {
  return (await voiceEnabled()) && (await speechKey()) !== null;
}

export async function activeDomains(): Promise<readonly ConsentDomain[]> {
  return (await voiceEnabled()) ? CONSENT_DOMAINS : CONSENT_DOMAINS.filter((domain) => !VOICE_DOMAINS.has(domain));
}

export const copyHash = (domain: ConsentDomain, institutionName: string): string =>
  createHash('sha256').update(canonicalPreimage(domain, institutionName), 'utf8').digest('hex');

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
export function foldConsent(
  domain: ConsentDomain,
  events: ConsentEventRow[],
  institutionName: string,
): ConsentStatus {
  const mine = events.filter((event) => event.domain === domain).sort((a, b) => a.id - b.id);
  const last = mine.at(-1);
  if (!last) return 'unconfirmed';
  if (last.decision !== 'grant') return 'not_granted';
  if (last.copy_version !== copyVersion() || last.copy_hash !== copyHash(domain, institutionName)) return 'unconfirmed';
  return 'granted';
}
