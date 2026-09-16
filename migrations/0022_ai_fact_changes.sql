-- 회차간 사실관계 변화(2026-09-16 Q). 지난 회차에 적힌 것과 이번 회차에 적힌 것이 다르면
-- 모델이 **양쪽 원문**을 붙여 낸다. 판정하지 않는다 — 당사자가 번복했을 수 있다.
-- 초안 행에 붙는 칸이라 승인 게이트도 같다.
alter table ai_drafts add column fact_changes jsonb not null default '[]'::jsonb;
