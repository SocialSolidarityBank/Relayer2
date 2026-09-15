-- 음성 경로(P4). 순서가 곧 규칙이다.
--   녹음 동의 → 녹음 → 보유기간 고지 → STT 동의 → 가림 → 전사 → 사람이 확인해야 기록
--
-- **음성 원본은 기관 안에만 둔다.** DB 에 바이트를 넣지 않는다 — 백업·복제본이 사방으로 퍼진다.
-- 파일은 기관 디스크에 두고 여기에는 어디에 있는지와 언제 지울지만 적는다.
create table recordings (
  id             bigint generated always as identity primary key,
  session_id     bigint not null references sessions (id) on delete cascade,
  -- 기관 디스크의 상대 경로. 절대 경로를 넣지 않는다(기기를 옮기면 전부 깨진다).
  rel_path       text not null,
  bytes          bigint not null check (bytes > 0),
  -- 같은 파일을 두 번 올리지 않게, 그리고 바뀌지 않았음을 확인하려고 둔다.
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_ms    integer check (duration_ms > 0),
  -- 언제 지워야 하는가. 동의한 보유기간에서 계산해 **처음부터 박아 둔다**.
  -- 나중에 세겠다고 미루면 지울 때가 와도 아무도 모른다.
  delete_after   timestamptz not null,
  -- 지운 뒤에도 행은 남는다. "있었는데 지웠다"와 "처음부터 없었다"는 다른 사실이다.
  deleted_at     timestamptz,
  created_by     bigint references users (id),
  created_at     timestamptz not null default now()
);

create index recordings_session_idx on recordings (session_id, id desc);
-- 지울 것을 찾는 질의. 아직 안 지운 것 중 기한이 지난 것.
create index recordings_sweep_idx on recordings (delete_after) where deleted_at is null;

-- 전사문. AI 초안과 같은 규칙이다 — append-only 이고, 사람이 확인해야 기록이 된다.
create table transcripts (
  id             bigint generated always as identity primary key,
  recording_id   bigint not null references recordings (id) on delete cascade,
  session_id     bigint not null references sessions (id) on delete cascade,
  status         text not null check (status in ('draft', 'approved')),
  -- 전사문 본문. 상담 내용이므로 자유 글과 같이 암호화해 넣는다.
  text           text not null,
  -- 무엇을 몇 건 가려 보냈는지. 가린 값은 담지 않는다(AI 경로와 같은 규칙).
  mask_hits      jsonb not null default '{}'::jsonb,
  engine         text,
  approved_by    bigint references users (id),
  created_by     bigint references users (id),
  created_at     timestamptz not null default now()
);

create index transcripts_session_idx on transcripts (session_id, id desc);

create trigger transcripts_append_only
  before update or delete on transcripts
  for each row execute function relayer_forbid_mutation();
