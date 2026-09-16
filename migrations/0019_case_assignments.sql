-- 공동 배정(2026-09-16 Q). 한 사례를 실무자 여럿이 함께 맡을 수 있고,
-- **맡은 사람만 그 사례의 상담 자료를 연다 — 관리자도 예외가 없다.**
--
-- `support_cases.assigned_user_id` 는 한 사람만 담는다. 여럿이 맡는 것과
-- 명시적 해제를 표현하지 못해 `case_assignments` 로 갈아 끼운다.

create table case_assignments (
  case_id      bigint not null references support_cases (id) on delete cascade,
  user_id      bigint not null references users (id),
  -- 누가 배정했는가. 이전 단일 컬럼에서 옮겨 온 행은 누가 배정했는지 기록이 없어 null 이다.
  assigned_by  bigint references users (id),
  assigned_at  timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index case_assignments_user_idx on case_assignments (user_id);

-- 기존 단일 배정을 그대로 옮긴다. 배정이 없던 사례는 건드리지 않는다 —
-- 없던 배정을 임의로 만들어 주는 일은 없다.
insert into case_assignments (case_id, user_id)
select id, assigned_user_id from support_cases where assigned_user_id is not null;

alter table support_cases drop column assigned_user_id;

-- 한 사례에 대기 중인 요청은 사람마다 하나다. 다른 실무자의 요청이 서로를 막지 않는다.
drop index if exists assignment_requests_pending;
create unique index assignment_requests_pending
  on assignment_requests (case_id, requested_by) where decided_at is null;

-- 당사자 열람 링크가 어느 사례에서 나왔는지 박는다.
-- 안 박으면 링크가 그 당사자의 **다른 사례** 일정까지 보여 준다 — 발급한 실무자가
-- 맡지 않은 사례의 일정이 새는 뒷문이다. null 이면 일정을 내지 않는다.
alter table participant_access add column case_id bigint references support_cases (id) on delete cascade;

-- 이미 있는 링크도 만든 사람이 맡았던 사례 하나에만 묶는다.
-- 그런 사례가 없으면 null — 다른 사례 일정을 고르는 것보다 일정 없이 여는 쪽이 안전하다.
update participant_access pa
set case_id = (
  select c.id from support_cases c
  where c.participant_id = pa.participant_id
    and exists (
      select 1 from case_assignments a
      where a.case_id = c.id and a.user_id = pa.created_by
    )
  order by (c.status = 'open') desc, c.opened_at desc limit 1
);

-- 권한 있는 발급 사례를 찾지 못한 옛 링크는 기본정보도 열어서는 안 된다.
update participant_access
set revoked_at = now()
where case_id is null and revoked_at is null;
