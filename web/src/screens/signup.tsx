/**
 * 기관을 여는 첫 가입(2026-09-17 Q). 로그인 앞에 선다.
 *
 * 초대 규율의 **유일한 예외**다 — 활성 관리자가 한 명도 없는 새 배포에서만 문이 열리고,
 * 첫 관리자가 들어오면 닫힌다. 그 뒤 합류는 초대 링크뿐이다(#/invite/…).
 * 가입이 끝나면 마법사(#/onboarding)로 간다.
 */
import { useEffect, useState } from 'react';
import { signup, signupOpen } from '../api.ts';
import { Button, Card, ErrorText, Field, FormActions, PageHeader } from '../ui.tsx';

/** 기관 이름에서 주소 이름 후보를 만든다. 영문 소문자·숫자·붙임표만 남긴다 — 한글은 비운다. */
const suggestSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

export function SignupScreen({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState<boolean | 'loading'>('loading');
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void signupOpen()
      .then((r) => setOpen(r.open))
      .catch(() => setOpen(false));
  }, []);

  if (open === 'loading') return <p className="empty">불러오는 중이에요.</p>;
  if (!open)
    return (
      <>
        <PageHeader title="가입이 닫혀 있어요" />
        <Card title="초대 링크로 들어와 주세요">
          <p className="panel-meta">
            이 기관에는 이미 관리자가 있어요. 관리자에게 초대 링크를 받아 그 링크로 계정을 만들어 주세요.
          </p>
          <FormActions>
            <a className="wire-button" href="#/">
              <span className="wire-button-text">로그인으로</span>
            </a>
          </FormActions>
        </Card>
      </>
    );

  const slugOk = /^[a-z0-9-]+$/.test(slug);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await signup({ org_name: orgName.trim(), slug, email: email.trim(), password, name: name.trim() });
      window.location.hash = '#/onboarding';
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '가입하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="릴레이어 시작하기" meta="기관과 첫 관리자 계정을 만들어요" />
      <Card title="기관" hint="기관 이름은 나중에 고칠 수 있어요. 주소 이름은 기관별 주소(예: 기관.relayer.kr)에 쓰여요.">
        <Field label="기관 이름" htmlFor="su-org" required>
          <input
            id="su-org"
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value);
              if (!slugTouched) setSlug(suggestSlug(e.target.value));
            }}
          />
        </Field>
        <Field label="주소 이름" htmlFor="su-slug" required hint="영문 소문자·숫자·붙임표(-)만 써요.">
          <input
            id="su-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
      </Card>
      <Card title="첫 관리자" hint="아이디는 나중에 바꿀 수 없어요. 지난 기록이 누구의 것인지 흐려지기 때문이에요.">
        <Field label="아이디" htmlFor="su-email" required>
          <input id="su-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호" htmlFor="su-pw" required hint="네 자 이상">
          <input id="su-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="이름" htmlFor="su-name" required hint="실무자와 당사자에게 보이는 이름이에요.">
          <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FormActions>
          {err && <ErrorText>{err}</ErrorText>}
          <Button
            variant="primary"
            disabled={busy || !orgName.trim() || !slugOk || email.trim().length < 2 || password.length < 4 || !name.trim()}
            onClick={() => void go()}
          >
            {busy ? '만드는 중…' : '기관 만들고 시작하기'}
          </Button>
        </FormActions>
      </Card>
    </>
  );
}
