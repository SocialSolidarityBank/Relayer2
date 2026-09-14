// 출처: SocialSolidarityBank/CCC — apps/web/app/.../records/intake/intake-questions.ts
// Apache-2.0. 이식 2026-09-14. 질문 문구는 정본(PRD/intake-questionnaire-v1.md) 그대로 두고,
// 2026-09-13 요구 I-01~I-04(공적급여)·I-07(강점 통합)만 반영한다.

/**
 * 인테이크 정본 질문지(D41 · `PRD/intake-questionnaire-v1.md`)의 항목 목록.
 *
 * 화면 문구·선택값은 정본 그대로이고, 저장은 게이트웨이의 고정 어휘 키로 한다. 질문을
 * 데이터로 두는 이유는 층마다(렌더·필수 카운트·수집·임시본) 같은 목록을 손으로 복제하지
 * 않기 위해서다 — 항목이 늘거나 문구가 바뀌면 이 파일만 고친다.
 */
export interface IntakeQuestion {
  key: string;
  label: string;
  /** select = 한 가지 고르기, multi = 여러 개 고르기, text = 서술. */
  kind: 'select' | 'multi' | 'text';
  options?: readonly string[];
  hint?: string;
}

export interface IntakeQuestionGroup {
  title: string;
  questions: readonly IntakeQuestion[];
}

/** 정본이 '무응답'·'해당 없음'으로 쓰는 두 문구. 저장에서는 본문이 아니라 응답 코드로 남는다. */
export const NO_RESPONSE_OPTION = '무응답';
export const NOT_APPLICABLE_OPTION = '해당 없음';

/**
 * 정본의 '무응답'은 기존 답변 어휘를 재사용해 표현한다 — 새 응답 코드를 만들지 않는다.
 * 무응답('확인되지 않았거나 답변하지 않음')은 `unknown`, '해당 없음'은 `not_applicable`.
 * 빈칸과 구분되어 저장되고, 본문 텍스트는 갖지 않는다(게이트웨이 계약).
 */
export const NO_RESPONSE_CODE = 'unknown';
export const NOT_APPLICABLE_CODE = 'not_applicable';

// ── 1. 상담 신청 및 기본정보 ────────────────────────────────────────────────
export const STEP1_GROUPS: readonly IntakeQuestionGroup[] = [
  {
    title: '1-2. 공적급여·수급자 여부',
    questions: [
      {
        key: 'welfare_basic_livelihood',
        label: '기초생활보장 수급 여부',
        kind: 'select',
        options: ['수급 중', '과거 수급', '비수급', '신청·심사 중', NO_RESPONSE_OPTION],
      },
      {
        key: 'welfare_benefit_type',
        label: '수급 유형',
        // I-02: 네 급여는 복수 선택, 해당 없음·무응답은 배타. '복수 급여' 체크는 만들지 않는다.
        kind: 'multi',
        options: ['생계급여', '의료급여', '주거급여', '교육급여', NOT_APPLICABLE_OPTION, NO_RESPONSE_OPTION],
      },
      {
        key: 'welfare_near_poverty',
        label: '차상위계층 여부',
        kind: 'select',
        options: ['해당', '비해당', '신청·확인 중', NO_RESPONSE_OPTION],
      },
      {
        key: 'welfare_other',
        label: '기타 공적급여',
        kind: 'text',
        hint: '예: 한부모가족 지원, 장애인연금, 기초연금',
      },
    ],
  },
  {
    title: '1-3. 상담 운영정보',
    questions: [
      {
        key: 'counsel_method',
        // 2026-09-14 Q 확정: 화면 라벨은 `상담 방식`이다(구 `상담 방법`).
        label: '상담 방식',
        kind: 'select',
        options: ['대면', '전화', '온라인 화상', '가정·현장 방문', '기타', NO_RESPONSE_OPTION],
      },
      {
        key: 'referral_path',
        label: '상담 신청·유입 경로',
        kind: 'select',
        options: ['본인 신청', '가족·지인 소개', '기관 의뢰', '온라인·홍보물', '기존 이용자 재상담', '기타', NO_RESPONSE_OPTION],
      },
      {
        key: 'contact_time',
        label: '주요 연락 가능 시간',
        kind: 'select',
        options: ['평일 오전', '평일 오후', '평일 저녁', '주말', '시간 협의 필요', NO_RESPONSE_OPTION],
      },
      {
        key: 'contact_caution',
        label: '연락 시 주의사항',
        kind: 'text',
        hint: '예: 문자 우선, 평일 18시 이후 가능, 가족에게 상담 사실 비공개',
      },
    ],
  },
  {
    title: '1-4. 상담 신청 사유',
    questions: [
      {
        key: 'application_reason',
        label: '상담을 신청한 주된 사유는 무엇인가요?',
        kind: 'select',
        options: [
          '경제·생계 어려움', '부채·연체 문제', '일자리·소득 불안정', '주거 문제', '건강·의료 문제',
          '심리·정서 어려움', '가족·관계 문제', '돌봄 부담', '법률·행정 문제', '복합적인 어려움',
          '기타', NO_RESPONSE_OPTION,
        ],
      },
      {
        key: 'application_reason_detail',
        label: '신청 배경',
        kind: 'text',
        hint: '예: 가족 간병으로 근로시간이 줄어 생활비와 카드대금 연체가 발생함.',
      },
    ],
  },
];

