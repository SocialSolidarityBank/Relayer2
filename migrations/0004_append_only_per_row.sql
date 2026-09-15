-- append-only 를 문장이 아니라 **행**에서 막는다.
-- 문장 단위 트리거는 지울 행이 하나도 없어도 발동한다. 인테이크를 고쳐 쓸 때
-- 결과가 없는 카드를 지우면 cascade 가 card_outcomes 에 DELETE 문을 흘려보내는데,
-- 지워질 행이 없는데도 예외가 났다. 행 단위면 실제로 지워지는 결과가 있을 때만 막는다.
drop trigger if exists card_outcomes_append_only on card_outcomes;
drop trigger if exists goal_revisions_append_only on goal_revisions;

create trigger card_outcomes_append_only
  before update or delete on card_outcomes
  for each row execute function relayer_forbid_mutation();

create trigger goal_revisions_append_only
  before update or delete on goal_revisions
  for each row execute function relayer_forbid_mutation();
