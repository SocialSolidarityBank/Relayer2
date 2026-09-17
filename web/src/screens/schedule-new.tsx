// A안: 날짜 선택 완료와 일정 저장을 구분한다. 예정 회차를 만드는 API는 그대로 쓴다.
import { useEffect, useRef, useState } from 'react';
import { getCase, planSession } from '../api.ts';
import type { CaseView, NewSessionInput } from '../api.ts';
import { Button, Card, Choice, ChoiceGroup, ErrorText, Field, PageHeader } from '../ui.tsx';
import { METHODS } from '../vocab.ts';
import { ScheduleDatePicker } from './schedule-date-picker.tsx';
import './schedule-new.css';

const scheduleFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

export function ScheduleNewScreen({ caseId }: { caseId: number }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('오후');
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('00');
  const [method, setMethod] = useState<NewSessionInput['method']>('in_person');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getCase(caseId).then(data => { if (live) setView(data); }).catch(failure => {
      if (live) setError(failure instanceof Error ? failure.message : '당사자 정보를 불러오지 못했어요.');
    });
    return () => { live = false; };
  }, [caseId]);

  const scheduledAt = date && hour
    ? new Date(`${date}T${String(Number(hour) % 12 + (period === '오후' ? 12 : 0)).padStart(2, '0')}:${minute}:00+09:00`).toISOString()
    : null;
  const save = async () => {
    if (!scheduledAt || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await planSession(caseId, {
        scheduled_at: scheduledAt,
        method,
        place: method === 'in_person' && place.trim() ? place.trim() : undefined,
        plan_memo: memo.trim() || undefined,
        is_closing: isClosing,
      });
      window.location.hash = `#/cases/${caseId}/briefing`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const nextSeq = view ? Math.max(0, ...view.sessions.map(s => s.seq)) + 1 : null;

  return <>
    <PageHeader title="상담 일정 등록" meta={view
      ? `${view.pseudonym} · ${view.case.program_name}${nextSeq ? ` · ${nextSeq}회차` : ''}`
      : '불러오는 중이에요'} />
    <form className="wire-container schedule-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset className="schedule-inputs" disabled={saving} aria-label="상담 일정 입력">
        <Card title="언제 상담하나요?">
          <div className="schedule-datetime-row">
            <ScheduleDatePicker value={date} onChange={setDate} />
            <div className="schedule-time-fields">
              <Field label="오전·오후" htmlFor="schedule-period" control="select">
                <select id="schedule-period" value={period} onChange={e => setPeriod(e.target.value)}><option>오전</option><option>오후</option></select>
              </Field>
              <Field label="시" htmlFor="schedule-hour" control="select" required>
                <select id="schedule-hour" required value={hour} onChange={e => setHour(e.target.value)}>
                  <option value="">선택</option>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}시</option>)}
                </select>
              </Field>
              <Field label="분" htmlFor="schedule-minute" control="select">
                <select id="schedule-minute" value={minute} onChange={e => setMinute(e.target.value)}>
                  {Array.from({ length: 60 }, (_, i) => <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}분</option>)}
                </select>
              </Field>
            </div>
          </div>
        </Card>
        <Card title="상담 내용">
          <ChoiceGroup legend="상담 방식">
            {METHODS.map(m => <Choice key={m.key} type="radio" name="method" label={m.label}
              checked={method === m.key} onChange={() => setMethod(m.key)} />)}
          </ChoiceGroup>
          {method === 'in_person' && <Field label="상담 장소" htmlFor="place">
            <input id="place" type="text" value={place} onChange={e => setPlace(e.target.value)} placeholder="예: 상담실 1" />
          </Field>}
          <Field label="메모" htmlFor="memo" control="textarea">
            <textarea id="memo" rows={3} value={memo} onChange={e => setMemo(e.target.value)} />
          </Field>
          <Choice type="checkbox" label="종결 상담" checked={isClosing} onChange={() => setIsClosing(v => !v)}
            hint="일정 저장만으로 사례를 종결하지 않아요." />
        </Card>
      </fieldset>
      <footer className="schedule-savebar" aria-busy={saving}>
        <div className="schedule-save-summary" aria-live="polite">
          <strong>{scheduledAt ? scheduleFormatter.format(new Date(scheduledAt)) : '날짜와 시간을 선택해 주세요.'}</strong>
          <p className="panel-meta">{saving ? '일정을 저장하고 있어요.' : '아직 저장하지 않았어요.'} · 한국 시간</p>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
        <Button type="submit" variant="primary" disabled={!scheduledAt || saving}>{saving ? '저장 중…' : '일정 저장'}</Button>
      </footer>
    </form>
  </>;
}
