-- 서면 문서(2026-09-16 Q). 상담 중 받은 종이·파일을 사례에 붙인다.
--
-- 음성과 같은 규칙이다. **바이트를 DB 에 넣지 않는다** — 백업·복제본이 사방으로 퍼진다.
-- 파일은 기관 디스크에 두고 여기에는 어디에 있는지·언제 지울지·누가 올렸는지만 적는다.
--
-- 음성보다 위험하다. 채무 내역서·진단서·등본이 통째로 들어온다. 그래서
-- `document_attachment` 동의를 따로 받고, 내려받을 때마다 감사에 남긴다.
create table documents (
  id             bigint generated always as identity primary key,
  case_id        bigint not null references support_cases (id) on delete cascade,
  -- 어느 회차에서 받았는지. 인테이크에서 받으면 그 회차가 붙는다. 회차 없이 받을 수도 있다.
  session_id     bigint references sessions (id) on delete set null,
  -- 사람이 붙인 이름. 원본 파일명은 그 자체로 정보가 새므로(예: 김민희_진단서.pdf) 쓰지 않는다.
  label          text not null check (length(label) between 1 and 200),
  rel_path       text not null,
  bytes          bigint not null check (bytes > 0),
  content_type   text not null,
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- 지울 날. 동의한 보유기간에서 계산해 **처음부터 박아 둔다**.
  delete_after   timestamptz not null,
  -- 지운 뒤에도 행은 남는다. "있었는데 지웠다"와 "처음부터 없었다"는 다른 사실이다.
  deleted_at     timestamptz,
  created_by     bigint references users (id),
  created_at     timestamptz not null default now()
);

create index documents_case_idx on documents (case_id, id desc);
create index documents_sweep_idx on documents (delete_after) where deleted_at is null;

-- 문서 첨부 동의를 허용 목록에 더한다. 정본 여섯 영역 밖이다(2026-09-16 Q 확정).
alter table consent_events drop constraint consent_events_domain_check;
alter table consent_events add constraint consent_events_domain_check check (
  domain in (
    'personal_data_collection_use',
    'sensitive_information_processing',
    'counseling_recording',
    'external_stt_processing',
    'external_llm_cross_border_processing',
    'voice_original_retention_period',
    'document_attachment'
  )
);
