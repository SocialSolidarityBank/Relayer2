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
import { dateTimeLabel } from '../date-time.ts';
import { Badge, Card, Empty, PageHeader, Select } from '../ui.tsx';

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
  store: '응답 보관',
};

/** `fields` 한 조각을 사람 말로 편다. */
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
    const val =
      k === 'bytes' ? `${Math.ceil(Number(v) / 1024)}KB`
      : k === 'assignee' && v === 'none' ? '없음'
      : k === 'store' ? (v === 'false' ? '끔' : '켬')
      : v;
    return `${KEY_LABEL[k] ?? k} ${val}`;
  }
  return FIELD_LABEL[field] ?? field;
}

// 일시 표기는 `date-time.ts` 의 `dateTimeLabel` 하나다(2026-09-18 Q).

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
  const [sort, setSort] = useState<'new' | 'old'>('new');
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
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'));
  }, [query, asked]);

  // 글자 검색은 화면이 한다. 이름이 금고 암호문이라 서버가 이름으로 못 찾는다. 정렬도 화면 몫이다.
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
    const ordered = sort === 'old' ? [...matched].sort((a, b) => a.at.localeCompare(b.at)) : matched;
    return ordered.slice(0, LIMIT);
  }, [rows, q, sort]);

  const watch = (key: 'off_assignment' | 'download'): { label: string; count: number } => {
    const w = sum?.watch.find((x) => x.key === key);
    return { label: w?.label ?? '', count: w?.count ?? 0 };
  };

  return (
    <>
      {!embedded && <PageHeader title="열람 기록" meta="누가 누구 것을 언제 봤는지, 본 값은 남기지 않음" />}

      {/* 업무 바 한 줄(2026-09-18 L4 L2) — 당사자 목록과 같은 `.work-toolbar`: 왼쪽 검색칸, 오른쪽 걸개·정렬.
          카드가 아니다 — 아래 기록이 본체라 위가 무거우면 안 된다. */}
      <div className="work-toolbar log-toolbar">
        <div className="wire-input-box log-toolbar-search">
          <input
            id="audit-q"
            type="search"
            aria-label="열람 기록 검색"
            placeholder="김민희, otter-001, 내려받기, 함께온기금"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="log-toolbar-actions">
          <Select id="audit-days" aria-label="열람 기록 기간" value={String(days)} onChange={(v) => setDays(Number(v))}>
            {AUDIT_DAYS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            id="audit-only"
            aria-label="열람 기록 확인 필요"
            value={only ?? 'all'}
            onChange={(v) => setOnly(v === 'all' ? null : (v as 'off_assignment' | 'download'))}
          >
            <option value="all">{sum ? `모두 ${sum.total.toLocaleString()}건` : '모두'}</option>
            {(['off_assignment', 'download'] as const).map((key) => {
              const w = watch(key);
              return (
                <option key={key} value={key}>
                  {w.label || key} {w.count.toLocaleString()}건
                </option>
              );
            })}
          </Select>
          <Select id="audit-sort" aria-label="정렬" value={sort} onChange={(v) => setSort(v as 'new' | 'old')}>
            <option value="new">최신순</option>
            <option value="old">오래된순</option>
          </Select>
        </div>
      </div>

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      {!asked ? (
        <Card title="열람 기록">
          <Empty>기간, 확인 필요, 검색 중 하나 선택</Empty>
        </Card>
      ) : (
        <Card
          title={rows === null ? '열람 기록' : `열람 기록 ${shown.length.toLocaleString()}건`}
          hint={shown.length >= LIMIT ? `${LIMIT}건까지 표시, 기간을 줄이거나 더 좁히기` : undefined}
        >
          {rows === null ? (
            <Empty>찾는 중</Empty>
          ) : shown.length === 0 ? (
            <Empty>해당하는 기록 없음</Empty>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
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
                      <td>{dateTimeLabel(r.at)}</td>
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
                      <td>{r.fields.map(fieldText).join(', ')}</td>
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
