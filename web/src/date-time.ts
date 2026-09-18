/** All editable consultation dates are Korean civil time, independent of the device timezone. */
export type DateTimeValue = {
  date: string;
  period: '오전' | '오후';
  hour: string;
  minute: string;
  /** Preserve hidden seconds when the displayed minute has not changed. */
  originalIso?: string;
};

export const EMPTY_DATE_TIME: DateTimeValue = { date: '', period: '오후', hour: '', minute: '00' };
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function dateTimeFromIso(iso: string): DateTimeValue {
  const local = new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 16);
  const [date, time] = local.split('T');
  const [hour, minute] = time.split(':');
  return { date, period: Number(hour) < 12 ? '오전' : '오후', hour: String(Number(hour) % 12 || 12), minute, originalIso: iso };
}

/** Incomplete fields and impossible dates must never become a default 'now' timestamp. */
export function dateTimeToIso(value: DateTimeValue): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !/^(?:[1-9]|1[0-2])$/.test(value.hour)
    || !/^[0-5]\d$/.test(value.minute) || (value.period !== '오전' && value.period !== '오후')) return null;
  const hour = String(Number(value.hour) % 12 + (value.period === '오후' ? 12 : 0)).padStart(2, '0');
  const local = `${value.date}T${hour}:${value.minute}`;
  const instant = new Date(`${local}:00+09:00`);
  if (!Number.isFinite(instant.getTime())) return null;
  if (new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16) !== local) return null;
  if (value.originalIso) {
    const original = new Date(value.originalIso);
    if (Number.isFinite(original.getTime()) &&
      new Date(original.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16) === local) {
      return original.toISOString();
    }
  }
  return instant.toISOString();
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 전역 날짜 표기(2026-09-18 Q): `2026.09.18.(금)`. 한국 시간 기준이고 기기 시간대와 무관하다.
 * 화면마다 `2026. 9. 18.` · `9. 18. (금)` 로 갈리던 표기를 이 한 곳으로 모은다.
 */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '날짜 없음';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '날짜 없음';
  return dayLabel(new Date(parsed + KST_OFFSET_MS).toISOString().slice(0, 10));
}

/** 같은 표기의 `YYYY-MM-DD` 입력판. 달력이 쓰는 날짜 문자열은 이미 한국 날짜다. */
export function dayLabel(day: string): string {
  const weekday = WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${day.slice(0, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}.(${weekday})`;
}

/** 전역 시각 표기: `AM 10:26`. 한국 시간 기준이고 달력 라벨과 같은 꼴이다. */
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '시각 없음';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '시각 없음';
  const kst = new Date(parsed + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hour < 12 ? 'AM' : 'PM'} ${String(hour % 12 || 12).padStart(2, '0')}:${minute}`;
}

/**
 * 전역 일시 표기: `2026.09.18.(금) AM 10:26`(2026-09-18 Q).
 * 화면마다 `9월 21일 10:26` · `2026. 9. 11. 10:26` · `2026년 9월 18일 금요일 오후 10:26` 로
 * 갈리던 것을 이 한 곳으로 모은다.
 */
export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '일시 없음';
  return `${dateLabel(iso)} ${timeLabel(iso)}`;
}
