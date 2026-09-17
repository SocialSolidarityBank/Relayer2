import { useRef, useState } from 'react';
import { Button, Chevron, Field } from './ui.tsx';

const dayFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
const todayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * `inline`이면 폼 필드 대신 글자만 있는 트리거 버튼 하나를 그린다(상담 일정 툴바의 꺽쇠 사이 날짜).
 * `label`은 트리거에 보일 글자로, 없으면 `value`의 긴 한국어 날짜다.
 */
export function DatePicker({ id, value, onChange, required = true, hint = '날짜만 적용해요. 내용은 화면의 저장 버튼을 눌러야 저장돼요.', inline = false, label: labelText, fieldLabel = '날짜', title = '상담 날짜 선택' }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  inline?: boolean;
  label?: string;
  /** 폼 필드 라벨. 상담 일정 밖(사업 기간 등)에서 쓸 때 준다. */
  fieldLabel?: string;
  /** 대화상자 제목과 트리거의 접근 이름. */
  title?: string;
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
  const label = labelText ?? (value ? dayFormatter.format(new Date(`${value}T12:00:00`)) : '날짜를 선택해 주세요');
  const openDialog = () => {
    setPending(value);
    setMonth(new Date(`${value || today}T12:00:00`));
    setOpen(true);
    dialog.current?.showModal();
  };
  const triggerProps = {
    id, type: 'button' as const, ref: trigger, 'aria-label': `${title}: ${label}`,
    'aria-haspopup': 'dialog' as const, 'aria-expanded': open, 'aria-controls': `${id}-dialog`, onClick: openDialog,
  };

  return <>
    {inline ? <button {...triggerProps} className="schedule-period-label schedule-date-inline">{label}</button> : <Field label={fieldLabel} htmlFor={id} required={required} hint={hint || undefined}>
      <button {...triggerProps} className="schedule-date-open">
        {label}
        <Chevron />
      </button>
    </Field>}
    <dialog id={`${id}-dialog`} ref={dialog} className="schedule-date-dialog" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="schedule-month-head">
        <strong aria-live="polite">{year}년 {m + 1}월</strong>
        <div className="schedule-month-actions">
          <Button variant="primary" onClick={() => { setPending(today); setMonth(new Date(`${today}T12:00:00`)); }}>오늘</Button>
          <Button aria-label="이전 달" onClick={() => setMonth(new Date(year, m - 1, 1))}><Chevron dir="left" /></Button>
          <Button aria-label="다음 달" onClick={() => setMonth(new Date(year, m + 1, 1))}><Chevron dir="right" /></Button>
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
              {day}
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
      <p className="panel-meta" aria-live="polite">{pending ? dayFormatter.format(new Date(`${pending}T12:00:00`)) : '날짜를 선택해 주세요.'}</p>
      <div className="wire-form-actions">
        <Button onClick={() => dialog.current?.close()}>취소</Button>
        <Button variant="primary" disabled={!pending} onClick={() => { onChange(pending); dialog.current?.close(); }}>선택 완료</Button>
      </div>
      {hint && <p className="panel-meta">{hint}</p>}
    </dialog>
  </>;
}
