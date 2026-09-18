-- 기관별 Azure Speech 키와 녹음 스위치. 키는 PII_ENC_KEY 암호문만 저장한다.
-- null 은 배포 환경 변수 폴백을 뜻하며 false 와 구분한다.
alter table organization add column enc_speech_key text;
alter table organization add column voice_enabled boolean;
