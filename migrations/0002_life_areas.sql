-- 생활 영역을 국가 표준 욕구영역 10종 + 기타로 교체한다(2026-09-14 조사).
-- 근거: 2024 희망복지지원단 업무안내 통합사례관리 욕구사정 10영역
--       (안전·건강·일상생활유지·가족관계·사회적관계·경제·교육·고용·생활환경·법률및권익보장).
--       민간 기관도 희망이음에서 같은 분류를 쓰며, 공공 행복e음과 의뢰·통계가 구조적으로 호환된다.
-- 범용 사례관리 도구이므로 영역 분류는 발명하지 않고 표준을 따른다.
-- 구 값은 표준 키로 옮긴다. mental_health 는 표준에서 건강에 포함되고, care 는 가족관계에 포함된다.

-- 제약을 먼저 푼 뒤 값을 옮긴다. 반대 순서면 새 키가 옛 제약에 걸린다.
alter table cards drop constraint cards_area_check;

update cards set area = 'health'      where area = 'mental_health';
update cards set area = 'family'      where area = 'care';
update cards set area = 'living_env'  where area = 'housing';

alter table cards add constraint cards_area_check check (
  area in ('safety', 'health', 'daily_living', 'family', 'social',
           'economy', 'education', 'employment', 'living_env', 'legal', 'other')
);
