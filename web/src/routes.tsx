// 베타 라우팅. 화면이 다섯이라 라우터 의존성을 두지 않는다.
// 로그인하지 않았으면 어떤 화면도 열지 않는다.
import { useEffect, useState } from 'react';
import { applyTheme, followSystemTheme, initialTheme, type Theme } from './theme.ts';
import { getMe, logout, Unauthorized, type Me } from './api.ts';
import { AccessScreen } from './screens/access.tsx';
import { AuditScreen } from './screens/audit.tsx';
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
  if (asParticipant) return <AccessScreen token={asParticipant[1]} />;

  if (me === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!me) return <LoginScreen onDone={() => void getMe().then(setMe)} />;

  const screen = (() => {
    if (hash === HOME) return <HomeScreen />;
    if (hash === '#/participants') return <ParticipantsScreen />;
    // 사례를 안 고른 채 상담 기록하기·상담 일정 등록을 누르면 여기로 온다.
    if (hash === '#/pick/record') return <ParticipantsScreen pickFor="record" />;
    if (hash === '#/pick/schedule') return <ParticipantsScreen pickFor="schedule" />;
    if (hash === '#/audit') return <AuditScreen />;
    if (hash === '#/participants/new') return <ParticipantNewScreen />;

    // 저장해 둔 회차 고쳐 쓰기. 기록 화면을 그대로 쓰되 대상 회차를 준다.
    const editing = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/edit$/);
    if (editing) return <RecordScreen caseId={Number(editing[1])} sessionId={Number(editing[2])} />;

    const reviewing = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/review$/);
    if (reviewing) return <ReviewScreen caseId={Number(reviewing[1])} sessionId={Number(reviewing[2])} />;

    const byCase = hash.match(/^#\/cases\/(\d+)\/(briefing|record|schedule|intake|info|close)$/);
    if (byCase) {
      const caseId = Number(byCase[1]);
      if (byCase[2] === 'briefing') return <BriefingScreen caseId={caseId} />;
      if (byCase[2] === 'record') return <RecordScreen caseId={caseId} />;
      if (byCase[2] === 'intake') return <IntakeScreen caseId={caseId} />;
      if (byCase[2] === 'info') return <ParticipantInfoScreen caseId={caseId} />;
      if (byCase[2] === 'close') return <CloseScreen caseId={caseId} />;
      return <ScheduleNewScreen caseId={caseId} />;
    }

    window.location.hash = HOME;
    return null;
  })();


  return (
    <>
      <nav className="app-nav">
        <a href={HOME}>일정</a>
        <a href="#/participants">당사자 목록</a>
        <a href="#/participants/new">당사자 등록</a>
        {/* 열람 기록은 관리자만. 실무자 화면에 없는 것이 맞다(GLOSSARY §6-7). */}
        {me.role === 'admin' && <a href="#/audit">열람 기록</a>}
        {/* 상담 기록하기·상담 일정 등록은 **누구의 것인지 정해야** 열린다.
            사례가 이미 정해져 있으면 그리로 바로 가고, 아니면 당사자를 고르는 자리로 보낸다.
            메뉴에서 사라지게 두면 "그 기능이 없다"로 읽힌다.
            15초 다시보기와 인테이크 작성하기는 메뉴가 아니다 — 당사자 카드 안에 있다. */}
        <a href={caseId ? `#/cases/${caseId}/record` : '#/pick/record'}>상담 기록하기</a>
        <a href={caseId ? `#/cases/${caseId}/schedule` : '#/pick/schedule'}>상담 일정 등록</a>
        {caseId && <a href={`#/cases/${caseId}/info`}>당사자 정보</a>}
        <span className="app-nav-me">
          {me.name}
          {/* 다크 토큰은 이미 이식돼 있었다. 없던 것은 켜는 장치뿐이라 그것만 붙인다. */}
          <button
            type="button"
            className="app-nav-logout"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '밝게' : '어둡게'}
          </button>
          <button
            type="button"
            className="app-nav-logout"
            onClick={() => void logout().then(() => setMe(null))}
          >
            로그아웃
          </button>
        </span>
      </nav>
      {screen}
    </>
  );
}
