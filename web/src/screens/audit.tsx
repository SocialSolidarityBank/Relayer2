// 열람 기록 — 관리자만 본다(GLOSSARY §6-7). 누가 누구 것을 언제 봤는지 한 줄씩.
// 값은 없다. 실은 항목 이름만 남는다.
import { useEffect, useState } from 'react';
import { listAudit, type AuditRow } from '../api.ts';
import { Card, Empty, Item, PageHeader } from '../ui.tsx';

const ACTION_LABEL: Record<string, string> = {
  'participants.list': '당사자 목록 조회',
  'case.detail': '당사자 정보 조회',
  'case.briefing': '15초 다시보기 조회',
  'schedule.list': '일정 조회',
  'consent.record': '동의 기록',
};

const FIELD_LABEL: Record<string, string> = {
  name: '이름',
  phone: '연락처',
  email: '이메일',
};

/** `personal_data_collection_use:grant` 같은 동의 기록도 사람 말로 편다. */
function fieldText(field: string): string {
  if (!field.includes(':')) return FIELD_LABEL[field] ?? field;
  const [domain, decision] = field.split(':');
  const label = domain === 'personal_data_collection_use' ? '개인정보 수집·이용' : '민감정보 처리';
  const what = decision === 'grant' ? '동의' : decision === 'withdraw' ? '철회' : '거부';
  return `${label} ${what}`;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AuditScreen() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listAudit()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했어요.'));
  }, []);

  return (
    <>
      <PageHeader title="열람 기록" meta="누가 누구 것을 언제 봤는지. 본 값은 남기지 않아요" />
      <div className="wire-container">
        {error && (
          <Card>
            <Empty>{error}</Empty>
          </Card>
        )}
        {!error && rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows?.length === 0 && (
          <Card>
            <Empty>아직 기록이 없어요.</Empty>
          </Card>
        )}
        {rows && rows.length > 0 && (
          <Card title="최근 200건">
            {rows.map((r) => (
              <Item
                key={r.id}
                title={`${when(r.at)} · ${r.actor_name ?? '알 수 없음'} · ${ACTION_LABEL[r.action] ?? r.action}`}
                desc={[r.pseudonym, r.fields.map(fieldText).join(' · ')].filter(Boolean).join(' · ')}
              />
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
