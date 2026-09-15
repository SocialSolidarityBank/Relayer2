-- 당사자 열람(P2). 당사자는 **로그인하지 않는다** — 실무자가 준 링크와 코드로 연다(GLOSSARY §3).
-- 링크(token)는 주소에 실려 유출될 수 있으므로 코드가 두 번째 자물쇠다. 코드는 해시로만 둔다.
create table participant_access (
  id              bigint generated always as identity primary key,
  participant_id  bigint not null references participants (id) on delete cascade,
  -- 주소에 실리는 값. 무작위 32바이트 base64url.
  token           text not null unique,
  -- 여섯 자리 숫자 코드의 해시(Argon2id). 원문은 발급 화면에서 한 번만 보여 준다.
  code_hash       text not null,
  expires_at      timestamptz not null,
  -- 다 쓰면 잠근다. 무한 시도로 코드를 맞히지 못하게 한다.
  attempts_left   int not null default 5,
  revoked_at      timestamptz,
  last_opened_at  timestamptz,
  created_by      bigint references users (id),
  created_at      timestamptz not null default now()
);

create index participant_access_participant_idx on participant_access (participant_id, created_at desc);
