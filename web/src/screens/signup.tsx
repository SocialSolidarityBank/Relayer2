/**
 * 가입하기(2026-09-17 Q). 로그인 앞에 선다. 로그인과 같은 게이트 문법(`.preview-gate`)이다. 문은 두 갈래다.
 *
 * - **첫 가입**: 활성 관리자가 없는 새 배포에서 한 번. 계정만 만들고 자동 로그인 → 마법사 0단계(기관 워크스페이스 만들기).
 *   초대 규율의 유일한 예외이며, 첫 관리자가 생기면 영구히 닫힌다.
 * - **닫힘**: 이 기관은 초대 링크로만 가입할 수 있다. 어느 기관인지(이름)와 로그인만 보여 준다 — 계정을 만들지 않는다.
 *   소속 없는 계정은 이 배포(기관 하나)에서 할 일이 없다(ASTRA 검토 A).
 */
import { useEffect, useState } from 'react';
import { signup, signupOpen, type Workspace } from '../api.ts';
import { Field } from '../ui.tsx';

export function SignupScreen({ onDone }: { onDone: () => void }) {
  const [gate, setGate] = useState<{ open: boolean; workspace: Workspace | null } | 'loading'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void signupOpen()
      .then(setGate)
      .catch(() => setGate({ open: false, workspace: null }));
  }, []);

  if (gate === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!gate.open)
    return (
      <main className="page-content preview-gate">
        <div className="preview-gate-head">
          <h1>이 기관은 초대 링크로만 가입할 수 있어요</h1>
          {gate.workspace && <p>{gate.workspace.name}</p>}
        </div>
        <div className="surface-card preview-gate-card">
          <p className="note-inline">
            기관 관리자에게 초대 링크를 요청해 주세요. 초대 링크를 받았다면 그 링크를 열어 계정을 만들어요. 이미 계정이 있으면
            로그인해요.
          </p>
          <a className="wire-button preview-gate-submit" data-variant="primary" href="#/login">
            <span className="wire-button-text">로그인하기</span>
          </a>
        </div>
      </main>
    );

  const ready = email.trim().length >= 2 && password.length >= 4 && name.trim().length > 0;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await signup({ email: email.trim(), password, name: name.trim() });
      // 어디로 갈지는 셸이 정한다 — 관리자·워크스페이스 없음이면 마법사 0단계다.
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '가입하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>먼저 관리자 계정을 만들어요</h1>
        <p>계정을 만든 뒤 기관 워크스페이스 만들기로 이어져요. 아이디는 나중에 바꿀 수 없어요.</p>
      </div>
      {err && (
        <p role="alert" className="wire-field-error">
          {err}
        </p>
      )}
      <form
        className="surface-card preview-gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Field label="아이디" htmlFor="su-email" required>
          <input id="su-email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호" htmlFor="su-pw" required hint="네 자 이상">
          <input id="su-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="이름" htmlFor="su-name" required hint="실무자와 당사자에게 보이는 이름이에요.">
          <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button type="submit" className="wire-button preview-gate-submit" data-variant="primary" disabled={busy || !ready}>
          <span className="wire-button-text">{busy ? '만드는 중…' : '계정 만들기'}</span>
        </button>
        <p className="note-inline">
          이미 계정이 있나요? <a href="#/login">로그인하기</a>
        </p>
      </form>
    </main>
  );
}
