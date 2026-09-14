// 당사자 목록 — 기존 사례로 돌아가는 유일한 길.
// 이름은 금고 암호문이라 서버가 검색하지 못한다. 받아 온 목록을 화면에서 거른다(기관 하나 규모).
import { useEffect, useMemo, useState } from 'react';
import { listParticipants, type ParticipantRow } from '../api.ts';
import { Button, Card, Empty, Field, Item, PageHeader } from '../ui.tsx';

const dateLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

function sessionLabel(row: ParticipantRow): string {
  const parts: string[] = [row.program_name];
  parts.push(row.last_session_seq ? `${row.last_session_seq}회차까지 기록` : '기록 없음');
  if (row.next_scheduled_at) parts.push(`다음 ${dateLabel(row.next_scheduled_at)}`);
  if (row.status === 'closed') parts.push('종결');
  return parts.join(' · ');
}

export function ParticipantsScreen() {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void listParticipants().then(setRows);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.name, r.pseudonym, r.program_name].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  return (
    <>
      <PageHeader title="당사자 목록" meta={rows ? `${rows.length}명` : undefined} />
      <div className="wire-container">
        <Card>
          <Field label="찾기" htmlFor="q">
            <input
              id="q"
              type="search"
              placeholder="이름 · 가명 · 사업 이름"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
        </Card>

        {rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows !== null && shown.length === 0 && (
          <Card>
            <Empty>{q ? '찾는 사람이 없어요.' : '아직 등록한 당사자가 없어요.'}</Empty>
          </Card>
        )}
        {shown.length > 0 && (
          <Card title="목록">
            {shown.map((row) => (
              <Item
                key={row.case_id}
                title={`${row.name ?? row.pseudonym} · ${row.pseudonym}`}
                desc={sessionLabel(row)}
                action={
                  <>
                    <Button onClick={() => (window.location.hash = `#/cases/${row.case_id}/info`)}>
                      당사자 정보
                    </Button>
                    <Button onClick={() => (window.location.hash = `#/cases/${row.case_id}/briefing`)}>
                      15초 다시보기
                    </Button>
                    <Button onClick={() => (window.location.hash = `#/cases/${row.case_id}/record`)}>
                      상담 기록하기
                    </Button>
                    <Button onClick={() => (window.location.hash = `#/cases/${row.case_id}/schedule`)}>
                      상담 일정 등록
                    </Button>
                  </>
                }
              />
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
