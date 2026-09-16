/**
 * 열람 기록 관리 — 관리자만 본다(설계는 `docs/audit-view.md`, 2026-09-16 Q 2차 개정).
 *
 * **찾기 전에는 아무것도 보여 주지 않는다.** 수백 건을 늘어놓으면 훑을 수 없고,
 * 그 자체가 개인정보를 화면에 펼쳐 두는 일이다. 무엇을 찾는지 정해야 줄이 선다.
 *
 * 요약을 위에 따로 세우지 않는다 — **거르는 조건과 세는 조건이 같으므로 필터가 곧 숫자다.**
 * `맡지 않은 당사자를 연 것 304건`은 버튼 이름이면서 그 자체로 점검 결과다.
 *
 * **판정하지 않는다.** 붉은색도 경고도 없다. 세기만 하고 판단은 사람이 한다.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  auditSummary,
  listAudit,
  type AuditKind,
  type AuditQuery,
  type AuditRow,
  type AuditSummary,
} from '../api.ts';
import { Badge, Card, Empty, Field, PageHeader } from '../ui.tsx';

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

const KEY_LABEL: Record<string, string> = {
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
};

/** `fields` 한 조각을 사람 말로 편다. */
export function fieldText(field: string): string {
  if (WORD[field]) return WORD[field];
  if (field.includes(':')) {
    const [domain, decision] = field.split(':');
    const what =
      { grant: '동의', withdraw: '철회', deny: '거부', issue: '발급', revoke: '거둠' }[decision] ?? decision;
    return `${CONSENT_LABEL[domain] ?? domain} ${what}`;
  }
  if (field.includes('=')) {
    const [k, v] = field.split('=');
    const val = k === 'bytes' ? `${Math.ceil(Number(v) / 1024)}KB` : k === 'assignee' && v === 'none' ? '없음' : v;
    return `${KEY_LABEL[k] ?? k} ${val}`;
  }
  return FIELD_LABEL[field] ?? field;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const TONE: Record<string, 'mint' | 'lavender' | 'blue'> = { 열람: 'blue', 기록: 'mint', 운영: 'lavender' };

export const AUDIT_DAYS: ReadonlyArray<[number, string]> = [
  [7, '지난 7일'],
  [30, '지난 30일'],
  [90, '지난 90일'],
  [365, '지난 1년'],
];

export const AUDIT_KIND_TABS = ['전부', '열람', '기록', '운영'] as const;

const LIMIT = 200;

/** `embedded` 는 설정 › 시스템 안에서 쓸 때다. 제목이 두 번 뜨지 않게 한다. */
export function AuditScreen({ embedded }: { embedded?: boolean } = {}) {
  const [days, setDays] = useState(30);
  const [only, setOnly] = useState<'off_assignment' | 'download' | null>(null);
  const [q, setQ] = useState('');
  const [sum, setSum] = useState<AuditSummary | null>(null);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 세는 것은 기간만 따른다. 버튼에 붙는 숫자라 눌러도 바뀌지 않아야 한다.
  useEffect(() => {
    void auditSummary(days)
      .then(setSum)
      .catch(() => setSum(null));
  }, [days]);

  // **찾기 전에는 부르지도 않는다.** 글자를 치거나 눈여겨볼 것을 골라야 줄이 선다.
  const asked = q.trim().length > 0 || only !== null;

  const query: AuditQuery = useMemo(() => ({ days, only: only ?? undefined }), [days, only]);

  useEffect(() => {
    if (!asked) {
      setRows(null);
      return;
    }
    setRows(null);
    void listAudit(query)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했어요.'));
  }, [query, asked]);

  // 글자 검색은 화면이 한다. 이름이 금고 암호문이라 서버가 이름으로 못 찾는다.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows) return [];
    const matched = needle
      ? rows.filter((r) =>
          [r.label, r.subject, r.pseudonym, r.actor_name, r.program_name, ...r.fields].some((v) =>
            v?.toLowerCase().includes(needle),
          ),
        )
      : rows;
    return matched.slice(0, LIMIT);
  }, [rows, q]);

  const watch = (key: 'off_assignment' | 'download'): { label: string; count: number } => {
    const w = sum?.watch.find((x) => x.key === key);
    return { label: w?.label ?? '', count: w?.count ?? 0 };
  };

  return (
    <>
      {!embedded && <PageHeader title="열람 기록" meta="누가 누구 것을 언제 봤는지. 본 값은 남기지 않아요" />}

      <Card
        title="찾기"
        hint="찾아야 줄이 나와요. 기록을 펼쳐 두지 않는 건 그 자체가 개인정보를 화면에 늘어놓는 일이기 때문이에요."
      >
        <Field label="기간" htmlFor="audit-days">
          <div className="info-tabs" id="audit-days">
            {AUDIT_DAYS.map(([d, label]) => (
              <button type="button" key={d} className="wire-step" data-active={days === d} onClick={() => setDays(d)}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="눈여겨볼 것"
          hint="고르면 그것만 봐요. 숫자는 고른 기간 전체예요 — 이상하다는 뜻이 아니라 센 수예요."
        >
          <div className="info-tabs">
            {(['off_assignment', 'download'] as const).map((key) => {
              const w = watch(key);
              return (
                <button
                  type="button"
                  key={key}
                  className="wire-step"
                  data-active={only === key}
                  onClick={() => setOnly(only === key ? null : key)}
                >
                  {w.label} {w.count.toLocaleString()}건
                </button>
              );
            })}
            {sum && (
              <button
                type="button"
                className="wire-step"
                data-active={only === null}
                onClick={() => setOnly(null)}
              >
                모두 {sum.total.toLocaleString()}건
              </button>
            )}
          </div>
        </Field>

        <Field
          label="글자로 찾기"
          htmlFor="audit-q"
          hint="당사자 이름 · 가명 · 실무자 이름 · 사업 이름 · 한 일(예: 내려받기, 동의, 배정)"
        >
          <input
            id="audit-q"
            type="search"
            placeholder="김민희 · otter-001 · 내려받기 · 함께온기금"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </Card>

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      {!asked ? (
        <Card title="찾은 기록">
          <Empty>위에서 찾아 주세요. 전체를 받아 보려면 `자료 다운로드`를 쓰세요.</Empty>
        </Card>
      ) : (
        <Card
          title={rows === null ? '찾는 중' : `찾은 기록 ${shown.length.toLocaleString()}건`}
          hint={
            shown.length >= LIMIT
              ? `${LIMIT}건까지 보여요. 기간을 줄이거나 더 좁혀서 찾으세요.`
              : '같은 사람이 같은 당사자를 10분 안에 다시 열면 한 줄로 접어요.'
          }
        >
          {rows === null ? (
            <Empty>찾는 중이에요.</Empty>
          ) : shown.length === 0 ? (
            <Empty>해당하는 기록이 없어요.</Empty>
          ) : (
            <div className="log-table-wrap">
              <table className="log-table">
                <thead>
                  <tr>
                    <th>언제</th>
                    <th>묶음</th>
                    <th>한 일</th>
                    <th>한 사람</th>
                    <th>대상</th>
                    <th>사업</th>
                    <th>자세히</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>{when(r.at)}</td>
                      <td>
                        <Badge tone={TONE[r.kind]}>{r.kind}</Badge>
                      </td>
                      <td>{r.label}</td>
                      <td>{r.by_participant ? '당사자 본인' : (r.actor_name ?? '알 수 없음')}</td>
                      <td>
                        {r.subject ?? r.pseudonym ?? ''}
                        {r.off_assignment && ' (맡은 당사자 아님)'}
                      </td>
                      <td>{r.program_name ?? ''}</td>
                      <td>{r.fields.map(fieldText).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