// ── 2. 현재 생활상황 ────────────────────────────────────────────────────────
// 화면은 첫 그룹(현재 어려움 관련 영역)만 쓴다. 2-1~2-5 모듈은 국가 표준 욕구영역 모듈
// (need-areas.ts: 영역마다 하위영역 2 + 상세 1)로 대체됐다. 여기 남은 문항은 표준에 없는
// 값(고용형태·소득 안정성 등)을 나중에 되살릴 때 쓰는 참고 자료이며 지금은 렌더하지 않는다.
export const STEP2_GROUPS: readonly IntakeQuestionGroup[] = [
  {
    title: '현재 어려움 관련 영역',
    questions: [
      {
        key: 'difficulty_areas',
        label: '현재 어려움 관련 영역',
        kind: 'multi',
        hint: '현재 겪는 어려움에 해당하는 영역을 모두 고르세요.',
        // 국가 표준 욕구영역 10종 + 기타(2024 희망복지지원단 업무안내). 구 6영역·9영역을 대체한다.
        options: [
          '안전', '건강', '일상생활유지', '가족관계', '사회적관계',
          '경제', '교육', '고용', '생활환경', '법률·권익보장', '기타', NO_RESPONSE_OPTION,
        ],
      },
    ],
  },
  {
    title: '2-1. 경제·부채상황',
    questions: [
      {
        key: 'economy_income_type',
        label: '주된 소득 유형',
        kind: 'select',
        options: ['근로소득', '사업소득', '공적급여', '연금', '가족·지인 지원', '소득 없음', '복수 소득', NO_RESPONSE_OPTION],
      },
      { key: 'economy_monthly_income', label: '월평균 소득', kind: 'text', hint: '예: 약 180만 원, 변동 있음' },
      { key: 'economy_monthly_expense', label: '월 지출', kind: 'text', hint: '예: 월세 50만 원, 식비 40만 원, 의료비 15만 원, 부채상환 30만 원' },
      {
        key: 'economy_arrears',
        label: '연체·미납 여부',
        kind: 'select',
        options: ['없음', '있음', '상환 유예·조정 중', NO_RESPONSE_OPTION],
      },
      {
        key: 'economy_debt_types',
        label: '대출·부채 현황',
        kind: 'multi',
        options: [
          '금융기관 대출', '카드대금', '임대료·관리비', '공과금·통신비', '거래처 미지급금',
          '가족·지인 차용', '기타', NOT_APPLICABLE_OPTION, NO_RESPONSE_OPTION,
        ],
      },
    ],
  },
  {
    title: '2-2. 일·고용상황',
    questions: [
      {
        key: 'employment_status',
        label: '현재 경제활동 상태',
        kind: 'select',
        options: ['상용근로', '임시·일용근로', '자영업·프리랜서', '구직 중', '휴직·병가', '비경제활동', NO_RESPONSE_OPTION],
      },
      {
        key: 'employment_income_stability',
        label: '소득 안정성',
        kind: 'select',
        options: ['안정적', '다소 불안정', '매우 불안정', '소득 없음', NO_RESPONSE_OPTION],
      },
      {
        key: 'employment_detail',
        label: '일·고용상황 상세내용',
        kind: 'text',
        hint: '예: 주 3일 배달업, 최근 가족돌봄으로 근로시간이 주 20시간에서 10시간으로 감소',
      },
    ],
  },
  {
    title: '2-3. 주거상황',
    questions: [
      {
        key: 'housing_type',
        label: '주거 형태',
        kind: 'select',
        options: ['자가', '전세', '보증부 월세', '월세', '공공임대', '가족·지인 거주지', '고시원·숙박시설', '시설·임시거처', NO_RESPONSE_OPTION],
      },
      {
        key: 'housing_instability',
        label: '주거 불안 수준',
        kind: 'select',
        options: ['문제 없음', '비용 부담', '퇴거·이사 가능성', '주거환경 문제', '긴급 주거위기', NO_RESPONSE_OPTION],
      },
      {
        key: 'housing_detail',
        label: '주거상황 상세내용',
        kind: 'text',
        hint: '예: 자녀 1명과 월세 거주, 월세 2개월 미납으로 임대인 독촉 중',
      },
    ],
  },
  {
    title: '2-4. 건강·심리정서',
    questions: [
      {
        key: 'health_physical',
        label: '신체 건강상태',
        kind: 'select',
        options: ['양호', '만성질환 관리 중', '치료 필요', '일상생활 제한 있음', NO_RESPONSE_OPTION],
      },
      {
        key: 'health_care_barrier',
        label: '치료 접근 어려움',
        kind: 'select',
        options: ['없음', '비용', '시간', '이동', '돌봄 공백', '기타', NO_RESPONSE_OPTION],
      },
      {
        key: 'health_stress',
        label: '스트레스 수준',
        kind: 'select',
        options: ['낮음', '보통', '높음', '매우 높음', NO_RESPONSE_OPTION],
      },
      {
        key: 'health_daily_impact',
        label: '일상생활 영향',
        kind: 'select',
        options: ['영향 없음', '수면', '식사', '외출', '관계', '근로', '복합 영향', NO_RESPONSE_OPTION],
      },
      {
        key: 'health_detail',
        label: '건강·심리정서 상세내용',
        kind: 'text',
        hint: '예: 허리디스크 치료 중이며 치료비 부담으로 물리치료를 중단함. 최근 불면과 무기력 호소',
      },
    ],
  },
  {
    title: '2-5. 가족·관계·돌봄',
    questions: [
      {
        key: 'family_household_type',
        label: '가구 형태',
        kind: 'select',
        options: ['1인 가구', '부부 가구', '부모·자녀 가구', '한부모 가구', '조손 가구', '다세대 가구', '기타', NO_RESPONSE_OPTION],
      },
      {
        key: 'family_care_burden',
        label: '돌봄 부담',
        kind: 'select',
        options: ['없음', '아동 돌봄', '노인 돌봄', '장애·질병 가족 돌봄', '본인이 돌봄 받음', '복수 돌봄', NO_RESPONSE_OPTION],
      },
      {
        key: 'family_detail',
        label: '가족·관계·돌봄 상세내용',
        kind: 'text',
        hint: '예: 치매 진단을 받은 어머니를 주 5일 돌보고 있으며, 형제의 지원은 거의 없음',
      },
    ],
  },
];

