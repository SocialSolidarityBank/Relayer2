-- 릴레이어 베타 초기 스키마. 계약은 SPEC.md, 이름은 GLOSSARY.md.
-- 규율: 삭제 대신 시각 컬럼 / append-only 표만 트리거로 잠근다 / 쓰기 경로는 API 하나뿐이라 그 밖의 가드 트리거는 두지 않는다.

create table users (
  id              bigint generated always as identity primary key,
  email           text not null unique,
  password_hash   text,
  name            text not null,
  -- 역할은 셋뿐이다(GLOSSARY §3). 베타 로그인은 worker·admin 만 쓴다.
  role            text not null check (role in ('participant', 'worker', 'admin')),
  created_at      timestamptz not null default now(),
  deactivated_at  timestamptz
);

-- 당사자 본체에는 가명 ID만 둔다. 실명·연락처·이메일은 금고로.
create table participants (
  id          bigint generated always as identity primary key,
  pseudonym   text not null unique,
  created_at  timestamptz not null default now()
);

-- 금고는 당사자 1명당 하나다. 한 사람이 두 사업에 참여해도 쪼개지 않는다(2026-09-14 Q 확정).
create table participant_pii (
  participant_id  bigint primary key references participants (id) on delete cascade,
  enc_name        text,
  enc_phone       text,
  enc_email       text,
  enc_birth       text,
  enc_address     text,
  key_version     int not null default 1
);

create table support_cases (
  id                   bigint generated always as identity primary key,
  participant_id       bigint not null references participants (id),
  program_name         text not null,
  status               text not null default 'open' check (status in ('open', 'closed')),
  opened_at            timestamptz not null default now(),
  -- 전체 상담 목표는 비어 있어도 된다(2026-09-14 Q 확정).
  overall_goal         text,
  overall_goal_source  text check (overall_goal_source in ('agreed', 'intake_need')),
  sessions_planned     int,
  assigned_user_id     bigint references users (id)
);

-- 회차. status='planned' 이면 상담 일정 등록, 'done' 이면 기록된 회차다.
-- 한 회차는 한 사례에만 속한다(2026-09-14 Q 확정: 한 상담 = 한 사례 = 한 사업).
create table sessions (
  id                             bigint generated always as identity primary key,
  case_id                        bigint not null references support_cases (id) on delete cascade,
  seq                            int not null,
  kind                           text not null check (kind in ('intake', 'regular')),
  status                         text not null check (status in ('planned', 'done')),
  scheduled_at                   timestamptz,
  method                         text check (method in ('in_person', 'phone', 'video', 'visit')),
  place                          text,
  plan_memo                      text,
  held_at                        timestamptz,
  memo                           text,
  detail                         jsonb not null default '{}'::jsonb,
  today_goal_text                text,
  today_goal_from_session_id     bigint references sessions (id),
  next_goal_text                 text,
  next_goal_consumed_by_session_id bigint references sessions (id),
  created_by                     bigint references users (id),
  created_at                     timestamptz not null default now(),
  unique (case_id, seq),
  -- 상담 장소는 대면일 때만 입력한다(요구 14).
  constraint sessions_place_only_in_person check (place is null or method = 'in_person')
);

create table cards (
  id                 bigint generated always as identity primary key,
  case_id            bigint not null references support_cases (id) on delete cascade,
  kind               text not null check (kind in ('fact', 'question', 'promise', 'judgment')),
  text               text not null,
  area               text check (area in ('economy', 'employment', 'housing', 'health',
                                          'mental_health', 'family', 'care', 'legal', 'other')),
  topic_key          text,
  risk_type          text,
  quote              text,
  source_session_id  bigint not null references sessions (id),
  source_section     text not null check (source_section in ('intake', 'memo', 'change',
                                                             'promise', 'question', 'judgment')),
  source_type        text not null default 'manual' check (source_type in ('manual', 'ai_approved')),
  created_at         timestamptz not null default now()
  -- closed_at 을 두지 않는다. 열림·닫힘은 card_outcomes 에서 파생한다.
);

create index cards_case_kind_idx on cards (case_id, kind);
create index cards_source_session_idx on cards (source_session_id);

-- 회차별 카드 결과. append-only.
create table card_outcomes (
  id          bigint generated always as identity primary key,
  card_id     bigint not null references cards (id) on delete cascade,
  session_id  bigint not null references sessions (id) on delete cascade,
  result      text not null check (result in ('done', 'in_progress', 'not_done', 'confirmed', 'unchecked')),
  follow      text check (follow in ('continue', 'stop')),
  reason      text,
  note        text,
  created_at  timestamptz not null default now(),
  unique (card_id, session_id),
  constraint not_done_needs_follow check (result <> 'not_done' or follow is not null),
  constraint stop_needs_reason check (follow is distinct from 'stop' or reason is not null)
);

create index card_outcomes_session_idx on card_outcomes (session_id);

-- 전체 상담 목표 문구 이력. append-only. 마지막 행이 현재 값이며 지난 회차 기록을 소급 변경하지 않는다.
create table goal_revisions (
  id          bigint generated always as identity primary key,
  case_id     bigint not null references support_cases (id) on delete cascade,
  text        text,
  changed_by  bigint references users (id),
  created_at  timestamptz not null default now()
);

-- 상담 종결. 마지막 상담에 붙는 확인 절차이자 기록이며 상담 회차가 아니다. 사례당 하나.
create table case_closures (
  id               bigint generated always as identity primary key,
  case_id          bigint not null unique references support_cases (id) on delete cascade,
  last_session_id  bigint references sessions (id),
  closed_at        timestamptz not null default now(),
  close_reason     text not null,
  unfinished_note  text,
  created_by       bigint references users (id)
);

create function relayer_forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table: %', tg_table_name;
end;
$$;

create trigger card_outcomes_append_only
  before update or delete on card_outcomes
  for each statement execute function relayer_forbid_mutation();

create trigger goal_revisions_append_only
  before update or delete on goal_revisions
  for each statement execute function relayer_forbid_mutation();
