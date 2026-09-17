// 상담 일정 — 월간 기본, 주간·일간은 시작 시각 기준의 시간표다. 일정의 길이는 추정하지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { listSchedules } from '../api.ts';
import type { ScheduleRow } from '../api.ts';
import { calendarPeriod, calendarTime, koreanDay, shiftPeriod } from '../calendar.ts';
import type { CalendarTime, CalendarView } from '../calendar.ts';
import { DatePicker } from '../date-picker.tsx';
import { Badge, Button, Card, Chevron, Empty, ErrorText, Item, PageHeader, Select } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';
import '../date-time-input.css';
import './home.css';

const VIEWS = [{ key: 'month', label: '월간' }, { key: 'week', label: '주간' }, { key: 'day', label: '일간' }] as const;
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const dayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const shortDayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' });
type CalendarEvent = { row: ScheduleRow; time: CalendarTime };
const EMPTY_EVENTS: CalendarEvent[] = [];

export function HomeScreen() {
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => koreanDay());
  const [selectedDay, setSelectedDay] = useState(anchor);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; rows: ScheduleRow[] | null; error: string | null }>({ key: '', rows: null, error: null });
  const period = useMemo(() => calendarPeriod(view, anchor), [view, anchor]);
  const requestKey = `${period.start}/${period.end}`;
  const rows = loaded.key === requestKey ? loaded.rows : null;
  const error = loaded.key === requestKey ? loaded.error : null;
  const detail = useRef<HTMLElement>(null);
  const timeScroll = useRef<HTMLDivElement>(null);
  const today = koreanDay();
  const selectedDateLabel = dayFormatter.format(new Date(`${selectedDay}T00:00:00Z`));

  useEffect(() => {
    let live = true;
    setLoaded({ key: requestKey, rows: null, error: null });
    void listSchedules(period.start, period.end).then(data => {
      if (live) setLoaded({ key: requestKey, rows: data, error: null });
    }).catch(failure => {
      if (live) setLoaded({ key: requestKey, rows: null, error: failure instanceof Error ? failure.message : '일정을 불러오지 못했어요.' });
    });
    return () => { live = false; };
  }, [period.start, period.end, requestKey, retry]);

  const { byDay, byHour, firstHour } = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>();
    const byHour = new Map<string, CalendarEvent[]>();
    let firstHour = 23;
    for (const row of rows ?? []) {
      const time = calendarTime(row.scheduled_at);
      const event = { row, time };
      const dayEvents = byDay.get(time.day);
      if (dayEvents) dayEvents.push(event); else byDay.set(time.day, [event]);
      const slot = `${time.day}/${time.hour}`;
      const hourEvents = byHour.get(slot);
      if (hourEvents) hourEvents.push(event); else byHour.set(slot, [event]);
      firstHour = Math.min(firstHour, time.hour);
    }
    return { byDay, byHour, firstHour: rows?.length ? firstHour : 9 };
  }, [rows]);

  useEffect(() => {
    if (view === 'month' || !rows || !timeScroll.current) return;
    const row = timeScroll.current.querySelector<HTMLElement>(`[data-hour="${firstHour}"]`);
    const headerHeight = timeScroll.current.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    timeScroll.current.style.scrollPaddingTop = `${headerHeight}px`;
    if (row) timeScroll.current.scrollTop = Math.max(0, row.offsetTop - headerHeight);
  }, [view, rows, firstHour]);
  useEffect(() => {
    if (!detailRequest) return;
    detail.current?.focus({ preventScroll: true });
    detail.current?.scrollIntoView({ block: 'start' });
  }, [detailRequest]);

  const jumpTo = (day: string) => {
    setAnchor(day);
    setSelectedDay(day);
    setSelectedSession(null);
  };
  const changeView = (next: CalendarView) => {
    setView(next);
    setAnchor(selectedDay);
    setSelectedSession(null);
  };
  const showDay = (day: string, sessionId = byDay.get(day)?.[0]?.row.session_id ?? null) => {
    setSelectedDay(day);
    setSelectedSession(sessionId);
    setDetailRequest(n => n + 1);
  };
  const eventButton = ({ row, time }: CalendarEvent) => {
    const name = row.name ?? row.pseudonym;
    const label = `${dayFormatter.format(new Date(`${time.day}T00:00:00Z`))} ${time.label} ${name} ${row.seq}회차 일정 상세`;
    return <button key={row.session_id} type="button" className="sc-event" data-session-id={row.session_id}
      aria-label={label} title={`${label} · ${row.program_name}`} onClick={e => { e.stopPropagation(); showDay(time.day, row.session_id); }}>
      <span className="sc-event-time">{time.label}</span><strong className="sc-event-name">{name}</strong>
    </button>;
  };
  const selectedEvents = byDay.get(selectedDay) ?? EMPTY_EVENTS;

  return <>
    <PageHeader title="상담 일정" meta={rows ? `표시 범위 ${rows.length}건 · 한국 시간 기준` : '한국 시간 기준'} />
    <div className="wire-container sc-page">
      <div className="sc-toolbar">
        <div className="sc-view-select">
          <Select id="schedule-view" aria-label="일정 보기" value={view} onChange={next => changeView(next as CalendarView)}>
            {VIEWS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
          </Select>
        </div>
        <div className="schedule-nav-controls">
          <div className="schedule-nav-period">
            <Button aria-label="이전 기간" onClick={() => jumpTo(shiftPeriod(view, anchor, -1))}><Chevron dir="left" /></Button>
            <DatePicker id="calendar-focus-date" inline label={period.title} value={period.days.includes(selectedDay) ? selectedDay : anchor} onChange={jumpTo}
              hint="고른 날짜가 든 기간으로 이동해요. 일정을 저장하거나 바꾸지는 않아요." />
            <Button aria-label="다음 기간" onClick={() => jumpTo(shiftPeriod(view, anchor, 1))}><Chevron dir="right" /></Button>
          </div>
        </div>
        <Button variant="primary" onClick={() => jumpTo(today)}>오늘</Button>
      </div>
      {error ? <Card><ErrorText>{error}</ErrorText><Button onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button></Card> : <>
        {!rows && <p role="status" className="panel-meta">일정을 불러오는 중이에요.</p>}
        {rows?.length === 0 && <Empty>표시된 기간에 예정된 상담이 없어요.</Empty>}
        <div aria-busy={rows === null}>
          <Card className="sc-calendar">
            {view === 'month' ? <table className="sc-month-grid" aria-label="월간 상담 일정">
              <thead><tr>{WEEKDAYS.map(day => <th key={day} scope="col">{day}</th>)}</tr></thead>
              <tbody>{Array.from({ length: period.days.length / 7 }, (_, week) => <tr key={week}>
                {period.days.slice(week * 7, week * 7 + 7).map(day => {
                  const events = byDay.get(day) ?? EMPTY_EVENTS;
                  const label = dayFormatter.format(new Date(`${day}T00:00:00Z`));
                  return <td key={day} data-outside={day.slice(0, 7) !== anchor.slice(0, 7)} data-selected={selectedDay === day}>
                    <div className="sc-month-cell">
                      <button type="button" className="sc-day" data-day={day} aria-label={`${label}, 일정 ${events.length}건`}
                        aria-current={day === today ? 'date' : undefined} aria-pressed={selectedDay === day} onClick={() => showDay(day)}>
                        <span>{Number(day.slice(8))}</span>
                        {events.length > 0 && <small className="sc-mobile-count">{events.length}건</small>}
                      </button>
                      <div className="sc-month-events">{events.slice(0, 3).map(eventButton)}</div>
                      {events.length > 3 && <button type="button" className="sc-more" onClick={() => showDay(day)} aria-label={`${label} 일정 ${events.length}건 모두 보기`}>+{events.length - 3}건 더 보기</button>}
                    </div>
                  </td>;
                })}
              </tr>)}</tbody>
            </table> : <>
              <div className="sc-time-scroll" data-view={view} ref={timeScroll} tabIndex={0} role="region" aria-label={view === 'week' ? '주간 시간표' : '일간 시간표'}>
                <table className="sc-time-grid" data-view={view} aria-label={view === 'week' ? '주간 상담 일정' : '일간 상담 일정'}>
                  <thead><tr><th scope="col">시간</th>{period.days.map(day => <th key={day} scope="col" data-today={day === today}>
                    <div className="sc-time-heading">
                      <button type="button" data-day={day} aria-label={`${dayFormatter.format(new Date(`${day}T00:00:00Z`))} 일간 보기`} onClick={() => { jumpTo(day); setView('day'); }}>
                        {shortDayFormatter.format(new Date(`${day}T00:00:00Z`))}
                      </button>
                    </div>
                  </th>)}</tr></thead>
                  <tbody>{HOURS.map(hour => <tr key={hour} data-hour={hour}>
                    <th scope="row">{hour < 12 ? '오전' : '오후'} {hour % 12 || 12}시</th>
                    {period.days.map(day => {
                      const events = byHour.get(`${day}/${hour}`) ?? EMPTY_EVENTS;
                      return <td key={day} data-has-events={events.length > 0 || undefined}
                        onClick={events.length ? () => showDay(day, events[0].row.session_id) : undefined}>
                        {events.map(eventButton)}
                      </td>;
                    })}
                  </tr>)}</tbody>
                </table>
              </div>
            </>}
          </Card>
        </div>
        <section ref={detail} tabIndex={-1} aria-labelledby="sc-detail-label" className="sc-details">
          <span id="sc-detail-label" hidden>선택한 날짜의 상담 일정 · {selectedDateLabel}</span>
          <Card title={selectedDateLabel} hint={rows ? `${selectedEvents.length}건` : undefined}>
            {!rows ? <Empty>일정을 불러오는 중이에요.</Empty> : selectedEvents.length === 0 ? <Empty>선택한 날짜에 상담 일정이 없어요.</Empty> : selectedEvents.map(({ row, time }) => <div key={row.session_id} data-selected={row.session_id === selectedSession} className="sc-detail-item">
              <Item title={`${row.name ?? row.pseudonym} · ${row.seq}회차`} desc={<>
                <span className="sc-detail-time">{time.label}</span>
                <span>{[row.program_name, row.method ? (METHOD_LABEL[row.method] ?? row.method) : null, row.place, row.plan_memo].filter(Boolean).join(' · ')}</span>
                {(row.open_tasks > 0 || row.open_questions > 0) && <span className="home-open">
                  {row.open_tasks > 0 && <Badge tone="lavender">확인할 과제 {row.open_tasks}</Badge>}
                  {row.open_questions > 0 && <Badge tone="blue">물어볼 것 {row.open_questions}</Badge>}
                </span>}
              </>} action={<a className="wire-button" data-variant="secondary" href={`#/cases/${row.case_id}/info`}><span className="wire-button-text">당사자 정보</span></a>} />
            </div>)}
          </Card>
        </section>
      </>}
    </div>
  </>;
}
