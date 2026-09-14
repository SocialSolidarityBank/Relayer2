// 베타 라우팅. 화면이 다섯이라 라우터 의존성을 두지 않는다.
// 로그인하지 않았으면 어떤 화면도 열지 않는다.
import { useEffect, useState } from 'react';
import { getMe, logout, Unauthorized, type Me } from './api.ts';
import { BriefingScreen } from './screens/briefing.tsx';
import { IntakeScreen } from './screens/intake.tsx';
import { LoginScreen } from './screens/login.tsx';
import { ParticipantNewScreen } from './screens/participant-new.tsx';
import { RecordScreen } from './screens/record.tsx';
import { ScheduleNewScreen } from './screens/schedule-new.tsx';

const HOME = '#/participants/new';

export function Routes() {
  const [hash, setHash] = useState(window.location.hash || HOME);
  const [me, setMe] = useState<Me | null | 'loading'>('loading');

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || HOME);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    void getMe()
      .then(setMe)
      .catch((e) => setMe(e instanceof Unauthorized ? null : null));
  }, []);

  if (me === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!me) return <LoginScreen onDone={() => void getMe().then(setMe)} />;

  const screen = (() => {
    if (hash === HOME) return <ParticipantNewScreen />;

    const byCase = hash.match(/^#\/cases\/(\d+)\/(briefing|record|schedule|intake)$/);
    if (byCase) {
      const caseId = Number(byCase[1]);
      if (byCase[2] === 'briefing') return <BriefingScreen caseId={caseId} />;
      if (byCase[2] === 'record') return <RecordScreen caseId={caseId} />;
      if (byCase[2] === 'intake') return <IntakeScreen caseId={caseId} />;
      return <ScheduleNewScreen caseId={caseId} />;
    }

    window.location.hash = HOME;
    return null;
  })();

  const caseId = hash.match(/^#\/cases\/(\d+)\//)?.[1];

  return (
    <>
      <nav className="app-nav">
        <a href={HOME}>당사자 등록</a>
        {caseId && (
          <>
            <a href={`#/cases/${caseId}/intake`}>인테이크 작성하기</a>
            <a href={`#/cases/${caseId}/briefing`}>15초 다시보기</a>
            <a href={`#/cases/${caseId}/record`}>상담 기록하기</a>
            <a href={`#/cases/${caseId}/schedule`}>상담 일정 등록</a>
          </>
        )}
        <span className="app-nav-me">
          {me.name}
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
