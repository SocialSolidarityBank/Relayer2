// 로그인 — 베타는 실무자·관리자만 들어온다. 당사자는 로그인하지 않는다(GLOSSARY §3).
import { useEffect, useState } from 'react';
import { login, signupOpen } from '../api.ts';
import { Button, Card, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 새 배포(활성 관리자 0명)에서만 첫 가입 문이 보인다. 그 뒤로는 초대 링크뿐이다(2026-09-17 Q).
  const [signupAvailable, setSignupAvailable] = useState(false);
  useEffect(() => {
    void signupOpen()
      .then((r) => setSignupAvailable(r.open))
      .catch(() => setSignupAvailable(false));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '들어가지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="릴레이어" meta="실무자와 관리자가 들어오는 자리예요" />
      <div className="wire-container">
        <Card title="로그인">
          <Field label="아이디" htmlFor="email" required>
            <input
              id="email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="비밀번호" htmlFor="password" required>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.trim() && password) void submit();
              }}
            />
          </Field>
          <FormActions>
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="primary" disabled={!email.trim() || !password || busy} onClick={() => void submit()}>
              {busy ? '확인 중…' : '로그인'}
            </Button>
          </FormActions>
        </Card>
        {signupAvailable && (
          <Card title="아직 관리자가 없어요" hint="새 기관이면 첫 관리자 계정을 만들어 시작해요.">
            <FormActions>
              <a className="wire-button" data-variant="primary" href="#/signup">
                <span className="wire-button-text">기관 만들고 시작하기</span>
              </a>
            </FormActions>
          </Card>
        )}
      </div>
    </>
  );
}
