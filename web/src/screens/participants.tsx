// 당사자 목록. CCC apps/web/app/components/wire/participant-card.tsx와
// participants/page.tsx의 이름·상태·정보 행·카드 링크 구조를 이식했다(Apache-2.0).
// 서버 계약은 그대로 쓴다. 목록에 없는 연락처를 얻으려고 상담 상세를 미리 읽지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { getCaseDetail, listParticipants, type ParticipantRow } from '../api.ts';
import { Button, Card, Chevron, Empty, Meta, PageHeader, Select } from '../ui.tsx';
import './participants.css';
import { dateTimeLabel } from '../date-time.ts';

// 날짜·일시 표기는 `date-time.ts` 한 곳이다(2026-09-18 Q — `2026.09.21.(월) AM 10:26`).
const displayName = (row: ParticipantRow) => (row.can_access && row.name) || row.pseudonym;
const workersOf = (row: ParticipantRow) => row.assignees.map((a) => a.name);

/** 상태는 배지가 아니라 이름 뒤 컬러 텍스트다(2026-09-18 Q A3). 배지는 면이 커서 목록에서 줄을 밀었다. */
const STATE_TONE = { need_assign: 'warn', open: 'mint', closed: 'neutral' } as const;

/** 상태 걸개는 하나의 선택창이다 — 배정·진행·종결이 서로 배타적인 자리다. */
const STATUS = [
  { key: 'all', label: '상태 전체' },
  { key: 'need_assign', label: '배정 필요' },
  { key: 'open', label: '진행 중' },
  { key: 'closed', label: '종결' },
] as const;
/** 한 쪽은 열 장이다(2026-09-17 Q). 목록은 1열이라 열 줄이고, 카드는 접힌다(2026-09-18 Q A4). */
const PAGE_SIZE = 10;
const SORTS = [
  { key: 'name', label: '가나다순' },
  { key: 'date_asc', label: '다음 상담 이른 순' },
  { key: 'date_desc', label: '다음 상담 늦은 순' },
] as const;

/**
 * `initialProgramId` 는 사업 목록에서 `당사자 목록` 링크로 건너올 때 얹힌다(`#/participants?program=<id>`).
 * 새 페이지가 아니라 같은 목록에 걸개가 걸린 채 열리는 것이다(2026-09-17 Q).
 */
