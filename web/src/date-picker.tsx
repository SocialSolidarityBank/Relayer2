import { useRef, useState } from 'react';
import { Button, Chevron, Field } from './ui.tsx';

const dayFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
const todayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function DatePicker({ id, value, onChange, required = true }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const today = todayFormatter.format(new Date());
  const [pending, setPending] = useState(value);
  const [month, setMonth] = useState(() => new Date(`${value || today}T12:00:00`));
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1).getDay();
  const days = new Date(year, m + 1, 0).getDate();
  const label = value ? dayFormatter.format(new Date(`${value}T12:00:00`)) : '날짜를 선택해 주세요';

  return <>
    <Field label="날짜" htmlFor={id} required={required}>
      <button id={id} type="button" className="schedule-date-open" ref={trigger}
        aria-label={`상담 날짜 선택: ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-dialog`}
        onClick={() => {
          setPending(value);
          setMonth(new Date(`${value || today}T12:00:00`));
          setOpen(true);
          dialog.current?.showModal();
        }}>
        {label}
        <Chevron />
      </button>
    </Field>
    <dialog id={`${id}-dialog`} ref={dialog} className="schedule-date-dialog" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <h2 id={`${id}-title`}>상담 날짜 선택</h2>
      <div className="schedule-month-head">
        <strong aria-live="polite">{year}년 {m + 1}월</strong>
        <div className="schedule-month-actions">
          <button type="button" onClick={() => { setPending(today); setMonth(new Date(`${today}T12:00:00`)); }}>오늘</button>
          <button type="button" aria-label="이전 달" onClick={() => setMonth(new Date(year, m - 1, 1))}><Chevron dir="left" /></button>
          <button type="button" aria-label="다음 달" onClick={() => setMonth(new Date(year, m + 1, 1))}><Chevron dir="right" /></button>
        </div>
      </div>
      <table className="schedule-date-grid" aria-label={`${year}년 ${m + 1}월 날짜 선택`}>
        <thead><tr>{['일', '월', '화', '수', '목', '금', '토'].map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.ceil((first + days) / 7) }, (_, week) => <tr key={week}>
          {Array.from({ length: 7 }, (_, weekday) => {
            const day = week * 7 + weekday - first + 1;
            if (day < 1 || day > days) return <td key={weekday} />;
            const date = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return <td key={weekday}><button type="button" onClick={() => setPending(date)}
              aria-label={dayFormatter.format(new Date(year, m, day, 12))}
              aria-pressed={pending === date} aria-current={today === date ? 'date' : undefined}>
              <span>{day}</span>{today === date && <small>오늘</small>}{pending === date && <small>선택</small>}
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
      <p className="panel-meta" aria-live="polite">{pending ? dayFormatter.format(new Date(`${pending}T12:00:00`)) : '날짜를 선택해 주세요.'}</p>
      <div className="wire-form-actions">
        <Button onClick={() => dialog.current?.close()}>취소</Button>
        <Button variant="primary" disabled={!pending} onClick={() => { onChange(pending); dialog.current?.close(); }}>날짜 선택 완료</Button>
      </div>
      <p className="panel-meta">날짜만 적용해요. 내용은 화면의 저장 버튼을 눌러야 저장돼요.</p>
    </dialog>
  </>;
}
