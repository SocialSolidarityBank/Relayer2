// 상담 일정 — 월간 기본, 주간·일간은 시작 시각 기준의 시간표다. 일정의 길이는 추정하지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCaseDetail, listSchedules } from '../api.ts';
import type { ScheduleRow } from '../api.ts';
import { calendarPeriod, calendarTime, koreanDay, shiftPeriod, WEEKDAYS } from '../calendar.ts';
import type { CalendarTime, CalendarView } from '../calendar.ts';
import { DatePicker } from '../date-picker.tsx';
import { Button, Card, Chevron, Empty, ErrorText, Fold, FormActions, Meta, PageHeader, Select } from '../ui.tsx';
import { METHOD_LABEL } from '../vocab.ts';
import '../date-time-input.css';
import './home.css';

const VIEWS = [{ key: 'month', label: '월간' }, { key: 'week', label: '주간' }, { key: 'day', label: '일간' }] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const dayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const shortDayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' });
type CalendarEvent = { row: ScheduleRow; time: CalendarTime };
const EMPTY_EVENTS: CalendarEvent[] = [];
/** 다가오는 일정은 다섯 건까지 보여 주고 나머지는 `날짜 더보기`가 펼친다(2026-09-17 Q). */
const UPCOMING_LIMIT = 5;
/**
 * `focusCaseId` 가 오면 그 당사자의 일정만 본다(2026-09-17 Q — 당사자 카드의 `상담 일정 보기`).
 * 주소(`#/schedule?case=12`)가 상태를 들고 있어 링크를 공유하거나 뒤로 가도 그대로 산다.
 */
