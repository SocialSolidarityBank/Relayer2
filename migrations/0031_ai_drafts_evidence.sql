-- 항목별 근거와 놓친 구간(2026-09-18 Q "하이라이터의 기준을 맥락으로").
-- evidence: 모델이 changes·tasks·questions 항목마다 그 항목을 낳은 원문 문장(quotes)과 앞뒤 맥락(context)을
--   **자료에 적힌 그대로** 붙여 낸다. 등급(완전·부분·정황·과잉·모순·없음)과 변환 유형도 함께.
--   서버가 인용이 자료에 문자열 그대로 있는지 확인하고, 없는 인용은 버린다 — 지어낸 인용은 화면에 못 오른다.
-- omissions: 역방향 점검 — 어떤 항목에도 쓰이지 않은 자료 구간(상·중은 낱개, 하는 건수 omitted_minor_count).
-- 초안 행에 붙는 칸이라 승인 게이트도 같다. 승인 행은 초안의 값을 그대로 옮긴다.
alter table ai_drafts add column evidence jsonb not null default '[]'::jsonb;
alter table ai_drafts add column omissions jsonb not null default '[]'::jsonb;
alter table ai_drafts add column omitted_minor_count integer not null default 0;
