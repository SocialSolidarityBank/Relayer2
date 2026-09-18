-- 사례 기억(2026-09-18 Q). 사례당 한 행. 승인된(status=done) 회차 전체를 마스킹해 외부 LLM 이 요약한 것으로,
-- 초안 생성이 지난 회차 전량 대신 읽는 **캐시**다. 언제든 같은 절차로 다시 만들 수 있고 사람이 승인하지 않는다 —
-- 기록이 아니다(초안과 같은 비공식 지위). 사례가 지워지면 따라 지워진다.
--
-- 이력 표를 두지 않는다. 언제 무엇으로 만들었는지는 audit_log 의 `ai.memory` 사건이 남긴다.
create table case_memories (
  case_id      bigint primary key references support_cases (id) on delete cascade,
  -- 기억 본문. 자리표만 있고 원문 없음. encryptText 로 감싼다(memo·cards 와 같은 규율).
  enc_text     text not null,
  -- 접어 넣은 마지막 회차 seq. 초안은 "이번 회차 직전 done seq" 와 정확히 같을 때만 이 기억을 쓴다.
  through_seq  int not null,
  -- 근거 참조 [{session_id, seq, card_ids[]}]. id 만 담으므로 평문. 화면은 아직 없다 — 데이터 계약만.
  refs         jsonb not null default '[]'::jsonb,
  mask_hits    jsonb not null default '{}'::jsonb,
  model        text not null,
  created_by   bigint references users (id),
  updated_at   timestamptz not null default now()
);