const NEED_OPTIONS = [
  '생계비·긴급지원', '채무상담·채무조정', '일자리·소득지원', '주거지원', '의료지원', '심리상담',
  '가족·돌봄지원', '법률·행정지원', '교육·훈련', '정보제공·기관연계', '기타', NO_RESPONSE_OPTION,
] as const;

// ── 3. 필요한 도움과 활용 가능한 자원 ───────────────────────────────────────
export const STEP3_GROUPS: readonly IntakeQuestionGroup[] = [
  {
    title: '3-1. 우선적으로 필요한 도움',
    questions: [
      { key: 'need_primary', label: '1순위 지원욕구', kind: 'select', options: NEED_OPTIONS },
      { key: 'need_secondary', label: '2순위 지원욕구', kind: 'select', options: [NOT_APPLICABLE_OPTION, ...NEED_OPTIONS] },
      {
        key: 'need_detail',
        label: '필요한 도움 상세내용',
        kind: 'text',
        hint: '예: 당장 카드 연체를 막기 위한 채무상담과 단기 생계비 지원을 우선 희망함',
      },
    ],
  },
  {
    title: '3-2. 이전 지원 경험',
    questions: [
      {
        key: 'previous_support_detail',
        label: '이전 지원 경험 상세내용',
        kind: 'text',
        hint: '예: 2025년 주민센터 긴급복지 상담, 소득기준 초과로 미지원',
      },
    ],
  },
  {
    title: '3-4. 강점과 비공식 자원',
    questions: [
      // I-07: 구 `도움을 요청할 사람`·`본인의 강점` 두 칸을 이 한 칸으로 합친다.
      // 옛 세 응답(strength_relational·strength_personal·strength_detail)은 덮어쓰지 않는다.
      {
        key: 'strength_detail',
        label: '강점과 비공식 자원',
        kind: 'text',
        hint: '예: 누나와 직장 동료의 도움을 받을 수 있고, 어려움이 있어도 근로를 유지해 온 실행력이 있음',
      },
    ],
  },
];

