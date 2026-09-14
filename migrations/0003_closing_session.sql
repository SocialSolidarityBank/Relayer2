-- 종결 상담(요구 5). 이 회차를 저장하면 상담 종결 화면으로 간다.
-- 회차 종류(kind)를 늘리지 않는다 — 종결 상담도 평범한 상담이고, 종결 자체는 case_closures 가 맡는다.
alter table sessions add column if not exists is_closing boolean not null default false;
