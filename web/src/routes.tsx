// 베타 라우팅. 화면이 다섯이라 라우터 의존성을 두지 않는다.
// 로그인하지 않았으면 어떤 화면도 열지 않는다.
import { useEffect, useState } from 'react';
import { applyTheme, followSystemTheme, initialTheme, setTheme as chooseTheme, type Theme } from './theme.ts';
import { NavIcon, type ShellIconName } from './shell-icons.tsx';
import { getMe, logout, Unauthorized, type Me } from './api.ts';
import { AccessScreen } from './screens/access.tsx';
import { ApiFailureBanner, BackLink } from './ui.tsx';
import { InviteScreen } from './screens/invite.tsx';
import { SettingsScreen, visibleGroups } from './screens/settings.tsx';
import { BriefingScreen } from './screens/briefing.tsx';
import { CloseScreen } from './screens/close.tsx';
import { HomeScreen } from './screens/home.tsx';
import { IntakeScreen } from './screens/intake.tsx';
import { LoginScreen } from './screens/login.tsx';
import { ParticipantNewScreen } from './screens/participant-new.tsx';
import { ParticipantInfoScreen } from './screens/participant-info.tsx';
import { ParticipantsScreen } from './screens/participants.tsx';
import { RecordScreen } from './screens/record.tsx';
import { ReviewScreen } from './screens/review.tsx';
import { ScheduleNewScreen } from './screens/schedule-new.tsx';
import { SessionFullScreen } from './screens/session-full.tsx';

const HOME = '#/schedule';

