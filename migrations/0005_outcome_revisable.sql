-- 같은 회차의 결과를 고쳐 쓸 수 있게 한다(2026-09-15 Q "2회차 저장했는데 수정하고 싶다").
-- 지우거나 덮어쓰지 않는다 — append-only 는 그대로 두고, 같은 (카드, 회차) 에 새 행을 쌓아
-- **마지막 행이 유효**하게 읽는다. 잘못 누른 것도 기록에 남는다.
alter table card_outcomes drop constraint if exists card_outcomes_card_id_session_id_key;
create index if not exists card_outcomes_card_session_idx on card_outcomes (card_id, session_id, id);
