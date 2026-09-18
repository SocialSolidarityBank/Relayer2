// 셸 공용 16px 단색 라인 아이콘. `currentColor` 라 활성 메뉴에서 글자와 같이 물든다.
//
// CCC-new `apps/web/app/components/wire/shell-icons.tsx` 에서 **현재 릴레이어 화면이 쓰는
// 글리프만** 가져왔다(2026-09-17 Q "지난 CCC-new 레포에서 채용"). path 값은 그대로다 —
// 아이콘을 새로 그리면 같은 뜻의 글리프가 제품마다 갈린다.
// 아직 안 쓰는 CCC 글리프(`calendar`·`updown`·`share`)는 그 파일에 있다.
// 필요해지면 새로 그리지 말고 거기서 가져온다.

export type ShellIconName =
  | 'upcoming'
  | 'calendar-plus'
  | 'record'
  | 'participants'
  | 'participant-add'
  | 'invite'
  | 'org'
  | 'settings'
  | 'logout'
  | 'theme-dark'
  | 'theme-light'
  | 'sidebar'
  | 'close';

export function NavIcon({ name }: { name: ShellIconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (name) {
    // 다가오는 일정 = 시계. 달력(등록)과 갈라 읽힌다.
    case 'upcoming':
      return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
    // 일정 등록은 달력 안에 더하기를 얹는다 — 당사자 목록(사람)과 당사자 등록(사람+더하기)이
    // 쓰던 어휘를 그대로 따라, 같은 대상의 보기와 등록을 더하기 유무로 가른다(CCC 2026-09-09 Q).
    case 'calendar-plus':
      return <svg {...common}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /><path d="M8 8.75v3.5M6.25 10.5h3.5" /></svg>;
    // 상담 기록하기는 쓰는 행동이라 펜이다(CCC 2026-09-09 Q).
    case 'record':
      return <svg {...common}><path d="M11.1 2.6a1.6 1.6 0 0 1 2.3 2.3L6.6 11.7 3.5 12.5l.8-3.1z" /><path d="M9.9 3.8l2.3 2.3" /></svg>;
    case 'participants':
      return <svg {...common}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></svg>;
    case 'participant-add':
      return <svg {...common}><circle cx="6.5" cy="5.5" r="2.5" /><path d="M2 13.5c0-2.3 2-3.8 4.5-3.8" /><path d="M11.5 9.5v4.5M9.25 11.75h4.5" /></svg>;
    // 건네는 링크(고리 두 개). CCC 는 실무자 초대에 이 글리프를 쓴다.
    case 'invite':
      return <svg {...common}><path d="M6.4 9.6 9.6 6.4" /><path d="M8.6 4.9 10 3.5a2.5 2.5 0 0 1 3.5 3.5l-1.4 1.4" /><path d="M7.4 11.1 6 12.5A2.5 2.5 0 0 1 2.5 9l1.4-1.4" /></svg>;
    case 'org':
      return <svg {...common}><path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z" /></svg>;
    // 설정은 톱니(원+방사선)가 아니라 **슬라이더**다(CCC 2026-08-02) — 방사선 톱니는 16px 에서
    // 해(라이트) 아이콘과 같은 모양으로 렌더돼 테마 버튼과 겹쳐 보였다.
    case 'settings':
      return <svg {...common}><path d="M2.5 4.5h5.2M12.3 4.5h1.2M2.5 11.5h1.2M7.3 11.5h6.2" /><circle cx="10.2" cy="4.5" r="1.9" /><circle cx="5.4" cy="11.5" r="1.9" /></svg>;
    case 'logout':
      return <svg {...common}><path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6M10.5 11L14 8l-3.5-3M14 8H6" /></svg>;
    // 테마 아이콘은 **가는 곳**을 가리킨다(현재 상태가 아니라). 라이트일 때 달이 뜨고,
    // 누르면 어두워진다. 현재 상태는 `aria-pressed` 가 알린다.
    case 'theme-dark':
      return <svg {...common}><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" /></svg>;
    case 'theme-light':
      return <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" /></svg>;
    // 사이드바 패널(CCC 2026-08-05 Q 2차 — 모바일 바 우측 원형 메뉴 버튼. 햄버거 대체:
    // "원형 버튼 안에 사이드바 아이콘". Infisical 의 panel-left 글리프와 같은 어휘).
    case 'sidebar':
      return <svg {...common}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6.2 2.5v11" /></svg>;
    // 모달 닫기 X(CCC 글리프 그대로 — 대각선 두 획).
    case 'close':
      return <svg {...common}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
  }
}
