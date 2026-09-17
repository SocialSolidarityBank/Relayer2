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
import { SignupScreen } from './screens/signup.tsx';
import { OnboardingScreen } from './screens/onboarding.tsx';
import { SetupPendingScreen, WorkspaceScreen } from './screens/workspace.tsx';

const HOME = '#/schedule';
/** 세션이 끊긴 사람이 보던 주소. 로그인 뒤 그 자리로 돌아간다(ASTRA 검토 D). 내부 라우트만 담는다. */
const RETURN_TO = 'relayer:returnTo';
const PUBLIC_HASHES = new Set(['', '#', '#/', HOME, '#/login', '#/signup']);
const rememberReturnTo = (h: string) => {
  if (!PUBLIC_HASHES.has(h) && h.startsWith('#/')) sessionStorage.setItem(RETURN_TO, h);
};
const takeReturnTo = (): string | null => {
  const h = sessionStorage.getItem(RETURN_TO);
  sessionStorage.removeItem(RETURN_TO);
  return h && h.startsWith('#/') && !PUBLIC_HASHES.has(h) ? h : null;
};

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
   * 사이드바는 **목록·등록만** 가리킨다(2026-09-18 Q A1). 구 `상담 일정 등록`·`상담 기록하기`
   * 메뉴와 그 뒤의 고르는 화면(`#/pick/*`)은 걷었다 — 한 사람을 가리키는 행동이라 메뉴와 층이
   * 다르고, 당사자 목록 카드가 그 입구다. 카드의 `상담 기록하기`는 늘 일정 예약 화면을 지난다
   * (Q 결정 D1 — 일시를 확인하지 않은 기록을 막는다).
   */

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

  if (me === 'loading') return <p className="empty">불러오는 중</p>;

  /**
   * 로그아웃 상태(2026-09-17 Q·ASTRA). 문은 하나 — **로그인 화면이 곧 랜딩**이다(`/`·`#/login`·홈·깊은 주소 모두).
   * `#/signup` 만 가입 화면. 깊은 주소(세션 끊김)는 그 주소를 적어 두었다가 로그인 뒤 돌아간다.
   * 로그인 응답이 온 뒤 주소를 바꾸는 일은 `afterLogin` 한 곳에서만 한다.
   * 게이트 화면은 `.preview-gate` 가 스스로 `.page-content` 를 갖는다(CCC-new /login 과 같은 문법) — 셸만 씌운다.
   */
  if (!me) {
    const afterLogin = () =>
      void getMe().then((who) => {
        const back = takeReturnTo();
        // 가입·로그인 주소에 머물지 않는다. 돌아갈 곳이 있으면 거기로, 없으면 셸의 가두기 규칙이 도착지를 정한다.
        window.location.hash = back ?? HOME;
        setMe(who);
      });
    if (hash !== '#/signup') rememberReturnTo(hash);
    return (
      <div className="wire-shell">
        {hash === '#/signup' ? <SignupScreen onDone={afterLogin} /> : <LoginScreen onDone={afterLogin} />}
      </div>
    );
  }

  /**
   * 주소 뒤 물음표는 화면의 **첫 상태**를 얹는 자리다(2026-09-17 Q):
   * `#/schedule?case=12`(그 당사자만 보기), `#/cases/12/record?closing=1`(종결 체크 켜고 시작).
   * 경로 자체는 갈라지지 않는다 — 걸개 하나를 얹는 것뿐이라 새 라우트를 만들지 않는다.
   */
  const [path, rawQuery = ''] = hash.split('?');
  const query = new URLSearchParams(rawQuery);

  /**
   * 가두기(2026-09-17 Q·ASTRA). 서버 잠금은 없고 안내용 리다이렉트다.
   * 준비 판정은 `onboarded` 하나다(2026-09-18 QA — 워크스페이스 이름까지 요구하면 #36 이전에 시드된 기존 DB(이름 비어 있음)에서
   * 실무자가 `기관 준비 중`에, 관리자가 마법사에 갇혔다). 이름이 없는 채 마친 기관은 기관 정보에서 채운다.
   * - 관리자: 마법사를 안 마쳤으면 #/onboarding(워크스페이스가 없으면 1단계부터).
   * - 실무자: 마법사가 끝나기 전엔 #/setup-pending(기관 준비 중).
   * - 마쳤는데 마법사·준비 중 주소면 홈으로. 로그인·가입·랜딩 주소도 홈으로.
   */
  const ready = me.onboarded;
  if (!ready && me.role === 'admin' && path !== '#/onboarding') {
    window.location.hash = '#/onboarding';
    return null;
  }
  if (!ready && me.role === 'worker' && path !== '#/setup-pending') {
    window.location.hash = '#/setup-pending';
    return null;
  }
  // 마법사를 마친 직후는 기관 요약(완료 화면)으로 — 완료 핸들러가 `onboarded` 만 바꾸고 주소는 여기서 정한다.
  // 주소와 상태를 따로 바꾸면 그 사이 렌더가 어긋난 조합을 본다(2026-09-17 실측).
  if (ready && path === '#/onboarding') {
    window.location.hash = '#/workspace?done=1';
    return null;
  }
  if (ready && (path === '#/setup-pending' || PUBLIC_HASHES.has(hash)) && path !== HOME) {
    window.location.hash = HOME;
    return null;
  }
  const screen = (() => {
    if (path === HOME) {
      const focus = Number(query.get('case'));
      return <HomeScreen focusCaseId={Number.isFinite(focus) && focus > 0 ? focus : null} />;
    }
    // 0단계·완료 뒤에는 서버에서 `me` 를 다시 읽는다 — 워크스페이스(이름·주소 이름)와 onboarded 를 한 번에 맞춘다.
    if (path === '#/onboarding') {
      const refresh = () => void getMe().then(setMe);
      return <OnboardingScreen me={me} onWorkspace={refresh} onDone={refresh} />;
    }
    if (path === '#/setup-pending') return <SetupPendingScreen me={me} onRefresh={() => void getMe().then(setMe)} />;
    if (path === '#/workspace') return <WorkspaceScreen me={me} justDone={query.get('done') === '1'} />;
    if (path === '#/participants') {
      const programId = Number(query.get('program'));
      return <ParticipantsScreen initialProgramId={Number.isInteger(programId) && programId > 0 ? programId : null} />;
    }
    // 사례를 고르는 자리는 당사자 목록 하나다(2026-09-18 Q A1 — 구 `#/pick/*` 폐지).
    // 설정은 묶음 단위다. 낡은 항목 주소로 들어오면 그 항목이 든 묶음으로 보낸다.
    if (path === '#/settings') { window.location.hash = '#/settings/me'; return null; }
    const inSettings = path.match(/^#\/settings\/([a-z-]+)$/);
    if (inSettings) return <SettingsScreen module={inSettings[1]} me={me} />;
    if (path === '#/participants/new') return <ParticipantNewScreen />;

    // 저장해 둔 회차 수정. 기록 화면을 그대로 쓰되 대상 회차를 준다.
    const editing = path.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/edit$/);
    if (editing)
      return (
        <RecordScreen
          key={`edit-${editing[2]}`}
          caseId={Number(editing[1])}
          sessionId={Number(editing[2])}
        />
      );

    const reviewing = path.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/review$/);
    if (reviewing) return <ReviewScreen caseId={Number(reviewing[1])} sessionId={Number(reviewing[2])} />;

    // 목표 탭 직행(2026-09-18 UI-9). 기록 화면의 목표 카드 `수정`이 여기로 온다.
    const goals = path.match(/^#\/cases\/(\d+)\/info\/goals$/);
    if (goals) return <ParticipantInfoScreen caseId={Number(goals[1])} initialTab="목표" />;

    const byCase = path.match(/^#\/cases\/(\d+)\/(record|schedule|intake|info|close)$/);
    if (byCase) {
      const caseId = Number(byCase[1]);
            // `key` 로 갈아 끼운다. 수정과 새 기록이 같은 부품이라 상태가 새면 남의 회차를 덮는다.
      if (byCase[2] === 'record')
        return <RecordScreen key={`new-${caseId}`} caseId={caseId} startClosing={query.get('closing') === '1'} />;
      if (byCase[2] === 'intake') return <IntakeScreen caseId={caseId} />;
      if (byCase[2] === 'info') return <ParticipantInfoScreen caseId={caseId} />;
      if (byCase[2] === 'close') return <CloseScreen caseId={caseId} />;
      // 카드에서 온 예약은 저장하고 기록으로 잇는다(D1). 그 밖(당사자 정보 · 인테이크)은 일정 목록으로 돌아간다.
      return <ScheduleNewScreen caseId={caseId} thenRecord={query.get('then') === 'record'} />;
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
   * 일정 묶음은 보기 하나다(2026-09-18 Q A1). 등록·기록은 당사자 목록 카드가 맡는다.
   *
   * 아이콘은 CCC 글리프를 그대로 쓴다(2026-09-17 Q). 같은 대상의 보기와 등록은 더하기
   * 유무로 가른다 — 당사자 목록(사람)·당사자 등록(사람+더하기). 일정은 보기 하나라 시계다.
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
              {/* 보기가 이 묶음의 유일한 항목이다(2026-09-18 Q A1) — 로그인 도착지이자 하루를 여는 자리다.
                  등록·기록은 당사자 목록 카드의 행동으로 내렸다. */}
              {link(HOME, '상담 일정 보기', 'upcoming')}
            </ul>
          </div>

          <div className="navigation-group">
            <p className="navigation-section-title">당사자</p>
            <ul className="navigation-list">
              {link('#/participants', '당사자 목록', 'participants')}
              {link('#/participants/new', '당사자 등록', 'participant-add')}
              {/* `당사자 정보`는 메뉴에 두지 않는다(2026-09-17 Q). 한 사람을 가리키는 자리라
                  묶음의 다른 두 항목(목록·등록)과 층이 다르고, 목록 카드가 곧 그 입구다. */}
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
            onClick={() =>
              void logout().then(() => {
                // 다음 사람이 남의 화면 주소에서 시작하지 않게 자리를 `상담 일정 보기`로 돌린다
                // (2026-09-17 Q — 로그인 뒤 도착지가 여기다).
                window.location.hash = HOME;
                setMe(null);
              })
            }
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
