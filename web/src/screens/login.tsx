/**
 * 로그인 = 랜딩(2026-09-17 Q). 로그아웃 상태에서 어느 주소로 오든 이 화면 하나다 — 문이 둘로 갈리면 사람이 두 번 고른다.
 * CCC-new `/login` 의 게이트 문법(`.preview-gate` 계열, 이식 CSS)을 그대로 쓴다: 화면 가운데, 카드 400, 입장 버튼 전폭.
 * 베타는 실무자·관리자만 들어온다. 당사자는 로그인하지 않는다(GLOSSARY §3).
 * `가입하기`는 늘 보이되 가입이 되는지는 가입 화면이 판정한다 — 첫 관리자 예외와 초대뿐이다.
 */
import { useState } from 'react';
import { login } from '../api.ts';
import { Field } from '../ui.tsx';

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <span className="gate-wordmark">Relayer</span>
      </div>

      {error && (
        <p role="alert" className="wire-field-error">
          {error}
        </p>
      )}

      <form
        className="surface-card preview-gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="아이디" htmlFor="email" required>
          <input id="email" type="text" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호" htmlFor="password" required>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          className="wire-button preview-gate-submit"
          data-variant="primary"
          disabled={!email.trim() || !password || busy}
        >
          <span className="wire-button-text">{busy ? '확인 중' : '로그인'}</span>
        </button>
        <a className="wire-button preview-gate-submit" data-variant="secondary" href="#/signup">
          <span className="wire-button-text">가입하기</span>
        </a>
      </form>
    </main>
  );
}
