-- 기존 배포 판정 보정(2026-09-18 QA). 0025 는 기관 이름이 있는 배포만 "마법사를 지난 것"으로 봤다.
-- 그런데 #36 이전에 시드·운영된 DB 는 이름이 비어 있어도 관리자·실무자·사례가 이미 있다 — 그 배포에서
-- 실무자는 `기관 준비 중`에, 관리자는 마법사에 갇혔다(beta-flow e2e 2건 실패의 원인).
-- 관리자가 있으면 이미 돌아가는 기관이다. 이름은 관리자가 기관 정보에서 채운다.
update organization set onboarded_at = now()
where onboarded_at is null and exists (select 1 from users where role = 'admin');
