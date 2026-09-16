/**
 * 열람 기록 — 관리자만 본다(GLOSSARY §6-7).
 *
 * 한 줄이 한 문장이다: **누가 · 누구의 것을 · 무엇을 했나**. 코드 이름(`case.briefing`)을
 * 그대로 두면 관리자가 읽어 낼 수 없고, 읽을 수 없는 기록은 통제가 아니다(2026-09-16 Q).
 *
 * 값은 없다. 실은 항목 이름만 남는다.
 */
import { useEffect, useState } from 'react';
import { listAudit, type AuditKind, type AuditRow } from '../api.ts';
import { Badge, Button, Card, Empty, Item, PageHeader } from '../ui.tsx';

const FIELD_LABEL: Record<string, string> = {
  name: '이름',
  phone: '연락처',
  email: '이메일',
  birth: '생년월일',
  address: '주소',
};

/** 열쇠 없이 홀로 오는 낱말들. 서버가 상태를 그대로 적어 보낸 것이다. */
const WORD: Record<string, string> = {
  approved: '승인함',
  rejected: '거절함',
  'edited=yes': '사람이 고침',
  'edited=no': '그대로 승인',
  schedule: '일정',
};

const CONSENT_LABEL: Record<string, string> = {
  access: '당사자 열람 링크',
  personal_data_collection_use: '개인정보 수집·이용',
  sensitive_information_processing: '민감정보 처리',
  counseling_recording: '상담 녹음',
  external_stt_processing: '외부 전사',
  external_llm_cross_border_processing: '외부 AI 국외 처리',
  voice_original_retention_period: '음성 보유기간',
  document_attachment: '서면 문서 보관',
};

/**
 * `fields` 한 조각을 사람 말로 편다.
 *
 * 셋을 담는다 — PII 항목 이름(`name`), 동의 결정(`영역:grant`), 그리고 그 밖의
 * `열쇠=값` 꼴 메모(`role=worker`). 마지막은 값이 아니라 설정이라 그대로 보여도 된다.
 */
function fieldText(field: string): string {
  if (WORD[field]) return WORD[field];
  if (field.includes(':')) {
    const [domain, decision] = field.split(':');
    const what =
      { grant: '동의', withdraw: '철회', deny: '거부', issue: '발급', revoke: '거둠' }[decision] ?? decision;
    return `${CONSENT_LABEL[domain] ?? domain} ${what}`;
  }
  if (field.includes('=')) {
    const [k, v] = field.split('=');
    const key =
      {
        role: '역할',
        assignee: '담당',
        program: '사업',
        document: '문서',
        invite: '초대',
        request: '요청',
        retention: '보유기간',
        user: '계정',
        type: '형식',
        bytes: '크기',
        name: '이름',
        label: '문서 이름',
        draft: '초안',
        deleted: '지운 수',
        missing: '없던 수',
        delete_after: '지울 날',
      }[k] ?? k;
    const val = k === 'bytes' ? `${Math.ceil(Number(v) / 1024)}KB` : k === 'assignee' && v === 'none' ? '없음' : v;
    return `${key} ${val}`;
  }
  return FIELD_LABEL[field] ?? field;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const TONE: Record<string, 'mint' | 'lavender' | 'blue'> = {
  열람: 'blue',
  기록: 'mint',
  운영: 'lavender',
};

const KINDS = ['전부', '열람', '기록', '운영'] as const;

/** `embedded` 는 설정 › 시스템 안에서 쓸 때다. 제목이 두 번 뜨지 않게 한다. */
export function AuditScreen({ embedded }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('전부');

  useEffect(() => {
    setRows(null);
    void listAudit(kind === '전부' ? undefined : (kind as AuditKind))
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했어요.'));
  }, [kind]);

  return (
    <>
      {!embedded && (
        <PageHeader title="열람 기록" meta="누가 누구 것을 언제 봤는지. 본 값은 남기지 않아요" />
      )}
      <div className="wire-container">
        {error && (
          <Card>
            <Empty>{error}</Empty>
          </Card>
        )}
        {!error && (
          <Card
            title={embedded ? '열람 기록 관리' : '최근 200건'}
            hint="누가 누구의 것을 무엇 했는지예요. 목록을 여는 것은 남기지 않고, 같은 사람이 같은 당사자를 10분 안에 다시 열면 한 줄로 접어요. 본 값은 남기지 않아요."
          >
            <div className="info-tabs">
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k}
                  className="wire-step"
                  data-active={kind === k}
                  onClick={() => setKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>

            {rows === null && <Empty>불러오는 중이에요.</Empty>}
            {rows?.length === 0 && <Empty>아직 기록이 없어요.</Empty>}
            {rows?.map((r) => (
              <Item
                key={r.id}
                title={
                  <>
                    <Badge tone={TONE[r.kind]}>{r.kind}</Badge> {r.label}
                    {r.subject || r.pseudonym ? ` · ${r.subject ?? r.pseudonym}` : ''}
                  </>
                }
                desc={[
                  when(r.at),
                  // 당사자 본인이 링크로 연 것은 실무자 열람과 다르게 읽어야 한다.
                  r.by_participant ? '당사자 본인' : (r.actor_name ?? '알 수 없음'),
                  r.program_name,
                  r.fields.map(fieldText).join(' · '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
