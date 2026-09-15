-- 동의 사건(P1). 정본: CCC docs/specs/S7-consent-six-domains.md.
-- 현재 상태를 컬럼으로 들고 있지 않는다 — 사건을 접어 계산한다. 그래서 append-only 다.
create table consent_events (
  id              bigint generated always as identity primary key,
  participant_id  bigint not null references participants (id) on delete cascade,
  case_id         bigint references support_cases (id) on delete cascade,
  domain          text not null check (domain in ('personal_data_collection_use', 'sensitive_information_processing')),
  decision        text not null check (decision in ('grant', 'withdraw', 'decline')),
  purpose         text not null,
  copy_version    text not null,
  -- 소문자 hex 64 자. 문안이 바뀌면 해시가 달라지고 지난 동의는 자동 승격되지 않는다.
  copy_hash       text not null check (copy_hash ~ '^[0-9a-f]{64}$'),
  effective_at    timestamptz not null,
  recorded_by     bigint references users (id),
  recorded_at     timestamptz not null default now()
);

create index consent_events_scope_idx on consent_events (participant_id, domain, id);

create trigger consent_events_append_only
  before update or delete on consent_events
  for each row execute function relayer_forbid_mutation();