export function ParticipantsScreen({
  initialProgramId = null,
}: {
  initialProgramId?: number | null;
}) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  // 사업 걸개는 id 로 건다 — 이름은 바뀔 수 있다.
  const [program, setProgram] = useState(initialProgramId ? String(initialProgramId) : 'all');
  const [worker, setWorker] = useState('all');
  const [sort, setSort] = useState<string>('name');
  const [page, setPage] = useState(1);
  /**
   * 연락처·이메일은 목록 API 가 주지 않는다. **카드를 펼칠 때 그 사례만** `GET /cases/:id/detail`
   * 로 부른다(2026-09-18 Q A4 — 구 규칙은 보이는 열 건을 미리 불러 감사 줄을 열 개씩 남겼다).
   * 한 번 부른 사례는 다시 부르지 않는다.
   */
  const [contacts, setContacts] = useState<Record<number, 'loading' | 'error' | { phone: string | null; email: string | null }>>({});

  useEffect(() => {
    void listParticipants().then(setRows);
  }, []);

  // 걸개 선택창의 값은 목록이 만든다 — 없는 사업·없는 실무자를 고르게 두지 않는다.
  const { programs, workers } = useMemo(() => {
    const programs = new Map<number, string>();
    const workers = new Set<string>();
    for (const row of rows ?? []) {
      programs.set(row.program_id, row.program_name);
      for (const name of workersOf(row)) workers.add(name);
    }
    const ko = (a: string, b: string) => a.localeCompare(b, 'ko');
    return {
      programs: [...programs].sort(([, a], [, b]) => ko(a, b)),
      workers: [...workers].sort(ko),
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const picked = (rows ?? []).filter((row) => {
      if (needle && ![displayName(row), row.pseudonym, row.program_name, ...workersOf(row)]
        .some((v) => v.toLowerCase().includes(needle))) return false;
      if (status === 'need_assign' && row.can_access) return false;
      if (status === 'open' && row.status !== 'open') return false;
      if (status === 'closed' && row.status !== 'closed') return false;
      if (program !== 'all' && row.program_id !== Number(program)) return false;
      if (worker === 'none' && row.assignees.length > 0) return false;
      if (worker !== 'all' && worker !== 'none' && !workersOf(row).includes(worker)) return false;
      return true;
    });
    // 다음 상담이 없는 사람은 날짜 정렬에서 뒤로 보낸다 — 빈 값이 맨 앞에 서면 목록이 뒤집힌다.
    const byName = (a: ParticipantRow, b: ParticipantRow) => displayName(a).localeCompare(displayName(b), 'ko');
    const byDate = (a: ParticipantRow, b: ParticipantRow, dir: 1 | -1) => {
      if (!a.next_scheduled_at || !b.next_scheduled_at) {
        if (a.next_scheduled_at) return -1;
        if (b.next_scheduled_at) return 1;
        return byName(a, b);
      }
      return dir * a.next_scheduled_at.localeCompare(b.next_scheduled_at);
    };
    return picked.sort((a, b) =>
      sort === 'date_asc' ? byDate(a, b, 1) : sort === 'date_desc' ? byDate(a, b, -1) : byName(a, b),
    );
  }, [rows, q, status, program, worker, sort]);

  // 걸개·정렬·찾기를 바꾸면 첫 쪽으로 돌아간다 — 3쪽에 있던 사람이 사라진 목록에 남지 않는다.
  useEffect(() => { setPage(1); }, [q, status, program, worker, sort]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // 현황판 숫자(2026-09-17 Q). 종결은 세지 않는다.
  const stats = useMemo(() => {
    const all = rows ?? [];
    const workerNames = new Set<string>();
    for (const row of all) for (const name of workersOf(row)) workerNames.add(name);
    return {
      total: all.length,
      open: all.filter((row) => row.status === 'open').length,
      needAssign: all.filter((row) => !row.can_access).length,
      workers: workerNames.size,
    };
  }, [rows]);

  /** 카드를 펼칠 때 한 번. 실패도 기억한다 — 여닫기를 되풀이해도 요청이 쌓이지 않는다. */
  const openContact = (caseId: number) => {
    if (contacts[caseId]) return;
    setContacts((prev) => ({ ...prev, [caseId]: 'loading' }));
    void getCaseDetail(caseId)
      .then((detail) =>
        setContacts((prev) => ({
          ...prev,
          [caseId]: { phone: detail.participant.phone, email: detail.participant.email },
        })),
      )
      .catch(() => setContacts((prev) => ({ ...prev, [caseId]: 'error' })));
  };

  return (
    <>
      <PageHeader title="당사자 목록" />
      <div className="wire-container participant-search-layout">
        {/* 업무 바 한 줄: 왼쪽은 검색칸(라벨 없이 `aria-label` 만), 오른쪽은 걸개와 정렬이다
            (2026-09-17 Q — 구 `찾기` 카드 제목과 전폭 입력칸을 걷었다). */}
        <div className="work-toolbar participant-toolbar">
          <div className="wire-input-box participant-toolbar-search">
            <input
              id="q"
              type="search"
              aria-label="찾기"
              placeholder="이름, 가명, 사업 이름, 실무자"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="participant-toolbar-actions">
            <Select id="filter-status" aria-label="상태 걸개" value={status} onChange={setStatus}>
              {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
            <Select id="filter-program" aria-label="사업명 걸개" value={program} onChange={setProgram}>
              <option value="all">사업 전체</option>
              {programs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
            <Select id="filter-worker" aria-label="담당 실무자 걸개" value={worker} onChange={setWorker}>
              <option value="all">실무자 전체</option>
              <option value="none">미배정</option>
              {workers.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
            <Select id="sort-order" aria-label="정렬" value={sort} onChange={setSort}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>
        </div>

        {/* 현황판(2026-09-17 Q). 걸개 아래, 목록 위에서 지금 무엇을 보고 있는지 말한다. */}
        {rows !== null && (
          <div className="work-toolbar participant-stats">
            {([
              ['보이는 사람', `${shown.length}명`],
              ['전체', `${stats.total}명`],
              ['진행 중', `${stats.open}명`],
              ['배정 필요', `${stats.needAssign}명`],
              ['담당 실무자', `${stats.workers}명`],
            ] as Array<[string, string]>).map(([label, value]) => (
              <div className="participant-stat" key={label}>
                <span className="participant-stat-label" data-tone={label === '배정 필요' ? 'warn' : undefined}>{label}</span>
                <strong className="participant-stat-value">{value}</strong>
              </div>
            ))}
          </div>
        )}

        {rows === null && <Empty>불러오는 중</Empty>}
        {rows !== null && shown.length === 0 && (
          <Card>
            <Empty>{q ? '검색 결과 없음' : '등록한 당사자 없음'}</Empty>
          </Card>
        )}

        <div className="participant-list">
          {pageRows.map((row) => {
            const name = displayName(row);
            const contact = contacts[row.case_id];
            const state = !row.can_access ? 'need_assign' : row.status === 'open' ? 'open' : 'closed';
            // 접힌 줄은 한 행이다: 이름 · 상태 · 아이디 · 사업명 회차 · 다음 상담.
            // 권한 때문에 비워 온 회차는 '기록 없음'으로 바꾸지 않는다 — 아예 말하지 않는다.
            const meta = [
              name === row.pseudonym ? null : row.pseudonym,
              row.can_access && row.last_session_seq
                ? `${row.program_name} ${row.last_session_seq}회차`
                : row.program_name,
              row.can_access && row.next_scheduled_at
                ? `다음 상담 ${dateTimeLabel(row.next_scheduled_at)}`
                : null,
            ];
            const reach = contact === 'loading'
              ? ([['연락처', '불러오는 중']] as Array<[string, string]>)
              : contact === 'error'
                ? ([['연락처', '불러오기 실패']] as Array<[string, string]>)
                : ([
                    ['연락처', contact?.phone ?? ''],
                    ['이메일', contact?.email ?? ''],
                    ['담당 실무자', workersOf(row).join(', ')],
                  ] as Array<[string, string]>).filter(([, value]) => value !== '');
            /**
             * 카드는 접힘 카드다(2026-09-18 Q A2·A4 — 일정 화면의 `Fold` 와 같은 골격).
             * 공용 `Fold`(ui.tsx)를 그대로 쓰지 못하는 것은 `className` 을 받지 않아
             * 카드 요소에 `.participant-card`(§3 실측 단언이 재는 이름)를 붙일 수 없기 때문이다.
             * `Fold` 에 `className` 이 생기면 이 지역 마크업은 지운다(PR 요청).
             */
            return (
              <details
                key={row.case_id}
                className="surface-card wire-card wire-card-details participant-card"
                name="participant-list"
                onToggle={(event) => {
                  if (event.currentTarget.open && row.can_access) openContact(row.case_id);
                }}
              >
                <summary className="wire-card-summary">
                  <span className="wire-card-title">
                    <span className="fold-head">
                      <span className="participant-name-group participant-card-name-group" data-size="row">
                        <span className={`participant-name participant-card-name${name === row.pseudonym ? ' is-empty' : ''}`}>
                          {name}
                        </span>
                      </span>
                      {/* 상태는 컬러 텍스트로 이름 뒤에 붙는다(A3) — 배지 면을 두지 않는다. */}
                      <span className="participant-state" data-tone={STATE_TONE[state]}>
                        {state === 'need_assign' ? '배정 필요' : state === 'open' ? '진행 중' : '종결'}
                      </span>
                      <span className="participant-card-id"><Meta parts={meta} /></span>
                    </span>
                  </span>
                  <span className="wire-card-summary-right">
                    {/* 행동 둘은 오른쪽 끝에 선다(A2). 배정이 없으면 열 수 없으므로 그리지 않는다. */}
                    {row.can_access && (
                      <span className="wire-item-action">
                        <a
                          className="wire-button"
                          data-variant="secondary"
                          href={`#/cases/${row.case_id}/info`}
                          aria-label={`${name}, ${row.program_name}, 당사자 정보`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="wire-button-text">당사자 정보</span>
                        </a>
                        {/* 기록은 늘 일정 예약을 지난다(Q 결정 D1) — 일시를 확인하지 않은 기록을 막는다. */}
                        <a
                          className="wire-button"
                          data-variant="secondary"
                          href={`#/cases/${row.case_id}/schedule?then=record`}
                          aria-label={`${name}, ${row.program_name}, 상담 기록하기`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="wire-button-text">상담 기록하기</span>
                        </a>
                      </span>
                    )}
                    <span className="wire-chevron-button wire-disclosure-chevron" aria-hidden="true">
                      <Chevron dir="down" />
                    </span>
                  </span>
                </summary>
                <div className="wire-card-body">
                  {reach.length === 0 ? (
                    <Empty>연락처 없음</Empty>
                  ) : (
                    <div className="participant-card-fields">
                      {reach.map(([label, value]) => (
                        <div className="wire-field-row" data-layout="stack" data-size="sm" key={label}>
                          <span className="wire-field-label">{label}</span>
                          <span className="wire-field-value">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
        {/* 쪽 나누기(2026-09-17 Q). 한 쪽 열 장이고 넘기는 자리는 가운데다. */}
        {pages > 1 && (
          <nav className="participant-pager" aria-label="쪽 넘기기">
            <Button aria-label="이전 쪽" disabled={current === 1} onClick={() => setPage(current - 1)}>
              <Chevron dir="left" />
            </Button>
            <p className="participant-pager-label" aria-live="polite">
              {current} / {pages} 쪽
            </p>
            <Button aria-label="다음 쪽" disabled={current === pages} onClick={() => setPage(current + 1)}>
              <Chevron dir="right" />
            </Button>
          </nav>
        )}
      </div>
    </>
  );
}
