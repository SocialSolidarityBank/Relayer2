/**
 * 랜딩(2026-09-17 Q). 로그아웃 상태로 **루트에 왔을 때만** 뜬다 — 깊은 주소는 랜딩을 거치지 않고 로그인으로 간다.
 * 문은 둘: 로그인하기·가입하기. 가입하기는 늘 보이되 가입 권한은 첫 관리자 예외와 초대에만 있다(가입 화면이 판정한다).
 */
import { PageHeader } from '../ui.tsx';

export function LandingScreen() {
  return (
    <>
      <PageHeader title="릴레이어" meta="상담 기록과 일정을 한곳에서 관리해요" />
      <div className="wire-container">
        <div className="wire-form-actions">
          <a className="wire-button" data-variant="primary" href="#/login">
            <span className="wire-button-text">로그인하기</span>
          </a>
          <a className="wire-button" href="#/signup">
            <span className="wire-button-text">가입하기</span>
          </a>
        </div>
      </div>
    </>
  );
}