// ── 4. 상담 정리와 후속관리 ────────────────────────────────────────────────
export const STEP4_GROUPS: readonly IntakeQuestionGroup[] = [
  {
    title: '4-1. 상담 참여 여건',
    questions: [
      {
        key: 'participation_barrier',
        label: '참여 방해요인',
        kind: 'select',
        options: [
          '없음', '근무시간', '돌봄 부담', '이동 어려움', '건강 문제', '연락 어려움',
          '디지털 사용 어려움', '비용 부담', '복수 요인', '기타', NO_RESPONSE_OPTION,
        ],
      },
      {
        key: 'participation_preferred_method',
        label: '선호 상담 방식',
        kind: 'select',
        options: ['대면', '전화', '온라인 화상', '방문', '혼합', NO_RESPONSE_OPTION],
      },
      {
        key: 'participation_detail',
        label: '상담 참여 여건 상세내용',
        kind: 'text',
        hint: '예: 평일 낮에는 돌봄 때문에 참여가 어렵고, 화요일 18시 이후 전화상담 가능',
      },
    ],
  },
  {
    title: '4-3. 담당 실무자 판단 및 다음 단계',
    questions: [
      // 결정 32: 긴급도 → 위기도(희망복지지원단 매뉴얼 용어). 실무자가 직접 고르며 AI 제안·자동값이 없다(R5).
      // 결정 08: 미선택은 '판단 안 함'이다. 안정으로 기록하지 않으므로 무응답 선택지를 두지 않는다.
      { key: 'summary_urgency', label: '위기도', kind: 'select', options: ['일반', '주의', '긴급', '즉시 개입 필요'] },
      {
        key: 'summary_direction',
        label: '주요 지원방향',
        kind: 'select',
        options: ['정보 제공', '기관 연계', '사례관리 진행', '단기 집중지원', '전문상담 의뢰', '추가 사정 후 결정'],
      },
    ],
  },
];

export const STEP_GROUPS: readonly (readonly IntakeQuestionGroup[])[] = [
  STEP1_GROUPS, STEP2_GROUPS, STEP3_GROUPS, STEP4_GROUPS,
];

/** 질문 밖 필수 항목 수: 상담일, 부채 표 첫 행, 연계 기관 표 첫 행, 종합의견. */
export const INTAKE_STEP_REQUIRED_EXTRA_COUNTS = [1, 1, 1, 1] as const;

