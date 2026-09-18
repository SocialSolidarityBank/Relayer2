-- v6 상담기록 분석(2026-09-18 Q, docs/relayer_v1_handoff.md 부록 01·02·04·별첨).
-- 한 회차의 수기 원본을 문장 span 으로 고정하고 그 위에 01 구조·02 요약·04 전사 연결·키워드를
-- 한 분석 버전으로 얹는다. **현재 회차만** 본다 — 지난 회차·브리핑 자료는 입력에도 결과에도 없다.
--
-- ai_drafts 와 같은 규칙이다: 승인·수정·실패 모두 새 행을 쌓고 **마지막 행이 현재 상태**다.
-- body 는 구조·요약·키워드·링크·불일치를 담은 JSON — 상담 내용이므로 encryptText 암호문이다.
-- source_versions 는 분석이 본 원본 묶음(memo·manual 카드·intake 자유 글·승인 전사)의 해시다.
-- 지금 원본과 하나라도 다르면 stale — 자동 재처리 없이 사람이 `AI 정리 다시 하기`로 새 초안을 만든다.
create table record_analyses (
  id              bigint generated always as identity primary key,
  session_id      bigint not null references sessions (id) on delete cascade,
  status          text not null check (status in ('draft', 'approved', 'failed')),
  schema_version  int not null,
  rule_version    text not null,
  source_versions jsonb not null,
  model           text,
  -- 무엇을 몇 건 가려 보냈는지. 가린 값은 담지 않는다(AI 경로와 같은 규칙).
  mask_hits       jsonb not null default '{}'::jsonb,
  -- encryptText(JSON.stringify(AnalysisBody)). failed 행은 null.
  body            text,
  -- failed 의 사유(사람이 읽는 명사구). 원문·모델 응답은 담지 않는다.
  error           text,
  created_by      bigint references users (id),
  approved_by     bigint references users (id),
  created_at      timestamptz not null default now()
);

create index record_analyses_session_idx on record_analyses (session_id, id desc);

create trigger record_analyses_append_only
  before update or delete on record_analyses
  for each row execute function relayer_forbid_mutation();
