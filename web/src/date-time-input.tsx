import { DatePicker } from './date-picker.tsx';
import type { DateTimeValue } from './date-time.ts';
import { Field } from './ui.tsx';
import './date-time-input.css';

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
    <div className="date-time-fields">
      <Field label="오전·오후" htmlFor={`${idPrefix}-period`} control="select">
        <select id={`${idPrefix}-period`} value={value.period}
          onChange={e => onChange({ ...value, period: e.target.value as DateTimeValue['period'] })}>
          <option>오전</option><option>오후</option>
        </select>
      </Field>
      <Field label="시" htmlFor={`${idPrefix}-hour`} control="select" required={required}>
        <select id={`${idPrefix}-hour`} required={required} value={value.hour}
          onChange={e => onChange({ ...value, hour: e.target.value })}>
          <option value="">선택</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}시</option>)}
        </select>
      </Field>
      <Field label="분" htmlFor={`${idPrefix}-minute`} control="select">
        <select id={`${idPrefix}-minute`} value={value.minute}
          onChange={e => onChange({ ...value, minute: e.target.value })}>
          {Array.from({ length: 60 }, (_, i) => <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}분</option>)}
        </select>
      </Field>
    </div>
    <p className="date-time-zone panel-meta">한국 시간 기준</p>
  </fieldset>;
}
