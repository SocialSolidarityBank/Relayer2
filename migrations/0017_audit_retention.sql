-- 열람 기록 보관기간 3년(2026-09-16 Q · docs/audit-view.md).
--
-- 지금까지 `audit_log` 는 update·delete 를 통째로 막았다. 그래서 기한이 지나도 지울 수 없었고,
-- 정리하려면 잠금을 손으로 풀어야 했다(`scripts/purge-test-data.mjs`). 잠금을 푸는 절차가
-- 상시로 필요한 순간, 그 잠금은 이미 잠금이 아니다.
--
-- 그래서 규칙을 좁힌다: **고치는 것은 여전히 못 하고, 지우는 것은 3년이 지난 줄만 된다.**
-- 사고는 늦게 발견된다 — 기록(음성·문서 1년)은 지워도 누가 봤는지는 남긴다.

create or replace function relayer_audit_retention() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'append-only table: audit_log';
  end if;
  -- delete: 기한이 지난 줄만. 오늘 것을 지우려는 시도는 사고이거나 은폐다.
  if old.at > now() - interval '3 years' then
    raise exception 'audit_log: 3년이 지나야 지울 수 있어요 (at=%)', old.at;
  end if;
  return old;
end;
$$;

drop trigger if exists audit_log_append_only on audit_log;

create trigger audit_log_retention
  before update or delete on audit_log
  for each row execute function relayer_audit_retention();
