// 당사자 열람 — 로그인하지 않는다. 링크(주소)와 코드 두 자물쇠를 지나야 열린다(GLOSSARY §3).
// 보이는 것은 기본정보와 앞으로의 일정뿐이다. 상담 내용은 여기 오지 않는다.
import { useState } from 'react';
import { openAccess, type ParticipantView } from '../api.ts';
import { Button, Card, Empty, ErrorText, Field, FormActions, Item, PageHeader } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function AccessScreen({ token }: { token: string }) {
  const [code, setCode] = useState('');
  const [view, setView] = useState<ParticipantView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await openAccess(token, code.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : '열기 실패');
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <>
        <PageHeader title="내 상담 일정" meta="담당 실무자에게 받은 여섯 자리 숫자" />
        <div className="wire-container">
          <Card title="확인 코드">
            <Field label="여섯 자리 숫자" htmlFor="code" required>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6) void open();
                }}
              />
            </Field>
            <FormActions>
              {error && <ErrorText>{error}</ErrorText>}
              <Button variant="primary" disabled={code.length !== 6 || busy} onClick={() => void open()}>
                {busy ? '여는 중…' : '열기'}
              </Button>
            </FormActions>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="내 상담 일정" meta={view.name ?? undefined} />
      <div className="wire-container">
        <Card title="다가오는 상담">
          {view.schedule.length === 0 ? (
            <Empty>예정된 상담 없음, 담당 실무자에게 문의</Empty>
          ) : (
            view.schedule.map((s) => (
              <Item
                key={s.scheduled_at}
                title={when(s.scheduled_at)}
                desc={[s.program_name, s.method ? METHOD_LABEL[s.method] : null, s.place]
                  .filter(Boolean)
                  .join(', ')}
              />
            ))
          )}
        </Card>

        <Card title="내 정보" hint="잘못된 정보는 담당 실무자에게 문의">
          <Item title={view.name ?? '—'} desc="이름" />
          <Item title={view.phone ?? '—'} desc="연락처" />
          <Item title={view.email ?? '—'} desc="이메일" />
        </Card>
      </div>
    </>
  );
}
