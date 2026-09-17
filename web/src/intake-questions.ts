// 인테이크 작성하기 질문 목록 — 2026-09-16 수정 요청(릴레이어_인테이크_수정요청.md)의 아홉 구획.
// 화면 문구·선택값은 요청서 그대로이고, 저장은 detail 의 고정 키로 한다.
// 1구획(상담 일시와 상담 방식)은 세션 필드(held_at·method·place), 7~9구획(전체 상담 목표·
// 수행할 과제·다음에 물어볼 것)은 사례 필드와 카드라 화면(intake.tsx)이 직접 그린다.
// 여기는 데이터로 그리는 2~6구획만 둔다.

export interface IntakeQuestion {
  key: string;
  label: string;
  /** select = 한 가지 고르기, multi = 여러 개 고르기, text = 한 줄, textarea = 자동으로 늘어나는 글 칸. */
  kind: 'select' | 'multi' | 'text' | 'textarea';
  options?: readonly string[];
  hint?: string;
  /** 이 답이 이 값일 때만 보인다. 숨겨져도 이미 저장된 답은 지우지 않는다. */
  visibleWhen?: { key: string; equals: string };
}

export interface IntakeQuestionGroup {
  title: string;
  questions: readonly IntakeQuestion[];
}

/** '해당 없음'은 다른 선택과 함께 고를 수 없다. '무응답'은 2026-09-16 요청으로 모든 문항에서 뺐다. */
export const NOT_APPLICABLE_OPTION = '해당 없음';

/** 선호 상담 방식의 네 선택지. 실제 상담 방식(session.method 코드)과 섞이지 않게 라벨로 저장한다. */
export const PREFERRED_METHOD_OPTIONS = ['대면', '전화', '화상', '기타(이메일, SNS 등)'] as const;

export const INTAKE_GROUPS: readonly IntakeQuestionGroup[] = [
  {
    title: '공적급여, 수급자 여부',
    questions: [
      {
        // 구 `기초생활보장 수급 여부`·`차상위계층 여부` 두 문항을 한 문항으로 합쳤다(요청 3).
        key: 'welfare_status',
        label: '수급자 여부',
        kind: 'select',
        options: ['기초생활보장수급', '차상위계층', NOT_APPLICABLE_OPTION],
      },
      {
        key: 'welfare_benefit_type',
        label: '수급 유형',
        kind: 'multi',
        options: ['생계급여', '의료급여', '주거급여', '교육급여'],
        visibleWhen: { key: 'welfare_status', equals: '기초생활보장수급' },
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
    title: '상담 운영정보',
    questions: [
      {
        // 구 `상담 방식`(counsel_method) 자리다. 실제로 진행한 방식이 아니라 당사자가
        // 바라는 방식이라 이름을 `선호 상담 방식`으로 바꿨다(요청 4).
        key: 'preferred_counsel_method',
        label: '선호 상담 방식',
        kind: 'select',
        options: PREFERRED_METHOD_OPTIONS,
      },
      {
        key: 'referral_path',
        label: '상담 신청·유입 경로',
        kind: 'select',
        options: ['본인 신청', '기관 추천', '홈페이지·SNS', '오프라인 홍보', '기타', NOT_APPLICABLE_OPTION],
      },
      {
        key: 'contact_days',
        label: '연락 가능 요일',
        kind: 'multi',
        options: ['평일', '주말·공휴일', NOT_APPLICABLE_OPTION],
      },
      {
        key: 'contact_hours',
        label: '연락 가능 시간대',
        kind: 'multi',
        options: ['오전', '오후', '저녁', NOT_APPLICABLE_OPTION],
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
    // 2026-09-17 최종 요청(docs/intake_final.md §5): 사유 다섯 선택지 교체 + 필요 자원 연계 복수 선택 부활.
    title: '상담 신청 사유 및 필요 자원 연계',
    questions: [
      {
        key: 'application_reason',
        label: '상담신청 사유',
        kind: 'multi',
        // `주거`는 요청서 그대로다. 욕구영역(`area`)의 국가 표준명 `생활환경`과는 다른 축이라 섞지 않는다.
        options: ['경제·재무', '부채', '일자리·소득', '주거', '기타'],
      },
      {
        // 구 `resource_link` 키 재사용. 선택값은 라벨 문자열이라 옛 답은 새 선택지와 안 맞아도 그대로 보존한다.
        key: 'resource_link',
        label: '필요 자원 연계',
        kind: 'multi',
        options: ['건강·의료', '심리·정서', '법률·행정', '가족', '안전', '기타'],
      },
      {
        key: 'application_reason_detail',
        label: '신청 배경',
        kind: 'text',
        hint: '예: 가족 간병으로 근로시간이 줄어 생활비와 카드대금 연체가 발생함.',
      },
      // 09-16 요청의 `그 밖의 상황과 연계가 필요한 내용`(resource_link_detail) 글 칸은 09-17 요청에서 빠졌다.
      // 화면에서만 빼고 저장된 답은 다른 은퇴 문항처럼 detail 에 그대로 남는다.
    ],
  },
  {
    title: '이전에 받은 지원',
    questions: [
      {
        key: 'previous_support_detail',
        label: '다른 기관에서 받았거나 신청한 지원',
        kind: 'textarea',
        hint: '예: 2025년 주민센터 긴급복지 상담, 소득기준 초과로 미지원',
      },
    ],
  },
  {
    title: '강점과 도와줄 사람',
    questions: [
      {
        key: 'strength_detail',
        label: '강점과 도와줄 사람',
        kind: 'textarea',
        hint: '예: 누나와 직장 동료의 도움을 받을 수 있고, 어려움이 있어도 근로를 유지해 온 실행력이 있음',
      },
    ],
  },
];
