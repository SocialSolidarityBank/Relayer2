-- 자동 전사(2026-09-16 Q). 녹음이 올라오면 서버가 뒤에서 바로 전사한다.
-- 진행 상태는 **녹음 행**이 갖는다 — transcripts 는 append-only 라 상태를 고칠 수 없고,
-- 초안이 아직 없는 "전사 중"·"실패"·"동의 없어 건너뜀"은 전사문 행이 아니기 때문이다.
--   pending  전사 중(응답은 이미 나갔다)
--   done     초안이 transcripts 에 쌓였다
--   failed   제공자 오류·프로세스 재시작. 수동 전사하기로 다시 돌린다
--   skipped  외부 STT 동의가 없어 보내지 않았다
alter table recordings
  add column transcribe_state text not null default 'skipped'
    check (transcribe_state in ('pending', 'done', 'failed', 'skipped')),
  add column transcribe_note text;

-- 이미 전사문이 있는 녹음은 done. 나머지는 자동 전사 이전 물건이라 skipped 로 둔다 —
-- 실패한 적 없는 것을 failed 라고 적지 않는다.
update recordings r set transcribe_state = 'done'
  where exists (select 1 from transcripts t where t.recording_id = r.id);
