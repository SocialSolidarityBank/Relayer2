// 당사자 목록. CCC apps/web/app/components/wire/participant-card.tsx와
// participants/page.tsx의 이름·상태·정보 행·카드 링크 구조를 이식했다(Apache-2.0).
// 서버 계약은 그대로 쓴다. 목록에 없는 연락처를 얻으려고 상담 상세를 미리 읽지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCaseDetail, listParticipants, type ParticipantRow } from '../api.ts';
import { Badge, Button, Card, Chevron, Empty, Meta, PageHeader, Select } from '../ui.tsx';
import './participants.css';

const scheduleDate = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const displayName = (row: ParticipantRow) => (row.can_access && row.name) || row.pseudonym;
const workersOf = (row: ParticipantRow) => row.assignees.map((a) => a.name);

/** 무엇을 하러 왔는가. 메뉴에서 사례 없이 눌렀을 때 붙는다. */
export type PickFor = 'record' | 'schedule' | null;

/**
 * 제목은 **사이드바 메뉴와 같은 이름**이다(2026-09-17 Q). `누구의 일정을 잡을까요` 같은
 * 질문형 제목은 이 두 화면에만 있던 말투였다 — 누구를 고르는 자리라는 건 목록이 말한다.
 */
const PURPOSE: Record<Exclude<PickFor, null>, { title: string; go: string; label: string }> = {
  record: { title: '상담 기록하기', go: 'record', label: '상담 기록하기' },
  schedule: { title: '상담 일정 등록', go: 'schedule', label: '상담 일정 등록' },
};

/** 상태 걸개는 하나의 선택창이다 — 배정·진행·종결이 서로 배타적인 자리다. */
const STATUS = [
  { key: 'all', label: '상태 전체' },
  { key: 'need_assign', label: '배정 필요' },
  { key: 'open', label: '진행 중' },
  { key: 'closed', label: '종결' },
] as const;
/** 한 쪽은 열 장이다(2026-09-17 Q — 2열 × 5행, 화면을 굴리지 않고 한눈에 든다). */
const PAGE_SIZE = 10;
const SORTS = [
  { key: 'name', label: '가나다순' },
  { key: 'date_asc', label: '다음 상담 이른 순' },
  { key: 'date_desc', label: '다음 상담 늦은 순' },
] as const;

export function ParticipantsScreen({ pickFor = null }: { pickFor?: PickFor }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');
  // 고르기 모드(기록·일정)는 진행 중 사례가 기본이다 — 종결 사례는 새 기록·일정을 받지 않는다.
  const [status, setStatus] = useState<string>(pickFor ? 'open' : 'all');
  const [program, setProgram] = useState('all');
  const [worker, setWorker] = useState('all');
  const [sort, setSort] = useState<string>('name');
  const [page, setPage] = useState(1);
  /**
   * 연락처·이메일은 목록 API 가 주지 않는다. 아코디언이 없으니 카드에 바로 드러나야 해서
   * (2026-09-17 Q) **보이는 쪽의 열 건만** `GET /cases/:id/detail` 로 따로 부른다.
   * 한 번 부른 사례는 다시 부르지 않는다 — 쪽을 오가도 요청과 감사 줄이 늘지 않는다.
   */
  const [contacts, setContacts] = useState<Record<number, { phone: string | null; email: string | null }>>({});
  const asked = useRef<Set<number>>(new Set());

  useEffect(() => {
    void listParticipants().then(setRows);
  }, []);

  // 걸개 선택창의 값은 목록이 만든다 — 없는 사업·없는 실무자를 고르게 두지 않는다.
  const { programs, workers } = useMemo(() => {
    const programs = new Set<string>();
    const workers = new Set<string>();
    for (const row of rows ?? []) {
      programs.add(row.program_name);
      for (const name of workersOf(row)) workers.add(name);
    }
    const ko = (a: string, b: string) => a.localeCompare(b, 'ko');
    return { programs: [...programs].sort(ko), workers: [...workers].sort(ko) };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const picked = (rows ?? []).filter((row) => {
      if (needle && ![displayName(row), row.pseudonym, row.program_name, ...workersOf(row)]
        .some((v) => v.toLowerCase().includes(needle))) return false;
      if (status === 'need_assign' && row.can_access) return false;
      if (status === 'open' && row.status !== 'open') return false;
      if (status === 'closed' && row.status !== 'closed') return false;
      if (program !== 'all' && row.program_name !== program) return false;
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

  useEffect(() => {
    for (const row of pageRows) {
      if (!row.can_access || asked.current.has(row.case_id)) continue;
      asked.current.add(row.case_id);
      void getCaseDetail(row.case_id)
        .then((detail) =>
          setContacts((prev) => ({
            ...prev,
            [row.case_id]: { phone: detail.participant.phone, email: detail.participant.email },
          })),
        )
        .catch(() => {});
    }
  }, [pageRows]);

  const purpose = pickFor ? PURPOSE[pickFor] : null;

  return (
    <>
      <PageHeader title={purpose ? purpose.title : '당사자 목록'} />
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
              {programs.map((name) => <option key={name} value={name}>{name}</option>)}
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
                <span className="participant-stat-label">{label}</span>
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

        <div className="participant-row-list">
          {pageRows.map((row) => {
            const name = displayName(row);
            const contact = contacts[row.case_id];
            // 첫 줄은 누구인가(2026-09-17 Q): 이름 · 아이디 · 사업명 회차. 담당 실무자는 걷었다 —
            // 실무자는 자기 담당만 보고, 관리자는 위 걸개로 가른다.
            // 권한 때문에 비워 온 회차는 '기록 없음'으로 바꾸지 않는다 — 아예 말하지 않는다.
            const meta = [
              name === row.pseudonym ? null : row.pseudonym,
              row.can_access && row.last_session_seq
                ? `${row.program_name} ${row.last_session_seq}회차`
                : row.program_name,
            ];
            // 둘째 줄은 어떻게 닿고 언제 만나나. 아코디언이 없으니 여기서 바로 드러난다.
            const reach = [
              contact?.phone ?? null,
              contact?.email ?? null,
              row.can_access && row.next_scheduled_at
                ? `다음 상담 ${scheduleDate.format(new Date(row.next_scheduled_at))}`
                : null,
            ];
            const card = (
              <article className="surface-card participant-card" data-variant="list">
                <header className="participant-card-header">
                  <span className="participant-card-identity">
                    <span className="participant-name-group participant-card-name-group" data-size="row">
                      <span className={`participant-name participant-card-name${name === row.pseudonym ? ' is-empty' : ''}`}>
                        {name}
                      </span>
                    </span>
                    <span className="participant-card-id"><Meta parts={meta} /></span>
                  </span>
                  <span className="participant-card-badges">
                    {!row.can_access && <Badge>배정 필요</Badge>}
                    <Badge tone={row.status === 'open' ? 'mint' : undefined}>
                      {row.status === 'open' ? '진행 중' : '종결'}
                    </Badge>
                  </span>
                </header>
                {reach.some(Boolean) && <p className="participant-card-reach"><Meta parts={reach} /></p>}
              </article>
            );
            return (
              <div key={row.case_id}>
                {row.can_access ? (
                  <a
                    className="participant-card-link"
                    href={`#/cases/${row.case_id}/${purpose?.go ?? 'info'}`}
                    aria-label={`${name}, ${row.program_name}, ${purpose?.label ?? '당사자 정보'}`}
                  >
                    {card}
                  </a>
                ) : (
                  <div className="participant-card-link">{card}</div>
                )}
              </div>
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
