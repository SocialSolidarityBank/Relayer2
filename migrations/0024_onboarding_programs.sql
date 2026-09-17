-- 온보딩·사업 실체(2026-09-17 Q). 기관은 여전히 한 행이다(PLAN A3) — organizations 표를 만들지 않는다.

-- 기관: 슬러그(서브도메인용 이름 조각)·마법사 완료 시각·OpenAI 키 암호문.
-- 슬러그는 DNS 라벨 규칙을 그대로 쓴다. 앱은 Host 를 읽지 않는다(docs/deploy.md).
alter table organization add column if not exists slug text;
alter table organization drop constraint if exists organization_slug_format;
alter table organization add constraint organization_slug_format
  check (slug is null or slug ~ '^[a-z0-9-]+$');
alter table organization add column if not exists onboarded_at timestamptz;
alter table organization add column if not exists enc_openai_key text;

-- 이미 기관 이름이 있는 배포는 마법사를 지난 것으로 본다. 새 DB 만 첫 가입 → 마법사로 간다.
update organization set onboarded_at = now() where name <> '' and onboarded_at is null;

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
