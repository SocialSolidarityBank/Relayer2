-- AI 초안(P3). **승인 전에는 기록이 아니다** — 초안은 초안 표에만 있고 회차 기록을 건드리지 않는다.
create table ai_drafts (
  id             bigint generated always as identity primary key,
  session_id     bigint not null references sessions (id) on delete cascade,
  -- 승인·수정은 새 행을 쌓는다. 마지막 행이 현재 상태다(카드 결과와 같은 규칙).
  status         text not null check (status in ('draft', 'approved')),
  summary        text not null,
  -- 후속 제안은 둘로 나눈다(요구 22): 수행할 과제 / 다음에 물어볼 것.
  tasks          jsonb not null default '[]'::jsonb,
  questions      jsonb not null default '[]'::jsonb,
  -- 무엇을 몇 번 가리고 보냈는지. 값은 담지 않는다.
  mask_hits      jsonb not null default '{}'::jsonb,
  model          text,
  approved_by    bigint references users (id),
  created_by     bigint references users (id),
  created_at     timestamptz not null default now()
);

create index ai_drafts_session_idx on ai_drafts (session_id, id desc);

create trigger ai_drafts_append_only
  before update or delete on ai_drafts
  for each row execute function relayer_forbid_mutation();
