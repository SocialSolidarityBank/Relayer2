import { DatePicker } from './date-picker.tsx';
import { TIME_OPTIONS, timeOf, timeOptionLabel, withTime, type DateTimeValue } from './date-time.ts';
import { Field } from './ui.tsx';
import './date-time-input.css';

/**
 * 시각 **선택창 하나**(2026-09-18 Q — 구 오전·오후/시/분 셋). 항목은 5분 간격이고 글자는
 * 전역 시각 표기(`AM 09:00`)다. 저장된 값이 5분 격자 밖이면(지금 시각 10:26) 그 값을 끼워 넣는다 —
 * 선택창이 값을 잃고 빈 칸으로 돌아가면 안 된다.
 */
export function TimeSelect({ id, label, value, onChange, required = false, disabled = false }: {
  id: string;
  label: string;
  /** `HH:mm`(24시간제) 또는 빈 값. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const options = value && !TIME_OPTIONS.includes(value) ? [...TIME_OPTIONS, value].sort() : TIME_OPTIONS;
  return (
    <Field label={label} htmlFor={id} control="select" required={required}>
      <select id={id} required={required} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">선택</option>
        {options.map(t => <option key={t} value={t}>{timeOptionLabel(t)}</option>)}
      </select>
    </Field>
  );
}

/** 날짜 + 시작 시간. 종료 시각은 부르는 화면이 옆에 `TimeSelect` 로 세운다(일정 등록·기록지 같은 꼴). */
export function DateTimeInput({ idPrefix, value, onChange, disabled = false, required = true }: {
  idPrefix: string;
  value: DateTimeValue;
  onChange: (value: DateTimeValue) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return <fieldset className="date-time-input" disabled={disabled} aria-label="상담 일시">
    <DatePicker id={`${idPrefix}-date`} value={value.date} required={required}
      onChange={date => onChange({ ...value, date })} />
    <TimeSelect id={`${idPrefix}-time`} label="시작 시간" value={timeOf(value)} required={required}
      onChange={time => onChange(withTime(value, time))} />
  </fieldset>;
}
