// 욕구영역 정본 — 2024 희망복지지원단 업무안내 통합사례관리 욕구사정 10영역 + 기타.
// 구조: 영역 > 하위영역 2개(세부항목 복수 선택) + 상세 1칸. 결정 14의 "영역마다 선택 2 + 상세 1"과 같다.
// 세부항목은 매뉴얼 문구 그대로다. 임의로 늘리거나 줄이지 않는다(SPEC §6).
// 저장 키: need_<area>_<sub> (복수 선택), need_<area>_detail (상세).

export type NeedSubdomain = { key: string; title: string; items: readonly string[] };
export type NeedArea = { key: string; label: string; subdomains: readonly NeedSubdomain[] };

export const NEED_AREAS: readonly NeedArea[] = [
  {
    key: 'safety',
    label: '안전',
    subdomains: [
      { key: 'inside', title: '가족 내 안전 유지', items: ['폭력', '성폭력', '유기', '방임', '학대', '실종'] },
      { key: 'outside', title: '가족 외부로부터의 보호', items: ['폭력', '성폭력', '협박·위협', '학대', '착취'] },
    ],
  },
  {
    key: 'health',
    label: '건강',
    subdomains: [
      {
        key: 'physical',
        title: '신체적 건강 유지',
        items: ['질병', '장애', '만성질환', '치료·수술 필요', '일상생활 곤란'],
      },
      {
        key: 'mental',
        title: '정신적 건강 유지',
        items: ['우울', '불안', '스트레스', '정신질환', '이상행동', '자살위험'],
      },
    ],
  },
  {
    key: 'daily_living',
    label: '일상생활유지',
    subdomains: [
      {
        key: 'basic',
        title: '의식주 관련 일상생활 유지',
        items: [
          '식사 준비 및 식사', '용변 처리', '의복 착·탈의', '목욕·세면', '외출',
          '약물 복용', '가사활동', '이동', '긴급상황 대처',
        ],
      },
      {
        key: 'leisure',
        title: '여가생활 활용',
        items: ['여가활동 부족', '부적절한 여가활동', '문화·취미활동 부족'],
      },
    ],
  },
  {
    key: 'family',
    label: '가족관계',
    subdomains: [
      {
        key: 'conflict',
        title: '관계 형성 및 갈등',
        items: ['부부갈등', '부모·자녀 갈등', '고부갈등', '형제자매 갈등', '가족관계 소원·단절'],
      },
      { key: 'care', title: '가족 돌봄', items: ['아동 돌봄', '노인 돌봄', '장애인 돌봄', '환자 간병'] },
    ],
  },
  {
    key: 'social',
    label: '사회적관계',
    subdomains: [
      {
        key: 'neighbor',
        title: '친인척 및 이웃 간 관계 형성',
        items: ['친인척 갈등', '이웃 갈등', '친인척·이웃과의 관계 단절·소원', '도움을 요청할 지지망 부족'],
      },
      {
        key: 'group',
        title: '소속된 집단 및 사회생활',
        items: [
          '직장생활의 어려움', '학교생활의 어려움', '종교생활의 어려움', '기타 사회생활의 어려움',
          '따돌림·괴롭힘', '상습범죄', '지역사회 지지체계 부족',
        ],
      },
    ],
  },
  {
    key: 'economy',
    label: '경제',
    subdomains: [
      {
        key: 'basic_living',
        title: '기초생활 해결',
        items: ['식비', '주거비', '의복비', '난방비', '공과금', '통신비', '의료비'],
      },
      {
        key: 'assets',
        title: '자산관리',
        items: ['자산관리능력 부족', '부채', '과태료·벌금', '과소비·낭비'],
      },
    ],
  },
  {
    key: 'education',
    label: '교육',
    subdomains: [
      {
        key: 'basic_knowledge',
        title: '기초지식 습득 및 향상',
        items: ['한글·문해능력 부족', '기초 수리·계산능력 부족', '의무교육 미수료', '장애·질병으로 인한 기초학습 어려움'],
      },
      {
        key: 'improve',
        title: '교육 개선',
        items: [
          '교육비 부담', '학업 수행의 어려움', '특수교육 필요', '사교육 필요',
          '상급학교 진학의 어려움', '무단결석', '탈선·가출에 따른 학업 부진',
        ],
      },
    ],
  },
  {
    key: 'employment',
    label: '고용',
    subdomains: [
      {
        key: 'getting',
        title: '취업·창업',
        items: ['취업·구직의 어려움', '실업·실직', '저임금', '비정규직', '열악한 근로환경', '창업의 어려움'],
      },
      {
        key: 'keeping',
        title: '고용 유지',
        items: ['잦은 직장이동', '반복적인 재취업 실패', '취업동기 부족', '사업체 유지 곤란'],
      },
    ],
  },
  {
    key: 'living_env',
    label: '생활환경',
    subdomains: [
      {
        key: 'inside',
        title: '주거 내부환경 개선',
        items: [
          '화장실 열악', '주방시설 열악', '위생환경 불량', '도배·장판 불량', '냉·난방시설 열악',
          '전기시설 불량', '가스시설 불량', '상·하수도시설 불량', '주택 내 이동 곤란',
          '사생활 공간 부족', '위험물·쓰레기 방치',
        ],
      },
      {
        key: 'outside',
        title: '주거 외부환경 개선',
        items: ['학습환경 열악', '교통 접근성 부족', '주변 위험물', '상습 침수', '철거·공공수용 등 주거 불안'],
      },
    ],
  },
  {
    key: 'legal',
    label: '법률·권익보장',
    subdomains: [
      {
        key: 'support',
        title: '법률적 지원',
        items: ['법률처리(재산·위자료 등)', '신분상실', '사고보상처리', '파산·신용불량', '국적문제'],
      },
      { key: 'rights', title: '권익보장', items: ['차별대우', '권리침해'] },
    ],
  },
  {
    key: 'other',
    label: '기타',
    subdomains: [],
  },
];

export const NEED_AREA_LABELS: readonly string[] = NEED_AREAS.map((a) => a.label);

/** 경제 영역만 숫자 두 칸을 더 받는다(결정 15). */
export const ECONOMY_NUMBER_FIELDS = [
  { key: 'economy_monthly_income', label: '월평균 소득', hint: '예: 약 180만 원, 변동 있음' },
  { key: 'economy_monthly_expense', label: '월 지출', hint: '예: 월세 50만 원, 부채상환 30만 원' },
] as const;
