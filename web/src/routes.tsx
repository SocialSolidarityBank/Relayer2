// 베타 라우팅. 화면이 다섯이라 라우터 의존성을 두지 않는다.
// 로그인하지 않았으면 어떤 화면도 열지 않는다.
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    void getMe()
      .then(setMe)
      .catch((e) => setMe(e instanceof Unauthorized ? null : null));
  }, []);

  // 당사자 열람은 로그인 앞에 선다. 링크와 코드로만 열리고, 실무자 화면과 섞이지 않는다.
  const asParticipant = hash.match(/^#\/access\/([A-Za-z0-9_-]+)$/);
  if (asParticipant) return <AccessScreen token={asParticipant[1]} />;

  if (me === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!me) return <LoginScreen onDone={() => void getMe().then(setMe)} />;

  const screen = (() => {
    if (hash === HOME) return <HomeScreen />;
    if (hash === '#/participants') return <ParticipantsScreen />;
    if (hash === '#/audit') return <AuditScreen />;
    if (hash === '#/participants/new') return <ParticipantNewScreen />;

    // 저장해 둔 회차 고쳐 쓰기. 기록 화면을 그대로 쓰되 대상 회차를 준다.
    const editing = hash.match(/^#\/cases\/(\d+)\/sessions\/(\d+)\/edit$/);
    if (editing) return <RecordScreen caseId={Number(editing[1])} sessionId={Number(editing[2])} />;

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

  const caseId = hash.match(/^#\/cases\/(\d+)\//)?.[1];

  return (
    <>
      <nav className="app-nav">
        <a href={HOME}>일정</a>
        <a href="#/participants">당사자 목록</a>
        <a href="#/participants/new">당사자 등록</a>
        {/* 열람 기록은 관리자만. 실무자 화면에 없는 것이 맞다(GLOSSARY §6-7). */}
        {me.role === 'admin' && <a href="#/audit">열람 기록</a>}
        {caseId && (
          <>
            <a href={`#/cases/${caseId}/info`}>당사자 정보</a>
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
