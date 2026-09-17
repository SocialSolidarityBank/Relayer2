/**
 * 초대장으로 들어오기(2026-09-16 Q).
 *
 * 로그인 앞에 선다 — 아직 계정이 없는 사람이 보는 화면이다.
 * 초대장 없이 가입하는 길은 없다. 주소만 알면 누구나 들어오는 문은 상담 기록을
 * 다루는 제품에 있어서는 안 된다.
 */
import { useEffect, useState } from 'react';
import { peekInvite, signUpWithInvite } from '../api.ts';
import { Button, Card, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

export function InviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [role, setRole] = useState<string | null | 'loading'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void peekInvite(token)
      .then((r) => setRole(r.role))
      .catch(() => setRole(null));
  }, [token]);

  if (role === 'loading') return <p className="empty">불러오는 중</p>;
  if (role === null)
    return (
      <>
        <PageHeader title="쓸 수 없는 초대" />
        <Card title="새 초대 필요">
          <p className="panel-meta">기한 만료 또는 사용된 링크, 초대한 분께 새 링크 요청</p>
        </Card>
      </>
    );

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await signUpWithInvite(token, { email: email.trim(), password, name: name.trim() });
      window.location.hash = '#/';
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '가입 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="릴레이어에 들어오기" meta={role === 'admin' ? '관리자 초대' : '실무자 초대'} />
      <Card title="계정 만들기">
        <Field label="아이디" htmlFor="iv-email" required>
          <input id="iv-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호" htmlFor="iv-pw" required>
          <input id="iv-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="이름" htmlFor="iv-name" required hint="당사자에게 보이는 이름">
          <input id="iv-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FormActions>
          {err && <ErrorText>{err}</ErrorText>}
          <Button
            variant="primary"
            disabled={busy || !email.trim() || password.length < 4 || !name.trim()}
            onClick={() => void go()}
          >
            {busy ? '들어가는 중…' : '들어가기'}
          </Button>
        </FormActions>
      </Card>
    </>
  );
}
