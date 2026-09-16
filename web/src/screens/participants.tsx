// 당사자 목록 — 기존 사례로 돌아가는 유일한 길이자, **당사자를 고르는 자리**다.
//
// 상담 기록하기·상담 일정 등록은 누구의 것인지 정해야 열린다. 사례가 안 정해진 채로 그 메뉴를
// 누르면 여기로 온다. 그때는 무엇을 하러 왔는지 위에 적고, 카드마다 그 버튼을 앞세운다.
//
// 이름은 금고 암호문이라 서버가 검색하지 못한다. 받아 온 목록을 화면에서 거른다(기관 하나 규모).
import { useEffect, useMemo, useState } from 'react';
import { listParticipants, requestAssignment, type ParticipantRow } from '../api.ts';
import { Button, Card, Empty, ErrorText, Field, Fold, FormActions, PageHeader } from '../ui.tsx';

const dateLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

function sessionLabel(row: ParticipantRow): string {
  const parts: string[] = [row.program_name];
  // 배정되지 않은 사례는 회차·일정이 서버에서 비워 온다 — '기록 없음'이라 적으면 거짓말이다.
  if (row.can_access) {
    parts.push(row.last_session_seq ? `${row.last_session_seq}회차까지 기록` : '기록 없음');
    if (row.next_scheduled_at) parts.push(`다음 ${dateLabel(row.next_scheduled_at)}`);
  }
  if (row.status === 'closed') parts.push('종결');
  return parts.join(' · ');
}

/** 무엇을 하러 왔는가. 메뉴에서 사례 없이 눌렀을 때 붙는다. */
export type PickFor = 'record' | 'schedule' | null;

const PURPOSE: Record<Exclude<PickFor, null>, { title: string; go: string; label: string }> = {
  record: { title: '누구의 상담을 기록할까요', go: 'record', label: '상담 기록하기' },
  schedule: { title: '누구의 일정을 잡을까요', go: 'schedule', label: '상담 일정 등록' },
};

export function ParticipantsScreen({
  pickFor = null,
  me,
}: {
  pickFor?: PickFor;
  me?: { id: number; role: string };
}) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');
  // 배정 요청을 올린 뒤 그 자리에서 알려 준다. 목록을 떠나 설정까지 가서야 결과를 보면
  // "눌린 건가" 하고 다시 누르게 된다.
  // **성공과 실패를 갈라 둔다**(2026-09-16 검수) — 한 칸에 담았더니 실패 문구가 버튼을 잠가
  // 네트워크가 돌아와도 다시 누를 수 없었다.
  const [asked, setAsked] = useState<Record<number, true>>({});
  const [askError, setAskError] = useState<Record<number, string>>({});

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

  const purpose = pickFor ? PURPOSE[pickFor] : null;
  const go = (caseId: number, where: string) => (window.location.hash = `#/cases/${caseId}/${where}`);

  return (
    <>
      <PageHeader
        title={purpose ? purpose.title : '당사자 목록'}
        meta={rows ? `${rows.length}명` : undefined}
      />
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

        {/* 카드는 접혀 있다. 이름과 한 줄 요약만 보고 고르고, 펼쳐야 할 일이 나온다.
            사람이 많아도 한 화면에 들어오게 하려는 것이다. */}
        {shown.map((row) => (
          <Fold
            key={row.case_id}
            title={row.can_access ? (row.name ?? row.pseudonym) : row.pseudonym}
            desc={
              row.can_access
                ? `${sessionLabel(row)}${row.assignees.length > 0 ? ` · 담당 ${row.assignees.map((a) => a.name).join(', ')}` : ' · 담당 없음'}`
                : `${sessionLabel(row)} · 배정 필요${row.assignees.length > 0 ? ` · 담당 ${row.assignees.map((a) => a.name).join(', ')}` : ''}`
            }
            // 찾아서 하나만 남았으면 펼쳐 둔다. 한 명을 보려고 또 누르게 하지 않는다.
            open={shown.length === 1}
          >
            <FormActions>
              {/* 배정된 사람에게만 사례로 가는 길을 연다. 아닌 사람에게는 가명과
                  '배정 필요'만 보이고, 맡겠다고 손드는 것만 남는다. */}
              {row.can_access && (
                <>
                  {purpose && (
                    <Button variant="primary" onClick={() => go(row.case_id, purpose.go)}>
                      {purpose.label}
                    </Button>
                  )}
                  <Button onClick={() => go(row.case_id, 'info')}>당사자 정보</Button>
                  <Button onClick={() => go(row.case_id, 'briefing')}>15초 다시보기</Button>
                  {/* 인테이크는 아직 안 쓴 사람에게만 뜬다. 다 쓴 사람에게 또 권하지 않는다. */}
                  {!row.last_session_seq && (
                    <Button onClick={() => go(row.case_id, 'intake')}>인테이크 작성하기</Button>
                  )}
                  {!purpose && (
                    <>
                      <Button onClick={() => go(row.case_id, 'record')}>상담 기록하기</Button>
                      <Button onClick={() => go(row.case_id, 'schedule')}>상담 일정 등록</Button>
                    </>
                  )}
                </>
              )}
              {/* 내 담당이 아닌 사람은 맡겠다고 손들 수 있다. 확정은 관리자 몫이다
                  (GLOSSARY 배정 규칙 — 실무자의 수락 단계는 없고, 관리자 확정이 곧 효력이다). */}
              {me && !row.can_access && (
                <>
                  <Button
                    disabled={asked[row.case_id] === true}
                    onClick={() =>
                      void requestAssignment(row.case_id, null)
                        .then(() => {
                          setAsked((p) => ({ ...p, [row.case_id]: true }));
                          setAskError((p) => ({ ...p, [row.case_id]: '' }));
                        })
                        .catch((e: unknown) =>
                          setAskError((p) => ({
                            ...p,
                            [row.case_id]: e instanceof Error ? e.message : '올리지 못했어요',
                          })),
                        )
                    }
                  >
                    {asked[row.case_id] ? '요청했어요' : '내가 맡기'}
                  </Button>
                  {askError[row.case_id] && <ErrorText>{askError[row.case_id]}</ErrorText>}
                </>
              )}
            </FormActions>
          </Fold>
        ))}
      </div>
    </>
  );
}
