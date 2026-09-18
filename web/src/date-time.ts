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

/** 선택창 값(`HH:mm`, 24시간제) ↔ `DateTimeValue` 의 오전·오후/시/분. 빈 시는 빈 문자열이다. */
export function timeOf(value: DateTimeValue): string {
  if (!/^(?:[1-9]|1[0-2])$/.test(value.hour)) return '';
  const hour = Number(value.hour) % 12 + (value.period === '오후' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${value.minute}`;
}

export function withTime(value: DateTimeValue, time: string): DateTimeValue {
  if (!time) return { ...value, hour: '', minute: '00' };
  const [h, m] = time.split(':');
  const hour = Number(h);
  return { ...value, period: hour < 12 ? '오전' : '오후', hour: String(hour % 12 || 12), minute: m };
}

/** `HH:mm` → `AM 09:00`. 선택창 항목 글자가 전역 시각 표기와 같다. */
export function timeOptionLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h < 12 ? 'AM' : 'PM'} ${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 시작·종료 선택창의 항목 — 5분 간격 하루치(288). 그 사이 값은 선택창이 스스로 끼워 넣는다. */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: 24 * 12 }, (_, i) =>
  `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`,
);

const kstClock = (iso: string): string => {
  const kst = new Date(Date.parse(iso) + KST_OFFSET_MS);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
};

/**
 * 시작 일시와 종료 시각(`HH:mm`)으로 소요 분을 센다(Q 결정 D4 · §4 계약 `duration_min`).
 * 종료가 시작보다 이르면 자정을 넘긴 것으로 보지 않고 **세지 않는다** — 날짜를 안 물었으므로
 * 넘김인지 오타인지 알 수 없고, 틀린 소요시간은 없는 것보다 나쁘다.
 */
export function durationOf(startIso: string | null, endTime: string): number | undefined {
  if (!startIso || !endTime) return undefined;
  const [h, m] = endTime.split(':').map(Number);
  const [sh, sm] = kstClock(startIso).split(':').map(Number);
  const minutes = h * 60 + m - (sh * 60 + sm);
  return minutes > 0 ? minutes : undefined;
}

/** 저장된 시작 일시와 소요 분으로 종료 시각 선택창 값을 되세운다. 같은 날을 넘기면 빈 값이다. */
export function endTimeOf(startIso: string | null | undefined, durationMin: number | null | undefined): string {
  if (!startIso || !durationMin) return '';
  const [sh, sm] = kstClock(startIso).split(':').map(Number);
  const total = sh * 60 + sm + durationMin;
  if (total >= 24 * 60) return '';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