// ── 반복 행 표 3종의 열 정의 ────────────────────────────────────────────────
// 작성 위저드와 조회 화면(CCC-58)이 같은 열 이름을 그려야 하므로 여기가 단일 원천이다.
// placeholder 는 작성 화면만 쓴다 — 조회는 label 만 읽는다.

export interface IntakeTableColumn { key: string; label: string; placeholder?: string }

// 2-1 대출·부채 현황: 채무별 기관·채권자, 구분, 잔액, 월 상환액, 연체 여부·상태.
export const DEBT_COLUMNS: readonly IntakeTableColumn[] = [
  { key: 'creditor', label: '기관·채권자', placeholder: '예: OO은행 / 해당 없음' },
  { key: 'kind', label: '구분', placeholder: '예: 신용대출' },
  { key: 'balance', label: '잔액', placeholder: '예: 1,200만 원' },
  { key: 'monthlyPayment', label: '월 상환액', placeholder: '예: 30만 원' },
  { key: 'arrearsStatus', label: '연체 여부·상태', placeholder: '예: 3개월 연체' },
];

// 3-3 현재 연계된 기관·서비스.
export const LINKED_ORG_COLUMNS: readonly IntakeTableColumn[] = [
  { key: 'orgName', label: '기관명', placeholder: '예: OO구 주민센터 / 해당 없음' },
  { key: 'serviceName', label: '사업·서비스명', placeholder: '예: 긴급복지 생계지원' },
  { key: 'supportDetail', label: '지원내용·금액', placeholder: '예: 생계비 713,100원' },
  { key: 'usagePeriod', label: '이용기간', placeholder: '예: 2026.07~2026.09' },
  { key: 'progressStatus', label: '진행상태·담당자', placeholder: '예: 심사 중 / 김OO 주무관' },
];

// 4-2 추가 확인사항.
export const ADDITIONAL_COLUMNS: readonly IntakeTableColumn[] = [
  { key: 'item', label: '추가 확인사항', placeholder: '예: 전체 채무 잔액' },
  { key: 'reason', label: '필요한 이유', placeholder: '예: 채무조정 가능성 판단' },
  { key: 'method', label: '확인 방법', placeholder: '예: 신용정보조회서 확인' },
  { key: 'dueNote', label: '확인 예정 시점', placeholder: '예: 다음 상담 전' },
];

export const STEP_TITLES = [
  '상담 신청 및 기본정보',
  '현재 생활상황',
  '필요한 도움과 활용 가능한 자원',
  '상담 정리와 후속관리',
] as const;

/** 240px 단계 레일 전용 짧은 라벨. 본문 제목과 접근성 이름은 STEP_TITLES를 유지한다. */
export const STEP_NAV_TITLES = ['상담 신청', '생활상황', '도움과 자원', '상담 정리'] as const;

/** 화면에 실제로 뜨는 질문 키 전체(필수 카운트·수집·임시본 정규화의 단일 원천). */
export const ACTIVE_QUESTIONS: readonly IntakeQuestion[] = STEP_GROUPS
  .flatMap((groups) => groups.flatMap((group) => group.questions));

/** 상담 방식(6종)을 DB 채널 3종으로 좁힌다. 정본 문구는 counsel_method 답변으로 그대로 남는다. */
export function channelForMethod(method: string): 'in_person' | 'phone' | 'video' {
  if (method === '전화') return 'phone';
  if (method === '온라인 화상') return 'video';
  return 'in_person';
}

/**
 * 소절 앵커 id(2026-08-09 바로가기 목차). 제목이 곧 id 다 — 점만 빼고(선택자에서 클래스로
 * 읽힌다) 공백을 - 로 접는다. 한글 id 는 유효하다. 작성 위저드와 조회 화면이 같은 헬퍼를
 * 쓰므로 같은 제목은 두 화면에서 같은 자리로 간다.
 */
export function intakeSectionAnchor(title: string): string {
  return `intake-sec-${title.replace(/\./g, '').replace(/\s+/g, '-')}`;
}
