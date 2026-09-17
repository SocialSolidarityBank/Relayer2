/**
 * 상담 일정 달력의 기간 계산. 모든 날짜는 한국 시간(Asia/Seoul) 기준이고
 * 기기의 시간대와 무관하게 같은 결과를 낸다 — date-time.ts의 KST 관례를 따른다.
 * 날짜 산술은 KST 날짜를 UTC 자정으로 옮겨 순수 밀리초로만 한다.
 */
export type CalendarView = 'month' | 'week' | 'day';

export type CalendarPeriod = {
  /** 조회 범위 시작(포함). 첫 날의 00:00:00.000 KST를 나타내는 ISO. */
  start: string;
  /** 조회 범위 끝(포함). 마지막 날의 23:59:59.999 KST를 나타내는 ISO. */
  end: string;
  /** 화면에 보이는 날짜 YYYY-MM-DD 목록 — 월간은 앞뒤 달의 날도 포함한다. */
  days: string[];
  /** 툴바에 보이는 한국어 기간 이름. */
  title: string;
};

export type CalendarTime = { day: string; hour: number; label: string };

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

// Intl 인스턴스는 모듈에서 한 번만 만든다 — 행마다 새로 만들지 않는다.
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 한국 날짜 YYYY-MM-DD. 인자가 없으면 지금. */
export function koreanDay(iso?: string | Date): string {
  return dayFormatter.format(iso === undefined ? new Date() : new Date(iso));
}

/** ISO 시각을 한국 날짜·24시각·'AM/PM hh:mm' 라벨로 바꾼다(2026-09-17 Q — `AM 07:14` 꼴). */
export function calendarTime(iso: string): CalendarTime {
  const local = new Date(Date.parse(iso) + KST_OFFSET_MS);
  const hour = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  return {
    day: local.toISOString().slice(0, 10),
    hour,
    label: `${hour < 12 ? 'AM' : 'PM'} ${String(hour % 12 || 12).padStart(2, '0')}:${minute}`,
  };
}

/** KST 날짜 문자열을 UTC 자정 밀리초로 — 요일·날짜 산술 전용 표현. */
function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) days.push(isoDay(ms));
  return days;
}

function rangeTitle(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const sy = s.getUTCFullYear();
  const sm = s.getUTCMonth() + 1;
  const sd = s.getUTCDate();
  const ey = e.getUTCFullYear();
  const em = e.getUTCMonth() + 1;
  const ed = e.getUTCDate();
  if (sy === ey && sm === em) return `${sy}년 ${sm}월 ${sd}일 – ${ed}일`;
  if (sy === ey) return `${sy}년 ${sm}월 ${sd}일 – ${em}월 ${ed}일`;
  return `${sy}년 ${sm}월 ${sd}일 – ${ey}년 ${em}월 ${ed}일`;
}

/**
 * anchor(YYYY-MM-DD)가 속한 기간을 돌려준다.
 * month: 그 달을 감싸는 앞 월요일~뒤 일요일(인접 달 칸 포함, 28/35/42일).
 * week: 일~토 7일. day: 하루.
 * start/end는 서버 BETWEEN에 그대로 넘기는 KST ISO(포함 범위).
 */
export function calendarPeriod(view: CalendarView, anchor: string): CalendarPeriod {
  const anchorMs = dayMs(anchor);
  let startMs: number;
  let endMs: number;
  let title: string;

  if (view === 'month') {
    const d = new Date(anchorMs);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const firstMs = Date.UTC(year, month, 1);
    const lastMs = Date.UTC(year, month + 1, 0); // 0일 = 전달 말일 — 12월→1월·윤년 2월도 그대로
    startMs = firstMs - ((new Date(firstMs).getUTCDay() + 6) % 7) * DAY_MS;
    endMs = lastMs + ((7 - new Date(lastMs).getUTCDay()) % 7) * DAY_MS;
    title = `${year}년 ${month + 1}월`;
  } else if (view === 'week') {
    startMs = anchorMs - new Date(anchorMs).getUTCDay() * DAY_MS;
    endMs = startMs + 6 * DAY_MS;
    title = rangeTitle(startMs, endMs);
  } else {
    startMs = anchorMs;
    endMs = anchorMs;
    const d = new Date(anchorMs);
    title = `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAYS[d.getUTCDay()]}요일`;
  }

  return {
    start: `${isoDay(startMs)}T00:00:00.000+09:00`,
    end: `${isoDay(endMs)}T23:59:59.999+09:00`,
    days: daysBetween(startMs, endMs),
    title,
  };
}

/**
 * 기간 이동 후의 새 anchor. month는 대상 달의 1일, week는 ±7일, day는 ±1일.
 * 달 넘김·연 넘김은 Date.UTC 오버플로에 맡긴다.
 */
export function shiftPeriod(view: CalendarView, anchor: string, direction: -1 | 1): string {
  const ms = dayMs(anchor);
  if (view === 'month') {
    const d = new Date(ms);
    return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1));
  }
  return isoDay(ms + direction * (view === 'week' ? 7 : 1) * DAY_MS);
}
