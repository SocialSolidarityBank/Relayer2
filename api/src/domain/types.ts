export type CardKind = 'fact' | 'question' | 'promise' | 'judgment';
/** 과제 수행 주체. `participant` 당사자 · `worker` 담당 실무자(2026-09-18 Q). */
export const CARD_OWNERS = ['participant', 'worker'] as const;
export type CardOwner = (typeof CARD_OWNERS)[number];
export type SourceSection = 'intake' | 'memo' | 'change' | 'promise' | 'question' | 'judgment';
export type OutcomeResult = 'done' | 'in_progress' | 'not_done' | 'confirmed' | 'unchecked';
export type Follow = 'continue' | 'stop';

/**
 * 회차간 사실관계 변화(2026-09-16 Q). 지난 회차에서 말한 것과 이번 회차에서 말한 것이 다르면
 * **양쪽 원문**을 그대로 붙인다. 어느 쪽이 맞는지는 말하지 않는다 — 번복했을 수 있다.
 */
export type FactChange = {
  /** 무엇이 달라졌는지 한 줄. 예: "월세 연체 개월 수" */
  topic: string;
  before: { seq: number; quote: string };
  after: { seq: number; quote: string };
  /** 앞뒤 맥락을 견준 설명 한두 문장. 판정이 아니다. */
  note: string;
};

/** 근거 등급. 애매하면 낮은 등급 — [완전]보다 [정황]이, [정황]보다 [없음]이 덜 위험하다. */
export const EVIDENCE_GRADES = ['완전', '부분', '정황', '과잉', '모순', '없음'] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];
/** 원문 → 항목 변환 유형. 집계·경향화와 해석·판단은 주관이 들어간 자리라 화면이 눈에 띄게 표시한다. */
export const EVIDENCE_TRANSFORMS = ['일반화', '감정 라벨링', '집계·경향화', '해석·판단', '압축', '화자 전환'] as const;
export type EvidenceTransform = (typeof EVIDENCE_TRANSFORMS)[number];

/**
 * 정리 항목 하나의 근거(2026-09-18 Q). 모델이 항목을 만들 때 **같은 호출에서** 낳은 원문 문장과
 * 앞뒤 맥락이다 — 화면이 낱말 겹침으로 추측하지 않는다. 방향은 늘 항목 → 자료다.
 * 인용은 자료에 적힌 그대로이고 서버가 문자열 일치를 확인한다(`verifyEvidence`).
 */
export type AiEvidence = {
  /** changes·tasks·questions 의 항목 문장 그대로. 화면이 이 글자로 짝을 찾는다. */
  item: string;
  /** 자료 라벨 그대로: `상담 내용` · `전사문` · `수행할 과제` … */
  source: string;
  /** 항목을 낳은 원문 문장(들). 자료 여기저기 흩어져 있을 수 있어 여럿이다. 검증에서 떨어진 것은 빠진다. */
  quotes: string[];
  /** quotes 를 품은 앞뒤 문장 발췌. 이것만 읽어도 항목이 왜 나왔는지 읽혀야 한다. */
  context: string;
  grade: EvidenceGrade;
  transforms: EvidenceTransform[];
  /** 왜 근거인지 한두 문장. 추론이 들어갔으면 어디서인지. 배제한 후보가 있으면 그 이유. */
  note: string;
};

/** 역방향 점검 — 어떤 항목에도 쓰이지 않은 자료 구간. `하`(인사·잡담)는 낱개가 아니라 건수다. */
export type AiOmission = {
  source: string;
  quote: string;
  importance: '상' | '중';
  /** 내용 한 줄. */
  summary: string;
};

// 국가 표준 욕구영역 10종 + 기타. 2024 희망복지지원단 업무안내 통합사례관리 욕구사정과 같다.
// 민간(희망이음)·공공(행복e음)이 같은 분류를 쓰므로 의뢰·통계가 구조적으로 호환된다. 임의로 늘리거나 줄이지 않는다.
export const LIFE_AREAS = [
  'safety',
  'health',
  'daily_living',
  'family',
  'social',
  'economy',
  'education',
  'employment',
  'living_env',
  'legal',
  'other',
] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

export const LIFE_AREA_LABEL: Record<LifeArea, string> = {
  safety: '안전',
  health: '건강',
  daily_living: '일상생활유지',
  family: '가족관계',
  social: '사회적관계',
  economy: '경제',
  education: '교육',
  employment: '고용',
  living_env: '생활환경',
  legal: '법률·권익보장',
  other: '기타',
};

export type Card = {
  id: number;
  case_id: number;
  kind: CardKind;
  text: string;
  area: LifeArea | null;
  topic_key: string | null;
  risk_type: string | null;
  quote: string | null;
  source_session_id: number;
  source_section: SourceSection;
  source_type: 'manual' | 'ai_approved';
  /** 수행 주체(2026-09-18). 당사자가 기본, 담당 실무자 일이면 worker. */
  owner: CardOwner;
  created_at: string;
};

export type CardOutcome = {
  id: number;
  card_id: number;
  session_id: number;
  result: OutcomeResult;
  follow: Follow | null;
  reason: string | null;
  note: string | null;
};

export type Session = {
  id: number;
  case_id: number;
  seq: number;
  kind: 'intake' | 'regular';
  status: 'planned' | 'done';
  scheduled_at: string | null;
  method: string | null;
  place: string | null;
  plan_memo: string | null;
  held_at: string | null;
  /** 소요 분(2026-09-18 Q D4). 종료 시각은 화면이 분으로 바꿔 보낸다. */
  duration_min: number | null;
  memo: string | null;
  detail: Record<string, unknown>;
  today_goal_text: string | null;
  today_goal_from_session_id: number | null;
  next_goal_text: string | null;
  next_goal_consumed_by_session_id: number | null;
};

export type SupportCase = {
  id: number;
  participant_id: number;
  program_id: number;
  /** 사업 표에서 join 으로 붙는 이름. 사례 행에는 없다(0025). */
  program_name: string;
  status: 'open' | 'closed';
  overall_goal: string | null;
  overall_goal_source: 'agreed' | 'intake_need' | null;
  sessions_planned: number | null;
};

/** 사례를 맡은 사람. 공동 배정이라 한 사례에 여럿일 수 있다(2026-09-16 Q). */
export type Assignee = { id: number; name: string };

/** 카드 결과를 추적하는 종류. 사실·판단 카드는 열고 닫지 않는다. */
export const TRACKED_KINDS: Record<CardKind, boolean> = {
  fact: false,
  question: true,
  promise: true,
  judgment: false,
};
