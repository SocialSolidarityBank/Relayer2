-- 가명 번호는 세지 않고 뽑는다(2026-09-16 버그).
--
-- `nextPseudonym` 이 `count(*) + 1` 로 번호를 만들었다. 당사자를 지우면 그 수가 줄어
-- **이미 쓴 가명이 다시 나오고**, `participants_pseudonym_key` 에 걸려 당사자 등록이
-- 500 으로 죽는다. 오늘 시험 데이터 142건을 지우고 정확히 그 일이 일어났다.
--
-- 세는 것과 번호 매기는 것은 다른 일이다. 시퀀스는 뒤로 가지 않는다.

create sequence if not exists participant_seq;

-- 이미 쓴 가명보다 뒤에서 시작한다. 가명 꼴은 `otter-001` 이라 뒤 숫자를 읽는다.
select setval(
  'participant_seq',
  greatest((select count(*) from participants),
           coalesce((select max(substring(pseudonym from '[0-9]+$')::int) from participants), 0)) + 1,
  false
);