export function Routes() {
  const [hash, setHash] = useState(window.location.hash || HOME);
  const [me, setMe] = useState<Me | null | 'loading'>('loading');

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || HOME);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // 테마는 화면이 뜨기 전에 한 번, 그 뒤로는 고를 때마다 붙인다.
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => followSystemTheme(setTheme), []);

  useEffect(() => {
    void getMe()
      .then(setMe)
      .catch((e) => setMe(e instanceof Unauthorized ? null : null));
  }, []);

  /**
   * 사례 메뉴는 **마지막으로 연 사례**를 계속 가리킨다.
   *
   * 주소에서만 읽으면 일정 화면에서 메뉴가 사라졌다가 사례에 들어가면 다섯 개가 튀어나온다.
   * 실무자에게는 메뉴가 불안정한 것으로 읽히고, 무엇보다 **사례로 돌아갈 길이 없다**
   * (`PLAN.md` §3 즉석 기록 항목이 남긴 자리).
   *
   * 기억은 화면 안에서만 산다. 새로 고치면 지워진다 — 어느 당사자를 보고 있었는지가
   * 기기에 남을 이유가 없다. 훅은 조건부 return 앞에 둔다.
   */
  const fromHash = hash.match(/^#\/cases\/(\d+)\//)?.[1];
  const [lastCase, setLastCase] = useState<string | undefined>(fromHash);
  useEffect(() => {
    if (fromHash) setLastCase(fromHash);
  }, [fromHash]);
  const caseId = fromHash ?? lastCase;

  // 당사자 열람은 로그인 앞에 선다. 링크와 코드로만 열리고, 실무자 화면과 섞이지 않는다.
  const asParticipant = hash.match(/^#\/access\/([A-Za-z0-9_-]+)$/);
  // 초대장도 로그인 앞이다. 아직 계정이 없는 사람이 보는 화면이라 셸을 씌우지 않는다.
  const invited = hash.match(/^#\/invite\/([A-Za-z0-9_-]+)$/);
  if (invited)
    return (
      <div className="wire-shell">
        <div className="page-content">
          <InviteScreen token={invited[1]} onDone={() => void getMe().then(setMe)} />
        </div>
      </div>
    );

  if (asParticipant)
    return (
      <div className="wire-shell">
        <div className="page-content">
          <AccessScreen token={asParticipant[1]} />
        </div>
      </div>
    );

  if (me === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!me)
    return (
      <div className="wire-shell">
        <div className="page-content">
          <LoginScreen onDone={() => void getMe().then(setMe)} />
        </div>
      </div>
    );

  const screen = (() => {
    if (hash === HOME) return <HomeScreen />;
    if (hash === '#/participants') return <ParticipantsScreen />;
    // 사례를 안 고른 채 상담 기록하기·상담 일정 등록을 누르면 여기로 온다.
    if (hash === '#/pick/record') return <ParticipantsScreen pickFor="record" />;
    if (hash === '#/pick/schedule') return <ParticipantsScreen pickFor="schedule" />;
    // 설정은 묶음 단위다. 낡은 항목 주소로 들어오면 그 항목이 든 묶음으로 보낸다.
    if (hash === '#/settings') { window.location.hash = '#/settings/me'; return null; }
    const inSettings = hash.match(/^#\/settings\/([a-z-]+)$/);
    if (inSettings) return <SettingsScreen module={inSettings[1]} me={me} />;
    if (hash === '#/participants/new') return <ParticipantNewScreen />;

    // 저장해 둔 회차 고쳐 쓰기. 기록 화면을 그대로 쓰되 대상 회차를 준다.
    const editing = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/edit$/);
    if (editing)
      return (
        <RecordScreen
          key={`edit-${editing[2]}`}
          caseId={Number(editing[1])}
          sessionId={Number(editing[2])}
        />
      );

    const reviewing = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/review$/);
    if (reviewing) return <ReviewScreen caseId={Number(reviewing[1])} sessionId={Number(reviewing[2])} />;

    // 수기·음성 전문 보기(2026-09-16 인계). 읽기 전용 — 편집·승인은 기록 화면이 담당한다.
    const full = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/full$/);
    if (full) return <SessionFullScreen caseId={Number(full[1])} sessionId={Number(full[2])} />;

    const byCase = hash.match(/^#\/cases\/(\d+)\/(briefing|record|schedule|intake|info|close)$/);
    if (byCase) {
      const caseId = Number(byCase[1]);
      if (byCase[2] === 'briefing') return <BriefingScreen caseId={caseId} />;
            // `key` 로 갈아 끼운다. 고쳐 쓰기와 새 기록이 같은 부품이라 상태가 새면 남의 회차를 덮는다.
      if (byCase[2] === 'record') return <RecordScreen key={`new-${caseId}`} caseId={caseId} />;
      if (byCase[2] === 'intake') return <IntakeScreen caseId={caseId} />;
      if (byCase[2] === 'info') return <ParticipantInfoScreen caseId={caseId} />;
      if (byCase[2] === 'close') return <CloseScreen caseId={caseId} />;
      return <ScheduleNewScreen caseId={caseId} />;
    }

    window.location.hash = HOME;
    return null;
  })();


  /**
   * 사이드바 셸(2026-09-16 Q "사람들이 헷갈려 한다").
   *
   * 한 줄에 아홉 개가 늘어선 가로 메뉴는 무엇이 무엇의 갈래인지 못 보여 준다.
   * 정본(CCC preview)의 `.app-shell` 3부 — 머리줄·사이드바·본문 — 을 그대로 쓴다.
   * 묶음 라벨과 항목 이름은 Q 가 준 것이다.
   *
   * 일정 묶음의 기록·일정 등록은 사례가 없으면 당사자 선택 화면으로 보낸다.
   * 당사자 정보는 열어 둔 사례가 있을 때만 당사자 묶음에 따라붙는다.
   *
   * 아이콘은 CCC 글리프를 그대로 쓴다(2026-09-17 Q). 같은 대상의 보기와 등록은 더하기
   * 유무로 가른다 — 당사자 목록(사람)·당사자 등록(사람+더하기), 일정 보기(시계)·일정
   * 등록(달력+더하기). 기록은 쓰는 행동이라 펜이다.
   */
  const link = (href: string, label: string, icon: ShellIconName) => (
    <li key={href}>
      <a className="navigation-link" href={href} data-current={hash === href || undefined}>
        <NavIcon name={icon} />
        <span>{label}</span>
      </a>
    </li>
  );

  /**
   * 설정 묶음 메뉴의 아이콘. CCC 관리자 메뉴의 배정(`admin-format.ts`)을 따른다 —
   * 기관은 `org`, 시스템 연결은 `settings`(슬라이더). 사람 글리프가 당사자 목록과 겹치는
   * 것은 CCC 도 그렇다(당사자 목록·사용자·역할) — 묶음 제목이 자리를 구분한다.
   */
  const settingsIcon: Record<string, ShellIconName> = {
    me: 'participants',
    staff: 'invite',
    org: 'org',
    system: 'settings',
  };

  const settingsGroups = visibleGroups(me.role === 'admin');
  const inSettingsArea = hash.startsWith('#/settings');
  /**
   * 하단 설정 버튼은 `시스템` 으로 간다(2026-09-17 Q). 시스템 묶음은 관리자만 보므로
   * 실무자에게는 자기가 볼 수 있는 첫 묶음(내 정보)으로 보낸다 — 못 여는 화면을 가리키는
   * 버튼은 "고장"으로 읽힌다. 주소로 직접 들어오면 설정 화면이 그대로 막는다.
   */
  const settingsHref = `#/settings/${settingsGroups.some((g) => g.key === 'system') ? 'system' : (settingsGroups[0]?.key ?? 'me')}`;
  // 테마 버튼은 **가는 곳**을 말한다(DESIGN.md §9) — 라이트면 달, 다크면 해.
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header-brand">릴레이어</span>
        {/* 계정 행동은 사이드바 하단 세 버튼으로 내렸다(2026-09-17 Q) — 머리줄은 기관·사람
            이름만 갖는다. 로그아웃이 두 자리에 있으면 어느 것이 정본인지 알 수 없다. */}
        <div className="header-actions">
          <span className="app-nav-me">{me.name}</span>
        </div>
      </header>

      <aside className="sidebar">
        <div className="navigation-groups">
          <div className="navigation-group">
            <p className="navigation-section-title">일정</p>
            <ul className="navigation-list">
              {link(caseId ? `#/cases/${caseId}/schedule` : '#/pick/schedule', '상담 일정 등록', 'calendar-plus')}
              {link(HOME, '상담 일정 보기', 'upcoming')}
              {/* 기록하기는 늘 선다. 사례를 안 열었으면 누구 것인지 고르는 자리로 보낸다 —
                  메뉴에서 사라지면 "그 기능이 없다"로 읽힌다. */}
              {link(caseId ? `#/cases/${caseId}/record` : '#/pick/record', '상담 기록하기', 'record')}
            </ul>
          </div>

          <div className="navigation-group">
            <p className="navigation-section-title">당사자</p>
            <ul className="navigation-list">
              {link('#/participants', '당사자 목록', 'participants')}
              {link('#/participants/new', '당사자 등록', 'participant-add')}
              {caseId && link(`#/cases/${caseId}/info`, '당사자 정보', 'participants')}
            </ul>
          </div>

          <div className="navigation-group">
            <p className="navigation-section-title">설정</p>
            <ul className="navigation-list">
              {/* 묶음마다 메뉴 하나다(2026-09-16 Q 3차). 그 페이지에 항목이 곧바로 펼쳐져
                  두 번 누를 일이 없다. 관리자 전용 묶음은 실무자에게 서지 않는다. */}
              {settingsGroups.map((g) =>
                link(`#/settings/${g.key}`, g.title, settingsIcon[g.key] ?? 'settings'),
              )}
            </ul>
          </div>
        </div>

        {/* 계정 행동 세 버튼(2026-09-17 Q — CCC 는 데스크톱 헤더·드로어 상단에 두지만
            릴레이어는 사이드바 하단이다). 옷은 이식한 `.header-icon-button` 32 원형 그대로고
            라벨은 `aria-label`·`title` 이 갖는다. 설정 버튼의 목적지는 위 `settingsHref` 가 정한다. */}
        <div className="sidebar-footer">
          <a
            className="header-icon-button"
            href={settingsHref}
            aria-label="설정"
            title="설정"
            data-current={inSettingsArea || undefined}
            aria-current={inSettingsArea ? 'page' : undefined}
          >
            <NavIcon name="settings" />
          </a>
          <button
            type="button"
            className="header-icon-button"
            aria-label={nextTheme === 'dark' ? '어둡게' : '밝게'}
            title={nextTheme === 'dark' ? '어둡게' : '밝게'}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(chooseTheme(nextTheme))}
          >
            <NavIcon name={nextTheme === 'dark' ? 'theme-dark' : 'theme-light'} />
          </button>
          <button
            type="button"
            className="header-icon-button"
            aria-label="로그아웃"
            title="로그아웃"
            onClick={() => void logout().then(() => setMe(null))}
          >
            <NavIcon name="logout" />
          </button>
        </div>
      </aside>

      {/* 뒤로 가기는 본문 위 한 자리다(정본 .page-backbar). 돌아갈 곳이 없으면 안 그린다. */}
      <div className="content-column">
        <ApiFailureBanner />
        <BackLink />
        <div className="page-content">{screen}</div>
      </div>
    </div>
  );
}
