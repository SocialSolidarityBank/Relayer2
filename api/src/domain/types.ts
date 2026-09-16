export type CardKind = 'fact' | 'question' | 'promise' | 'judgment';
export type SourceSection = 'intake' | 'memo' | 'change' | 'promise' | 'question' | 'judgment';
export type OutcomeResult = 'done' | 'in_progress' | 'not_done' | 'confirmed' | 'unchecked';
export type Follow = 'continue' | 'stop';

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
