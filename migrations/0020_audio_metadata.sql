-- 저장된 음성의 실제 컨테이너를 재생·전사에 함께 쓴다.
-- 0020 전 녹음 API 는 WAV 만 받았으므로 옛 행은 WAV 로 안전하게 이관한다.
alter table recordings
  add column content_type text;

update recordings
set content_type = 'audio/wav'
where content_type is null;

alter table recordings
  alter column content_type set not null;

alter table recordings
  add constraint recordings_content_type_check
  check (content_type in (
    'audio/wav',
    'audio/mpeg',
    'audio/mp4',
    'audio/flac',
    'audio/ogg',
    'audio/webm'
  ));

-- 전사 근거 조각(offset/duration 포함)은 본문과 같은 상담 내용이다.
-- JSON 을 그대로 두지 않고 애플리케이션에서 암호화한 문자열만 저장한다.
alter table transcripts
  add column segments text;
