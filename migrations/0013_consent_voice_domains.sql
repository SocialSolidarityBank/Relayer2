-- 정본의 여섯 영역을 전부 허용한다(CCC `S7-consent-six-domains.md`).
-- 셋은 P4 음성 경로가 쓴다 — 상담 녹음 · 외부 STT 처리 · 음성 원본 보유기간.
--
-- 제약을 목록으로 두는 이유: 오타나 옛 별칭(`recordingAi`, `textAi`)이 사건으로 들어오면
-- 동의 계산이 조용히 어긋난다. 정본이 허용하는 여섯 개만 받는다.
alter table consent_events drop constraint consent_events_domain_check;
alter table consent_events add constraint consent_events_domain_check check (
  domain in (
    'personal_data_collection_use',
    'sensitive_information_processing',
    'counseling_recording',
    'external_stt_processing',
    'external_llm_cross_border_processing',
    'voice_original_retention_period'
  )
);
