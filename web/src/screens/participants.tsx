// 당사자 목록. CCC apps/web/app/components/wire/participant-card.tsx와
// participants/page.tsx의 이름·상태·정보 행·카드 링크 구조를 이식했다(Apache-2.0).
// 서버 계약은 그대로 쓴다. 목록에 없는 연락처를 얻으려고 상담 상세를 미리 읽지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { listParticipants, type ParticipantRow } from '../api.ts';
import { Badge, Card, Empty, PageHeader, Select } from '../ui.tsx';
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
const SORTS = [
  { key: 'name', label: '가나다순' },
  { key: 'date_asc', label: '다음 상담 이른 순' },
  { key: 'date_desc', label: '다음 상담 늦은 순' },
] as const;

export function ParticipantsScreen({ pickFor = null }: { pickFor?: PickFor }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [program, setProgram] = useState('all');
  const [worker, setWorker] = useState('all');
  const [sort, setSort] = useState<string>('name');

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

  const purpose = pickFor ? PURPOSE[pickFor] : null;

  return (
    <>
      <PageHeader
        title={purpose ? purpose.title : '당사자 목록'}
        meta={rows ? (shown.length === rows.length ? `${rows.length}명` : `${shown.length}명 / 전체 ${rows.length}명`) : undefined}
      />
      <div className="wire-container participant-search-layout">
        {/* 업무 바 한 줄: 왼쪽은 검색칸(라벨 없이 `aria-label` 만), 오른쪽은 걸개와 정렬이다
            (2026-09-17 Q — 구 `찾기` 카드 제목과 전폭 입력칸을 걷었다). */}
        <div className="work-toolbar participant-toolbar">
          <div className="wire-input-box participant-toolbar-search">
            <input
              id="q"
              type="search"
              aria-label="찾기"
              placeholder="이름 · 가명 · 사업 이름 · 실무자"
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

        {rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows !== null && shown.length === 0 && (
          <Card>
            <Empty>{q ? '찾는 사람이 없어요.' : '아직 등록한 당사자가 없어요.'}</Empty>
          </Card>
        )}

        <div className="participant-row-list">
          {shown.map((row) => {
            const name = displayName(row);
            // 한 행에 다 넣는다(2026-09-17 Q): 이름 · 아이디 · 담당 실무자 · 사업명 회차.
            // 권한 때문에 비워 온 회차는 '기록 없음'으로 바꾸지 않는다 — 아예 말하지 않는다.
            const meta = [
              name === row.pseudonym ? null : row.pseudonym,
              workersOf(row).join(', ') || '미배정',
              row.can_access && row.last_session_seq
                ? `${row.program_name} ${row.last_session_seq}회차`
                : row.program_name,
              row.can_access && row.next_scheduled_at ? scheduleDate.format(new Date(row.next_scheduled_at)) : null,
            ].filter(Boolean).join(' · ');
            const card = (
              <article className="surface-card participant-card" data-variant="list">
                <header className="participant-card-header">
                  <span className="participant-card-identity">
                    <span className="participant-name-group participant-card-name-group" data-size="row">
                      <span className={`participant-name participant-card-name${name === row.pseudonym ? ' is-empty' : ''}`}>
                        {name}
                      </span>
                    </span>
                    <span className="participant-card-id" title={meta}>{meta}</span>
                  </span>
                  <span className="participant-card-badges">
                    {!row.can_access && <Badge>배정 필요</Badge>}
                    <Badge tone={row.status === 'open' ? 'mint' : undefined}>
                      {row.status === 'open' ? '진행 중' : '종결'}
                    </Badge>
                  </span>
                </header>
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
      </div>
    </>
  );
}
