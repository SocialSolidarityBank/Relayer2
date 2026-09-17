-- 온보딩·사업 실체(2026-09-17 Q). 기관은 여전히 한 행이다(PLAN A3) — organizations 표를 만들지 않는다.

-- 기관: 마법사 완료 시각·OpenAI 키 암호문·첫 가입 영구 마감.
-- 주소 이름(slug)은 배포 식별 정보라 DB 가 아니라 환경 변수(RELAYER_SLUG)다 — 앱은 Host 를 읽지 않는다(docs/deploy.md).
alter table organization add column if not exists onboarded_at timestamptz;
alter table organization add column if not exists enc_openai_key text;
-- 첫 가입 문은 한 번 닫히면 영구히 닫힌다. 관리자 수가 사고로 0 이 돼도 다시 열리지 않는다(복구는 DB 절차).
alter table organization add column if not exists bootstrap_closed_at timestamptz;

-- 이미 기관 이름이 있는 배포는 마법사를 지난 것으로, 관리자가 있는 배포는 첫 가입이 끝난 것으로 본다.
update organization set onboarded_at = now() where name <> '' and onboarded_at is null;
update organization set bootstrap_closed_at = now()
where bootstrap_closed_at is null and exists (select 1 from users where role = 'admin');
-- 사업: 기간과 한 줄 설명. ends_on 은 정보용이다 — 지나도 잠기지 않는다(종료는 retired_at).
alter table programs add column if not exists starts_on date;
alter table programs add column if not exists ends_on date;
alter table programs add column if not exists description text;
alter table programs drop constraint if exists programs_period_check;
alter table programs add constraint programs_period_check
  check (starts_on is null or ends_on is null or starts_on <= ends_on);

-- 사례는 이름이 아니라 id 로 사업에 묶인다. 이름을 바꿔도 사례가 설명을 잃지 않는다.
alter table support_cases add column if not exists program_id bigint references programs (id);

-- 백필 1: 목록에 없는 이름은 사업으로 만든다(0016 이후 자유 입력으로 들어온 것).
insert into programs (name)
select distinct program_name from support_cases where program_name <> ''
on conflict (name) do nothing;

-- 백필 2: 빈 이름은 '(미지정)' 사업에 붙인다. 내린 채로 만든다 — 새 등록 선택지에 서지 않는다.
insert into programs (name, retired_at)
select '(미지정)', now() where exists (select 1 from support_cases where program_name = '')
on conflict (name) do update set retired_at = coalesce(programs.retired_at, now());

update support_cases c set program_id = p.id
from programs p
where c.program_id is null
  and p.name = case when c.program_name = '' then '(미지정)' else c.program_name end;

alter table support_cases alter column program_id set not null;
alter table support_cases drop column program_name;
create index if not exists support_cases_program_id on support_cases (program_id);