export function HomeScreen({ focusCaseId = null }: { focusCaseId?: number | null }) {
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => koreanDay());
  const [selectedDay, setSelectedDay] = useState(anchor);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
  const [retry, setRetry] = useState(0);
  // 다가오는 일정은 달력이 보는 기간과 별개다 — 오늘부터 앞으로 180일을 따로 부른다.
  const [upcoming, setUpcoming] = useState<ScheduleRow[] | null>(null);
  const [upcomingShown, setUpcomingShown] = useState(UPCOMING_LIMIT);
  /**
   * 연락처·이메일은 `/schedules` 가 주지 않는다. 줄을 **펼칠 때** 그 한 건만 부른다 —
   * 목록을 여는 것만으로 열지도 않은 사례의 금고를 열고 감사 기록을 남기지 않는다.
   */
  const [contacts, setContacts] = useState<Record<number, { phone: string | null; email: string | null } | 'loading' | 'error'>>({});
  const openContact = (caseId: number) => {
    if (contacts[caseId]) return;
    setContacts(prev => ({ ...prev, [caseId]: 'loading' }));
    void getCaseDetail(caseId)
      .then(detail => setContacts(prev => ({ ...prev, [caseId]: { phone: detail.participant.phone, email: detail.participant.email } })))
      .catch(() => setContacts(prev => ({ ...prev, [caseId]: 'error' })));
  };
  const [loaded, setLoaded] = useState<{ key: string; rows: ScheduleRow[] | null; error: string | null }>({ key: '', rows: null, error: null });
  const period = useMemo(() => calendarPeriod(view, anchor), [view, anchor]);
  const requestKey = `${period.start}/${period.end}`;
  const loadedRows = loaded.key === requestKey ? loaded.rows : null;
  // 걸개는 화면이 받은 자료를 좁힌다 — 서버 질의와 기간 계산은 그대로다.
  const rows = focusCaseId && loadedRows ? loadedRows.filter(row => row.case_id === focusCaseId) : loadedRows;
  const error = loaded.key === requestKey ? loaded.error : null;
  // 걸린 사람의 이름은 받아 둔 줄에서 집는다 — 이름만 얻으려고 사례를 따로 부르지 않는다.
  const focusRow = focusCaseId
    ? (loadedRows ?? []).find(row => row.case_id === focusCaseId)
      ?? (upcoming ?? []).find(row => row.case_id === focusCaseId)
    : undefined;
  const focusLabel = focusRow ? (focusRow.name ?? focusRow.pseudonym) : '고른 당사자';
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
      if (live) setLoaded({ key: requestKey, rows: null, error: failure instanceof Error ? failure.message : '일정 불러오기 실패' });
    });
    return () => { live = false; };
  }, [period.start, period.end, requestKey, retry]);

  // 오늘 이후 가까운 순. 달력을 옮겨도 이 목록은 바뀌지 않는다.
  useEffect(() => {
    let live = true;
    const from = new Date();
    const to = new Date(from.getTime() + 180 * 86_400_000);
    void listSchedules(from.toISOString(), to.toISOString())
      .then(data => { if (live) setUpcoming(data); })
      .catch(() => { if (live) setUpcoming([]); });
    return () => { live = false; };
  }, [retry]);

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
      aria-label={label} title={`${label}, ${row.program_name}`} onClick={e => { e.stopPropagation(); showDay(time.day, row.session_id); }}>
      <span className="sc-event-time">{time.label}</span><strong className="sc-event-name">{name}</strong>
    </button>;
  };
  const selectedEvents = byDay.get(selectedDay) ?? EMPTY_EVENTS;
  // 사람이 달력에서 오늘이 아닌 날짜를 고르면 그 날짜 카드로, 기본은 다가오는 일정이다.
  const dayPicked = selectedDay !== today;
  const upcomingEvents: CalendarEvent[] = useMemo(() => {
    const now = Date.now();
    return (upcoming ?? [])
      .filter(row => !focusCaseId || row.case_id === focusCaseId)
      .filter(row => new Date(row.scheduled_at).getTime() >= now - 3_600_000)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      .map(row => ({ row, time: calendarTime(row.scheduled_at) }));
  }, [upcoming, focusCaseId]);
  const listed = dayPicked
    ? rows === null
      ? null
      : selectedEvents
    : upcoming === null
      ? null
      : upcomingEvents.slice(0, upcomingShown);
  // 가입 직후에는 어디에도 일정이 없고 빈 달력만 보면 다음 할 일을 모른다(2026-09-18).
  // 당사자 목록은 이 화면이 부르지 않으므로 **일정 0건**을 그 신호로 쓴다.
  const noSchedules = rows?.length === 0 && upcoming?.length === 0;
  const registerAction = noSchedules && (
    <FormActions>
      <a className="wire-button" data-variant="secondary" href="#/participants/new">
        <span className="wire-button-text">당사자 등록</span>
      </a>
    </FormActions>
  );
  const upcomingHint =
    upcoming === null
      ? undefined
      : upcomingEvents.length > upcomingShown
        ? `가까운 ${upcomingShown}건, 모두 ${upcomingEvents.length}건`
        : `${upcomingEvents.length}건`;

  return <>
    {/* 제목 아래 설명 줄은 걷었다(2026-09-17 Q). 건수는 아래 카드가, 시간대는 값이 말한다.
        당사자 걸개가 걸리면 제목 옆에 걷는 칩이 선다 — 걸개가 걸린 줄 모르는 채 "일정이
        없다"고 읽는 일을 막는다. */}
    <PageHeader
      title="상담 일정"
      actions={focusCaseId ? (
        <Button onClick={() => { window.location.hash = '#/schedule'; }}>
          {focusLabel}만 보기 ✕
        </Button>
      ) : undefined}
    />
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
              hint="고른 날짜가 든 기간으로 이동, 일정은 바뀌지 않음" />
            <Button aria-label="다음 기간" onClick={() => jumpTo(shiftPeriod(view, anchor, 1))}><Chevron dir="right" /></Button>
          </div>
        </div>
        <Button variant="primary" onClick={() => jumpTo(today)}>오늘</Button>
      </div>
      {error ? <Card><ErrorText>{error}</ErrorText><Button onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button></Card> : <>
        {!rows && <p role="status" className="panel-meta">일정 불러오는 중</p>}
        {rows?.length === 0 && <><Empty>표시된 기간에 예정된 상담 없음</Empty>{registerAction}</>}
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
                  <thead><tr><th scope="col"><span className="wire-toolbar-label">시간</span></th>{period.days.map(day => <th key={day} scope="col" data-today={day === today}>
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
        {/* 달력 아래 카드(2026-09-17 Q). 기본은 **다가오는 일정** — 오늘 이후 가까운 순 다섯 건이고
            넘치면 `날짜 더보기`로 나머지를 펼친다. 달력에서 다른 날짜를 고르면 그 날짜 카드로 바뀐다.
            줄은 모두 접힌 카드다. 접힌 줄에 이름(당사자 카드와 같은 18/600)과 일시가 서고,
            펼치면 회차·일시·사업명·장소가 라벨/값으로 붙는다. */}
        <section ref={detail} tabIndex={-1} aria-labelledby="sc-detail-label" className="sc-details">
          <span id="sc-detail-label" hidden>
            {dayPicked ? `선택한 날짜의 상담 일정, ${selectedDateLabel}` : '다가오는 상담 일정'}
          </span>
          <Card
            title={dayPicked ? selectedDateLabel : '다가오는 일정'}
            hint={dayPicked ? (rows ? `${selectedEvents.length}건` : undefined) : upcomingHint}
          >
            {listed === null ? (
              <Empty>일정 불러오는 중</Empty>
            ) : listed.length === 0 ? (
              <>
                <Empty>{dayPicked ? '선택한 날짜에 상담 일정 없음' : '예정된 상담 없음'}</Empty>
                {!dayPicked && registerAction}
              </>
            ) : (
              <>
                {listed.map(({ row, time }) => {
                  const contact = contacts[row.case_id];
                  return (
                    <Fold
                      key={row.session_id}
                      group="sc-upcoming"
                      open={row.session_id === selectedSession}
                      onOpen={() => openContact(row.case_id)}
                      title={row.name ?? row.pseudonym}
                      // 접힌 줄은 한 행이다(2026-09-17 Q): 이름  아이디  참여 사업  일시.
                      // 잘리는 쪽은 뒤라 사업명을 마지막 앞에 두고, 전체는 `Meta` 의 `title` 로 남긴다.
                      desc={
                        <Meta
                          parts={[
                            row.name ? row.pseudonym : null,
                            `${row.program_name} ${row.seq}회차`,
                            `${shortDayFormatter.format(new Date(`${time.day}T00:00:00Z`))} ${time.label}`,
                          ]}
                        />
                      }
                      action={
                        <>
                          <a
                            className="wire-button"
                            data-variant="secondary"
                            href={`#/cases/${row.case_id}/info`}
                            onClick={event => event.stopPropagation()}
                          >
                            <span className="wire-button-text">당사자 정보</span>
                          </a>
                          {/* 두 행동 모두 세컨더리다 — 다섯 줄에 채운 버튼이 다섯 개면
                              강조가 아니라 소음이다(2026-09-17). */}
                          <a
                            className="wire-button"
                            data-variant="secondary"
                            href={`#/cases/${row.case_id}/record`}
                            onClick={event => event.stopPropagation()}
                          >
                            <span className="wire-button-text">상담 기록하기</span>
                          </a>
                        </>
                      }
                    >
                      {/* 가로선 격자(`DataRows`)는 줄마다 칸을 키웠다 — 컬러 라벨 + 값으로 바꿨다
                          (2026-09-17 Q). 머리가 말한 것은 되풀이하지 않는다. 연락처·이메일은
                          이 줄을 펼칠 때 그 사례만 따로 부른다. */}
                      <div className="participant-card-fields">
                        {([
                          ['연락처', contact === 'loading' ? '불러오는 중' : contact === 'error' ? '불러오기 실패' : (contact?.phone ?? '')],
                          ['이메일', contact === 'loading' ? '불러오는 중' : contact === 'error' ? '' : (contact?.email ?? '')],
                          ['방식', row.method ? (METHOD_LABEL[row.method] ?? row.method) : '정하지 않음'],
                          ...(row.place ? [['장소', row.place]] : []),
                          ...(row.plan_memo ? [['메모', row.plan_memo]] : []),
                          ...(row.open_tasks > 0 ? [['확인할 과제', `${row.open_tasks}건`]] : []),
                          ...(row.open_questions > 0 ? [['물어볼 것', `${row.open_questions}건`]] : []),
                        ] as Array<[string, string]>)
                          .filter(([, value]) => value !== '')
                          .map(([label, value]) => (
                            <div className="wire-field-row" data-layout="stack" data-size="sm" key={label}>
                              <span className="wire-field-label">{label}</span>
                              <span className="wire-field-value">{value}</span>
                            </div>
                          ))}
                      </div>
                    </Fold>
                  );
                })}
                {/* 한 번에 모두 펼치지 않는다 — 다섯 건씩 더 붙인다(77건이 벽처럼 쏟아졌다). */}
                {!dayPicked && upcomingEvents.length > upcomingShown && (
                  <FormActions>
                    <Button onClick={() => setUpcomingShown(n => n + UPCOMING_LIMIT)}>날짜 더보기</Button>
                  </FormActions>
                )}
              </>
            )}
          </Card>
        </section>
      </>}
    </div>
  </>;
}
