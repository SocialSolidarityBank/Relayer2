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
