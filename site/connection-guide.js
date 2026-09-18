// 외부 서비스 설정 문안의 단일 정본. 공개 랜딩과 앱 설정이 같은 배열을 그린다.
// @ts-check

/** @typedef {{ kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'link'; text: string; href: string }} GuidePart */
/** @typedef {{ label: string; parts: readonly GuidePart[] }} GuideStep */
/** @typedef {{ id: 'ai' | 'stt' | 'voice' | 'db'; title: string; steps: readonly GuideStep[] }} ConnectionGuide */

/** @type {readonly ConnectionGuide[]} */
export const CONNECTION_GUIDES = [
  {
    id: 'ai',
    title: 'AI 정리',
    steps: [
      {
        label: '키 발급',
        parts: [
          { kind: 'link', text: 'OpenAI API keys', href: 'https://platform.openai.com/api-keys' },
          { kind: 'text', text: '에서 Create new secret key를 눌러 복사합니다. 키는 한 번만 표시됩니다.' },
        ],
      },
      {
        label: '결제',
        parts: [
          { kind: 'link', text: 'Billing', href: 'https://platform.openai.com/settings/organization/billing' },
          { kind: 'text', text: '에 카드를 등록합니다. 등록하지 않으면 호출이 거절됩니다.' },
        ],
      },
      {
        label: '여기 입력',
        parts: [{ kind: 'text', text: 'OpenAI API 키 한 칸에 붙여 넣고 저장합니다. 서버가 확인한 뒤 암호문으로 저장합니다.' }],
      },
      {
        label: 'AI가 돕는 범위',
        parts: [{ kind: 'text', text: '키 검증과 저장, 연결 상태 확인, 요약 생성을 돕습니다. 계정 가입, 결제, 키 발급은 사람이 합니다.' }],
      },
    ],
  },
  {
    id: 'stt',
    title: '녹음 글로 옮기기',
    steps: [
      {
        label: '리소스 만들기',
        parts: [
          { kind: 'link', text: 'Azure Speech 리소스 만들기', href: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices' },
          { kind: 'text', text: '에서 지역은 한국 중부(koreacentral), 요금제는 S0로 만듭니다.' },
        ],
      },
      {
        label: '키 복사',
        parts: [{ kind: 'text', text: 'Azure 포털의 리소스 > Keys and Endpoint에서 KEY 1을 복사합니다. 지역과 endpoint는 입력하지 않습니다.' }],
      },
      {
        label: '여기 입력',
        parts: [{ kind: 'text', text: 'Azure Speech 키 한 칸에 붙여 넣고 저장합니다. 서버가 한국 중부 키인지 확인한 뒤 암호문으로 저장합니다.' }],
      },
      {
        label: 'AI가 돕는 범위',
        parts: [{ kind: 'text', text: '키 검증과 저장, 연결 상태 확인, 전사를 돕습니다. Azure 가입, 결제, 리소스 생성은 사람이 합니다.' }],
      },
    ],
  },
  {
    id: 'voice',
    title: '상담 녹음',
    steps: [
      {
        label: '동의 확인',
        parts: [{ kind: 'text', text: '실사용 전 녹음과 외부 전사 동의 문안을 확인하고 필요한 동의를 다시 받습니다.' }],
      },
      {
        label: '녹음 켜기',
        parts: [{ kind: 'text', text: '상담 녹음 체크를 켭니다. Speech 키 저장과 별개라 키가 없어도 녹음할 수 있습니다.' }],
      },
      {
        label: '키가 없을 때',
        parts: [{ kind: 'text', text: '녹음은 저장되고 전사는 건너뜁니다. 나중에 Speech 키를 저장해 전사를 연결합니다.' }],
      },
    ],
  },
  {
    id: 'db',
    title: '데이터베이스',
    steps: [
      {
        label: '기관이 준비',
        parts: [
          { kind: 'link', text: 'Supabase', href: 'https://supabase.com/dashboard' },
          { kind: 'text', text: '에서 서울 리전 Pro 프로젝트를 만들고 BSS를 조직 Owner로 초대합니다.' },
        ],
      },
      {
        label: 'BSS가 연결',
        parts: [{ kind: 'text', text: 'BSS 운영자가 세션 풀러 연결 문자열을 받아 기관 앱을 열기 전에 데이터베이스와 스키마를 준비합니다.' }],
      },
      {
        label: '화면에서 확인',
        parts: [{ kind: 'text', text: '이 화면은 실제 연결 상태만 읽어 보여 줍니다. 데이터베이스 연결 문자열을 입력하는 칸은 없습니다.' }],
      },
      {
        label: 'AI가 돕는 범위',
        parts: [{ kind: 'text', text: '연결 상태 확인을 돕습니다. Supabase 가입, 결제, Owner 초대는 사람이 합니다.' }],
      },
    ],
  },
];
