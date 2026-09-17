// 홈 — 다가오는 상담. 아침에 열어서 오늘 누구를 만나는지 보는 자리다.
// 여기서 그 사람의 당사자 정보로 바로 넘어간다(2026-09-17 Q — 15초 다시보기 폐지).
import { useEffect, useState } from 'react';
import { listSchedules, type ScheduleRow } from '../api.ts';
import { Badge, Button, Card, Empty, Item, PageHeader } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';

const DAY = 86_400_000;

/** 오늘·내일은 이름으로, 나머지는 날짜로 부른다. 사람이 날짜를 세지 않게 한다. */
function dayLabel(at: Date): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((at.getTime() - midnight.getTime()) / DAY);
  if (days < 0) return '지난 일정';
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  if (days < 7) return `${days}일 뒤`;
  return `${at.getMonth() + 1}월 ${at.getDate()}일`;
}

const timeLabel = (at: Date): string =>
  at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

export function HomeScreen() {
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);

  useEffect(() => {
    void listSchedules().then(setRows);
  }, []);

  const groups = new Map<string, ScheduleRow[]>();
  for (const row of rows ?? []) {
    const key = dayLabel(new Date(row.scheduled_at));
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }

  return (
    <>
      {/* 메뉴는 사례에 따라 바뀌지 않는다(2026-09-17 Q — 구 '마지막으로 연 사례 기억' 폐지).
          기록·일정 등록은 늘 누구 것인지 먼저 묻는다. */}
      <PageHeader title="일정" meta="앞으로 30일" />
      <div className="wire-container">
        {rows === null && <Empty>불러오는 중이에요.</Empty>}
        {rows?.length === 0 && (
          <Card title="일정">
            <Empty>
              잡힌 상담이 없어요. <a href="#/participants">당사자 목록</a>에서 일정을 등록하거나, 이미 만난
              상담이면 그 사람의 상담 기록하기에서 바로 적으면 돼요.
            </Empty>
          </Card>
        )}
        {[...groups].map(([day, items]) => (
          <Card key={day} title={day} hint={`${items.length}건`}>
            {items.map((row) => (
              <Item
                key={row.session_id}
                title={`${timeLabel(new Date(row.scheduled_at))} · ${row.name ?? row.pseudonym} · ${row.seq}회차`}
                desc={
                  <>
                    {[
                      row.program_name,
                      row.method ? (METHOD_LABEL[row.method] ?? row.method) : null,
                      row.place,
                      row.plan_memo,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {(row.open_tasks > 0 || row.open_questions > 0) && (
                      <span className="home-open">
                        {row.open_tasks > 0 && <Badge tone="lavender">{`확인할 과제 ${row.open_tasks}`}</Badge>}
                        {row.open_questions > 0 && <Badge tone="blue">{`물어볼 것 ${row.open_questions}`}</Badge>}
                      </span>
                    )}
                  </>
                }
                action={
                  <Button onClick={() => (window.location.hash = `#/cases/${row.case_id}/info`)}>
                    당사자 정보
                  </Button>
                }
              />
            ))}
          </Card>
        ))}
      </div>
    </>
  );
}
