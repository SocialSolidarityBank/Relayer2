-- 외부 LLM·국외 처리 동의(P3). 정본 여섯 영역 중 셋째를 연다.
-- 수신자(OpenAI, US)가 문안 해시에 묶이므로 수신자가 바뀌면 동의를 다시 받게 된다.
alter table consent_events drop constraint consent_events_domain_check;
alter table consent_events add constraint consent_events_domain_check check (
  domain in (
    'personal_data_collection_use',
    'sensitive_information_processing',
    'external_llm_cross_border_processing'
  )
);
