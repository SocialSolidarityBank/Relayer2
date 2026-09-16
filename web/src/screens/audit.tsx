/**
 * 열람 기록 — 관리자만 본다(GLOSSARY §6-7 · 설계는 docs/audit-view.md).
 *
 * **두 층이다.** 위는 숫자와 눈여겨볼 것, 아래는 목록과 필터. 정기 점검은 위에서 끝나고
 * 사고 추적은 아래로 내려간다.
 *
 * **판정하지 않는다.** `맡지 않은 당사자를 연 것 9건`은 사실이고 `의심스러운 접근 9건`은
 * 판정이다. 앞엣것만 쓴다 — 불일치 기능과 같은 규율이다. 붉은색도 경고 표시도 없다.
 *
 * 값은 없다. 실은 항목 이름만 남는다.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  auditCsvHref,
  auditSummary,
  listAudit,
  type AuditKind,
  type AuditQuery,
  type AuditRow,
  type AuditSummary,
} from '../api.ts';
import { Badge, Button, Card, Empty, Field, FormActions, Item, PageHeader, Select } from '../ui.tsx';

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

/**
 * `fields` 한 조각을 사람 말로 편다. 셋을 담는다 — PII 항목 이름(`name`),
 * 동의 결정(`영역:grant`), 그 밖의 `열쇠=값` 메모(`role=worker`).
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
    const val = k === 'bytes' ? `${Math.ceil(Number(v) / 1024)}KB` : k === 'assignee' && v === 'none' ? '없음' : v;
    return `${KEY_LABEL[k] ?? k} ${val}`;
  }
  return FIELD_LABEL[field] ?? field;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const TONE: Record<string, 'mint' | 'lavender' | 'blue'> = { 열람: 'blue', 기록: 'mint', 운영: 'lavender' };

const KINDS = ['전부', '열람', '기록', '운영'] as const;
const DAYS: ReadonlyArray<[number, string]> = [
  [7, '지난 7일'],
  [30, '지난 30일'],
  [90, '지난 90일'],
  [365, '지난 1년'],
];

/** `embedded` 는 설정 › 시스템 안에서 쓸 때다. 제목이 두 번 뜨지 않게 한다. */
export function AuditScreen({ embedded }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [sum, setSum] = useState<AuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState(30);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('전부');
  // 한 줄을 눌러 좁힌 자리. 상세 패널 대신 조사를 잇는다(docs/audit-view.md).
  const [actor, setActor] = useState<{ id: number; name: string } | null>(null);
  const [subject, setSubject] = useState<{ caseId: number; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [withNames, setWithNames] = useState(false);

  const query: AuditQuery = useMemo(
    () => ({
      days,
      kind: kind === '전부' ? undefined : (kind as AuditKind),
      actor: actor?.id,
      case: subject?.caseId,
    }),
    [days, kind, actor, subject],
  );

  useEffect(() => {
    setRows(null);
    void listAudit(query)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했어요.'));
  }, [query]);

  // 요약은 좁히기와 무관하게 기간 전체를 본다 — 위층은 점검이고 아래층이 조사다.
  useEffect(() => {
    void auditSummary(days).then(setSum).catch(() => setSum(null));
  }, [days]);

  // 글자 검색은 화면이 한다. 이름이 금고 암호문이라 서버가 이름으로 못 찾는다.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return (rows ?? []).slice(0, 200);
    return rows
      .filter((r) =>
        [r.label, r.subject, r.pseudonym, r.actor_name, r.program_name, ...r.fields].some((v) =>
          v?.toLowerCase().includes(needle),
        ),
      )
      .slice(0, 200);
  }, [rows, q]);

  if (error) {
    return (
      <Card>
        <Empty>{error}</Empty>
      </Card>
    );
  }

  const narrowed = actor || subject;

  return (
    <>
      {!embedded && <PageHeader title="열람 기록" meta="누가 누구 것을 언제 봤는지. 본 값은 남기지 않아요" />}

      <Card
        title="얼마나 있었나"
        hint="고른 기간 전체예요. 아래에서 좁혀도 이 숫자는 그대로예요."
      >
        <div className="info-tabs">
          {DAYS.map(([d, label]) => (
            <button type="button" key={d} className="wire-step" data-active={days === d} onClick={() => setDays(d)}>
              {label}
            </button>
          ))}
        </div>
        {sum === null ? (
          <Empty>세는 중이에요.</Empty>
        ) : (
          <>
            <div className="wire-repeat-card">
              <Item
                title={`모두 ${sum.total.toLocaleString()}건`}
                desc={sum.by_kind.map((k) => `${k.kind} ${k.count.toLocaleString()}`).join(' · ')}
              />
            </div>
            {/* 눈여겨볼 것 — **세기만 한다.** 이상하다고 말하지 않는다. */}
            {sum.watch.map((w) => (
              <div className="wire-repeat-card" key={w.key}>
                <Item title={`${w.label} ${w.count.toLocaleString()}건`} />
              </div>
            ))}
          </>
        )}
      </Card>

      {sum !== null && sum.actors.length > 0 && (
        <Card title="누가 얼마나 열었나" hint="이름을 누르면 그 사람이 한 일만 봐요.">
          {sum.actors.map((a) => (
            <div className="wire-repeat-card" key={a.actor_id}>
              <Item
                title={a.name}
                desc={`당사자 ${a.cases}명 · ${a.hits.toLocaleString()}회 · 맡지 않은 당사자 ${a.off_assignment.toLocaleString()}회`}
                action={
                  <Button
                    variant={actor?.id === a.actor_id ? 'primary' : 'secondary'}
                    onClick={() =>
                      setActor(actor?.id === a.actor_id ? null : { id: a.actor_id, name: a.name })
                    }
                  >
                    {actor?.id === a.actor_id ? '좁히기 풀기' : '이 사람만'}
                  </Button>
                }
              />
            </div>
          ))}
        </Card>
      )}

      <Card
        title={embedded ? '열람 기록 관리' : '최근 200건'}
        hint="누가 누구의 것을 무엇 했는지예요. 목록을 여는 것은 남기지 않고, 같은 사람이 같은 당사자를 10분 안에 다시 열면 한 줄로 접어요."
      >
        <div className="info-tabs">
          {KINDS.map((k) => (
            <button type="button" key={k} className="wire-step" data-active={kind === k} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>

        {narrowed && (
          <div className="wire-repeat-card">
            <Item
              title={
                <>
                  {actor && <Badge tone="lavender">{actor.name}가 한 일</Badge>}{' '}
                  {subject && <Badge tone="blue">{subject.name}에 대한 일</Badge>}
                </>
              }
              desc="좁혀 보는 중이에요."
              action={
                <Button
                  onClick={() => {
                    setActor(null);
                    setSubject(null);
                  }}
                >
                  전체로
                </Button>
              }
            />
          </div>
        )}

        <Field label="찾기" htmlFor="audit-q" hint="이름 · 사업 · 한 일. 불러온 것 안에서 찾아요.">
          <input id="audit-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>

        {rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows !== null && shown.length === 0 && <Empty>해당하는 기록이 없어요.</Empty>}
        {shown.map((r) => (
          <Item
            key={r.id}
            title={
              <>
                <Badge tone={TONE[r.kind]}>{r.kind}</Badge> {r.label}
                {r.subject || r.pseudonym ? ` · ${r.subject ?? r.pseudonym}` : ''}
                {r.off_assignment && ' · 맡은 당사자가 아니에요'}
              </>
            }
            desc={[
              when(r.at),
              r.by_participant ? '당사자 본인' : (r.actor_name ?? '알 수 없음'),
              r.program_name,
              r.fields.map(fieldText).join(' · '),
            ]
              .filter(Boolean)
              .join(' · ')}
            action={
              <>
                {r.actor_id !== null && actor?.id !== r.actor_id && (
                  <Button
                    onClick={() => setActor({ id: r.actor_id as number, name: r.actor_name ?? '알 수 없음' })}
                  >
                    이 사람만
                  </Button>
                )}
                {r.case_id !== null && subject?.caseId !== r.case_id && (
                  <Button
                    onClick={() =>
                      setSubject({
                        caseId: r.case_id as number,
                        name: r.subject ?? r.pseudonym ?? '이 당사자',
                      })
                    }
                  >
                    이 당사자만
                  </Button>
                )}
              </>
            }
          />
        ))}
        {rows !== null && rows.length > shown.length + 0 && shown.length === 200 && (
          <Empty>200건까지 보여요. 기간을 줄이거나 좁혀서 보세요.</Empty>
        )}
      </Card>

      <Card
        title="내려받기"
        hint="지금 걸어 둔 기간과 좁히기가 그대로 실려요. 어느 쪽으로 내렸는지가 열람 기록에 남아요."
      >
        <Field
          label="당사자 표기"
          htmlFor="csv-names"
          control="select"
          hint="기관 밖으로 내보낼 때는 가명이 안전해요. 실명 파일에는 우리 보유기간도 삭제 장치도 닿지 않아요."
        >
          <select id="csv-names" value={withNames ? 'name' : 'pseudonym'} onChange={(e) => setWithNames(e.target.value === 'name')}>
            <option value="pseudonym">가명만 — 외부 제출용</option>
            <option value="name">이름 포함 — 기관 안에서만</option>
          </select>
        </Field>
        <FormActions>
          <a className="wire-button" data-variant="primary" href={auditCsvHref(query, withNames)}>
            <span className="wire-button-text">CSV 로 내려받기</span>
          </a>
        </FormActions>
      </Card>
    </>
  );
}
