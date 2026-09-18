-- 마법사 재진입(2026-09-18 QA P2 #9). 관리자가 중간에 나갔다 돌아오면 서 있던 단계에서 다시 선다.
-- 진행 상태를 데이터에서 유추하지 않는다(사업 수·초대 수는 건너뛸 수 있어 단계와 1:1 이 아니다) — 단계 번호 하나를 적는다.
-- 0 기관 워크스페이스 · 1 기관 정보 · 2 사업 · 3 실무자 초대 · 4 외부 서비스 연결. 완료(onboarded_at) 뒤에는 읽지 않는다.
alter table organization add column onboarding_step smallint not null default 0
  check (onboarding_step between 0 and 4);
