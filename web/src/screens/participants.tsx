// 당사자 목록. CCC apps/web/app/components/wire/participant-card.tsx와
// participants/page.tsx의 이름·상태·정보 행·카드 링크 구조를 이식했다(Apache-2.0).
// 서버 계약은 그대로 쓴다. 목록에 없는 연락처를 얻으려고 상담 상세를 미리 읽지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { listParticipants, type ParticipantRow } from '../api.ts';
import { Badge, Card, Empty, PageHeader } from '../ui.tsx';

const scheduleDate = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const displayName = (row: ParticipantRow) => (row.can_access && row.name) || row.pseudonym;

/** 무엇을 하러 왔는가. 메뉴에서 사례 없이 눌렀을 때 붙는다. */
export type PickFor = 'record' | 'schedule' | null;

const PURPOSE: Record<Exclude<PickFor, null>, { title: string; go: string; label: string }> = {
  record: { title: '누구의 상담을 기록할까요', go: 'record', label: '상담 기록하기' },
  schedule: { title: '누구의 일정을 잡을까요', go: 'schedule', label: '상담 일정 등록' },
};

export function ParticipantsScreen({ pickFor = null }: { pickFor?: PickFor }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void listParticipants().then((data) =>
      setRows(data.sort((a, b) => displayName(a).localeCompare(displayName(b), 'ko'))),
    );
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [displayName(r), r.pseudonym, r.program_name].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const purpose = pickFor ? PURPOSE[pickFor] : null;

  return (
    <>
      <PageHeader
        title={purpose ? purpose.title : '당사자 목록'}
        meta={rows ? `${rows.length}명` : undefined}
      />
      <div className="wire-container">
        {/* 카드의 이름은 `Card title`(16/600 --ink)이다(2026-09-17 Q 제목 위계 점검).
            구 구조는 `찾기`를 폼 라벨(14/600 --sub)로 두고 카드 제목을 비워, 같은 자리에서
            카드마다 글자 크기가 달랐다. 입력의 접근성 이름은 `aria-label`이 갖는다 —
            보이는 라벨을 한 번 더 두면 같은 말이 두 줄로 쌓인다. */}
        <Card title="찾기">
          <div className="wire-input-box">
            <input
              id="q"
              type="search"
              aria-label="찾기"
              placeholder="이름 · 가명 · 사업 이름"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </Card>

        {rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows !== null && shown.length === 0 && (
          <Card>
            <Empty>{q ? '찾는 사람이 없어요.' : '아직 등록한 당사자가 없어요.'}</Empty>
          </Card>
        )}

        <div className="participant-row-list">
          {shown.map((row) => {
            const name = displayName(row);
            const fields: Array<[string, string]> = [
              ['참여 사업', row.program_name],
              ['담당자', row.assignees.map((a) => a.name).join(', ') || '미배정'],
            ];
            // 권한 때문에 비워 온 회차·일정은 '기록 없음'으로 바꾸지 않는다.
            if (row.can_access) {
              fields.push(
                ['상담 기록', row.last_session_seq ? `${row.last_session_seq}회차까지 기록` : '기록 없음'],
                ['다음 상담', row.next_scheduled_at ? scheduleDate.format(new Date(row.next_scheduled_at)) : '예정 없음'],
              );
            }
            const card = (
              <article className="surface-card participant-card" data-variant="list">
                <header className="participant-card-header">
                  <span className="participant-card-identity">
                    <span className="participant-name-group participant-card-name-group" data-size="row">
                      <span className={`participant-name participant-card-name${name === row.pseudonym ? ' is-empty' : ''}`}>
                        {name}
                      </span>
                    </span>
                    {name !== row.pseudonym && <span className="participant-card-id">{row.pseudonym}</span>}
                  </span>
                  <span className="participant-card-badges">
                    {!row.can_access && <Badge>배정 필요</Badge>}
                    <Badge tone={row.status === 'open' ? 'mint' : undefined}>
                      {row.status === 'open' ? '진행 중' : '종결'}
                    </Badge>
                  </span>
                </header>
                <div className="participant-card-fields">
                  {fields.map(([label, value]) => (
                    <div className="wire-field-row" data-compact="true" data-size="sm" data-tone="sub" key={label}>
                      <span className="wire-field-label">{label}</span>
                      <span className="wire-field-value">{value}</span>
                    </div>
                  ))}
                </div>
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
