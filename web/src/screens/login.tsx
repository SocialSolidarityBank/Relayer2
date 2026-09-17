// 로그인 — 베타는 실무자·관리자만 들어온다. 당사자는 로그인하지 않는다(GLOSSARY §3).
import { useState } from 'react';
import { login } from '../api.ts';
import { Button, Card, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            {/* 가입하기는 늘 보인다(2026-09-17 Q). 가입이 되는지는 가입 화면이 판정한다 — 첫 관리자 예외와 초대뿐이다. */}
            <a className="wire-button" href="#/signup">
              <span className="wire-button-text">가입하기</span>
            </a>
            <Button variant="primary" disabled={!email.trim() || !password || busy} onClick={() => void submit()}>
              {busy ? '확인 중…' : '로그인'}
            </Button>
          </FormActions>
        </Card>
      </div>
    </>
  );
}
