-- 열람 기록(P1). 정본 규칙: **PII 를 실은 화면 조회 1건 = 감사 1행**,
-- 실제로 실은 항목을 그 행의 fields 에 담는다(CCC D24·D14, DESIGN-RULES §당사자 정보).
-- 행을 쪼개지 않는 이유는 "누가 누구 것을 언제 봤나"를 한 줄로 읽기 위해서다.
create table audit_log (
  id              bigint generated always as identity primary key,
  actor_id        bigint references users (id),
  action          text not null,
  participant_id  bigint references participants (id) on delete set null,
  case_id         bigint references support_cases (id) on delete set null,
  -- 실은 PII 항목 이름만 남긴다. 값은 절대 남기지 않는다.
  fields          text[] not null default '{}',
  at              timestamptz not null default now()
);

create index audit_log_at_idx on audit_log (at desc);
create index audit_log_participant_idx on audit_log (participant_id, at desc);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function relayer_forbid_mutation();
