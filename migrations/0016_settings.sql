-- 설정하기(2026-09-16 Q). 공통·관리자·실무자 세 묶음이 쓰는 표들.
--
-- 이름 규율: 화면의 `담당자` 표기는 전부 `실무자`다(GLOSSARY 요구 17). 여기 컬럼도 그 말을 쓴다.

-- 내 정보 — 로그인 아이디(email)는 바꾸지 않는다. 확인만 한다.
-- 연락처와 연락 이메일은 따로 둔다: 로그인 아이디가 이메일 꼴이 아닐 수 있고(지금 `test2`),
-- 초대·알림을 보낼 곳과 로그인하는 이름은 다른 것이다.
alter table users add column if not exists phone text;
alter table users add column if not exists contact_email text;

-- 기관 정보. 한 워크스페이스에 하나뿐이라 단일 행으로 둔다 —
-- 여러 기관을 담는 순간 모든 조회에 기관 열쇠가 붙어야 하고, 베타가 그것을 증명할 필요는 없다.
create table if not exists organization (
  id          int primary key default 1 check (id = 1),
  name        text not null default '',
  reg_no      text,
  address     text,
  phone       text,
  updated_at  timestamptz not null default now(),
  updated_by  bigint references users (id)
);
insert into organization (id, name) values (1, '') on conflict do nothing;

-- 사업 목록. 당사자 등록에서 **고르기만** 한다(2026-09-16 Q) —
-- 자유 입력이면 `함께온기금 울타리대출`과 `함께온기금울타리대출`이 다른 사업으로 갈린다.
create table if not exists programs (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

-- 이미 쌓인 사례의 사업 이름을 목록으로 옮긴다. 지금 있는 것이 곧 정본이다.
insert into programs (name)
select distinct program_name from support_cases
where program_name <> '' on conflict do nothing;

-- 실무자 초대. 링크를 만들어 건네면 그 사람이 워크스페이스에 들어온다.
-- 토큰은 해시로만 둔다 — 표를 읽어도 링크를 되살릴 수 없다(당사자 열람 링크와 같은 규율).
create table if not exists invites (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique,
  role        text not null check (role in ('worker', 'admin')),
  note        text,
  created_by  bigint not null references users (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by bigint references users (id),
  revoked_at  timestamptz
);

-- 실무자 배정 요청. 실무자가 "이 사람 제가 맡겠습니다"라고 손을 든다.
-- 배정 자체는 관리자가 확정해야 효력이 생긴다(GLOSSARY 배정 규칙) — 요청은 요청일 뿐이다.
create table if not exists assignment_requests (
  id            bigint generated always as identity primary key,
  case_id       bigint not null references support_cases (id) on delete cascade,
  requested_by  bigint not null references users (id),
  reason        text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    bigint references users (id),
  decision      text check (decision in ('approved', 'rejected'))
);

-- 한 사례에 대기 중인 요청은 하나뿐이다. 같은 사람이 두 번 눌러도 하나로 남는다.
create unique index if not exists assignment_requests_pending
  on assignment_requests (case_id) where decided_at is null;
