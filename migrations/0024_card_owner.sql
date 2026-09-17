-- 과제 수행 주체(2026-09-18 Q — 요구 16 되돌림). 실무자가 "누가 하는 과제인지" 헷갈렸다.
-- 2026-09-13 에 기한(요구 15)과 함께 뺐던 것인데, 묵시적 완료를 만든 건 기한이지 주체가 아니다.
-- 둘 중 하나: 당사자(participant) · 담당 실무자(worker). 기관 3택은 되살리지 않는다.
-- 옛 카드는 전부 당사자 — 추정이 아니라 기본값이다(카드는 원래 당사자 약속이었다).
alter table cards add column owner text not null default 'participant'
  check (owner in ('participant', 'worker'));
