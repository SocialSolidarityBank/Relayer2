-- 인테이크·기록 화면의 상담 방식에 '기타(이메일, SNS 등)'가 생겼다(2026-09-16 수정 요청).
-- 'visit' 은 옛 행에 남아 있으므로 지우지 않고 목록에 'other' 만 더한다.
alter table sessions drop constraint sessions_method_check;

alter table sessions
  add constraint sessions_method_check
  check (method in ('in_person', 'phone', 'video', 'visit', 'other'));
