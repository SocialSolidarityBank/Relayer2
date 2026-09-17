-- UI 개편 L5 계약(2026-09-18 Q, docs/ui-plan-2026-09-18.md §4).

-- D4 상담 소요시간. 종료 시각은 화면이 계산해 분으로 보낸다 — 컬럼 하나면 된다.
alter table sessions add column duration_min int check (duration_min > 0);

-- D3 회차 리비전 로그. 수기·전사·요약을 고치면 **현재 본문을 갱신하고 새 리비전을 쌓는다**.
-- 원문이 틀린 채 남는 메모 추가 방식은 채택하지 않았다. text 는 자유 글이라 암호문이다(SPEC §12).
create table session_revisions (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references sessions (id) on delete cascade,
  kind        text not null check (kind in ('memo', 'transcript', 'summary')),
  text        text not null,
  actor       bigint references users (id),
  created_at  timestamptz not null default now()
);
create index session_revisions_session_idx on session_revisions (session_id, id);
create trigger session_revisions_append_only
  before update or delete on session_revisions
  for each row execute function relayer_forbid_mutation();

-- D6 동의 문안 DB 화. 관리자가 고치면 새 판(`consent-standard-form-v<N+1>`)으로 행을 쌓는다.
-- 표에 없는 영역은 코드 정본(consent.ts)이 그대로 문안이다. 해시 규칙은 그대로다(§21-2).
-- label·purpose·provider·retentionDuration 은 코드가 정본이다 — 수신자와 보유기간 값은 화면에서 못 바꾼다.
create table consent_copy (
  id              bigint generated always as identity primary key,
  domain          text not null,
  version         text not null,
  copy            text not null,
  items           jsonb not null,
  purpose_text    text not null,
  retention_text  text not null,
  refusal_text    text not null,
  created_by      bigint references users (id),
  created_at      timestamptz not null default now(),
  unique (domain, version)
);
create trigger consent_copy_append_only
  before update or delete on consent_copy
  for each row execute function relayer_forbid_mutation();
