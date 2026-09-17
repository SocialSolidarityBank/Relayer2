// A안: 선택 완료와 일정 저장을 구분한다. 예정 회차를 만드는 API는 그대로 쓴다.
import { useEffect, useRef, useState } from 'react';
import { getCase, getCaseDetail, listSchedules, planSession } from '../api.ts';
import type { CaseDetail, CaseView, NewSessionInput } from '../api.ts';
import {
  Button,
  Card,
  Choice,
  ChoiceGroup,
  Empty,
  ErrorText,
  Field,
  FormActions,
  Meta,
  ParticipantHero,
  participantHeroDetails,
} from '../ui.tsx';
import { METHODS } from '../vocab.ts';
import { DateTimeInput } from '../date-time-input.tsx';
import { dateTimeFromIso, dateTimeToIso, EMPTY_DATE_TIME } from '../date-time.ts';
import './schedule-new.css';

const scheduleFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  hour: 'numeric', minute: '2-digit', hour12: true,
});
/** 종료 시각 입력은 24시간제 `HH:mm` 이다(네이티브 `input[type=time]`). */
const endTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
});
/** 예정 회차가 없을 때의 기본값은 **지금**이다(Q 결정 D1). 빈 칸이 아니라 확인할 값을 준다. */
const nowDateTime = () => dateTimeFromIso(new Date().toISOString());

/**
 * 시작 일시와 종료 시각으로 소요 분을 센다(Q 결정 D4 · §4 계약 `duration_min`).
 * 종료가 시작보다 이르면 자정을 넘긴 것으로 보지 않고 **세지 않는다** — 날짜를 안 물었으므로
 * 넘김인지 오타인지 알 수 없고, 틀린 소요시간은 없는 것보다 나쁘다.
 */
const durationOf = (startIso: string | null, endTime: string): number | undefined => {
  if (!startIso || !endTime) return undefined;
  const start = new Date(startIso);
  const [h, m] = endTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  const [sh, sm] = endTimeFormatter.format(start).split(':').map(Number);
  const minutes = h * 60 + m - (sh * 60 + sm);
  return minutes > 0 ? minutes : undefined;
};

/**
 * 일정 예약. `thenRecord` 면 **당사자 목록 카드의 `상담 기록하기`** 로 들어온 것이다(Q 결정 D1) —
 * 기록 앞에 일시를 확인하는 자리이므로 저장한 뒤 기록 화면으로 잇는다. 예정 회차가 이미 있으면
 * 그 값을 보여 주고 회차를 새로 만들지 않는다(같은 상담이 두 번 잡히지 않게).
 */
export function ScheduleNewScreen({ caseId, thenRecord = false }: { caseId: number; thenRecord?: boolean }) {
  const [view, setView] = useState<CaseView | null>(null);
  // 당사자 카드의 이름은 사례 상세가 준다(2026-09-17 Q 시안).
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  // 기록하러 온 길만 기본값을 채운다(D1). 순수 일정 등록은 빈 칸에서 시작한다 — 채워 두면
  // 예정 회차와 같은 일시로 한 번 더 저장해 같은 상담이 두 번 잡힌다.
  const [at, setAt] = useState(() => (thenRecord ? nowDateTime() : EMPTY_DATE_TIME));
  const [endTime, setEndTime] = useState('');
  const [method, setMethod] = useState<NewSessionInput['method']>('in_person');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  /** 일시를 확인하라는 작은 안내(D1). 예정 회차가 없이 기록하러 들어왔을 때 한 번 뜬다. */
  const [notice, setNotice] = useState(false);
  const noticeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let live = true;
    void getCaseDetail(caseId).then(d => { if (live) setDetail(d); }).catch(() => {});
    void getCase(caseId).then(data => { if (live) setView(data); }).catch(failure => {
      if (live) setError(failure instanceof Error ? failure.message : '당사자 정보 불러오기 실패');
    });
    return () => { live = false; };
  }, [caseId]);

  const planned = view?.sessions
    .filter(s => s.status === 'planned')
    .sort((a, b) => a.seq - b.seq)[0] ?? null;

  /**
   * 예정 회차가 있으면 그 값이 채워진 채 시작한다(D1). 방식·장소·일시는 사례 조회가 이미 주고,
   * 메모는 일정 목록 조회(`/schedules`)만 싣고 있어 그 회차의 날짜 범위로 한 번 더 부른다.
   * **사례가 오기 전에는 판단하지 않는다** — 첫 렌더의 `planned === null` 을 "예정 없음"으로 읽으면
   * 예정 회차가 있는 사람에게도 안내 팝업이 떠서 버튼을 가린다(2026-09-18 e2e 실측).
   */
  useEffect(() => {
    if (!view || !thenRecord) return;
    if (!planned) {
      setNotice(true);
      return;
    }
    let live = true;
    if (planned.scheduled_at) setAt(dateTimeFromIso(planned.scheduled_at));
    if (planned.method) setMethod(planned.method as NewSessionInput['method']);
    setPlace(planned.place ?? '');
    setIsClosing(planned.is_closing);
    const day = planned.scheduled_at?.slice(0, 10);
    if (day) {
      void listSchedules(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
        .then(rows => {
          const row = rows.find(r => r.session_id === planned.id);
          if (live && row?.plan_memo) setMemo(row.plan_memo);
        })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [view, thenRecord]);

  // 안내는 네이티브 모달이다(`Dialog`·`Confirm` 과 같은 문법) — Escape·바깥 클릭이 닫기다.
  useEffect(() => {
    const el = noticeDialog.current;
    if (!el) return;
    if (notice && !el.open) el.showModal();
    if (!notice && el.open) el.close();
  }, [notice]);

  const scheduledAt = dateTimeToIso(at);
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
        // 소요시간은 §4 계약(`duration_min`)이다. 서버가 아직 안 받으면 스키마가 걸러 내고
        // 저장은 그대로 된다 — 소요시간 하나 때문에 일정이 막히지 않는다.
        duration_min: durationOf(scheduledAt, endTime),
      });
      // 기록하러 온 길이면 기록 화면으로 잇고(D1), 그 밖에는 일정 목록으로 돌아간다
      // (2026-09-17 Q — 잇달아 잡는 일이 많다).
      window.location.hash = thenRecord ? `#/cases/${caseId}/record` : '#/schedule';
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const nextSeq = view ? Math.max(0, ...view.sessions.map(s => s.seq)) + 1 : null;
  // 예정 회차를 확인하러 온 길은 저장할 것이 없다 — 그 회차로 바로 기록한다.
  const passThrough = thenRecord && planned !== null;

  return <>
    <ParticipantHero
      name={detail?.participant.name ?? null}
      pseudonym={view?.pseudonym ?? '확인 중'}
      details={participantHeroDetails({
        pseudonym: view?.pseudonym ?? '확인 중',
        program: view?.case.program_name ?? '확인 중',
        seqLabel: planned ? `${planned.seq}회차 확인` : nextSeq ? `${nextSeq}회차 잡기` : null,
        phone: detail?.participant.phone,
        email: detail?.participant.email,
      })}
      actions={
        <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
      }
    />
    {/* 종결 사례에는 일정을 잡지 않는다(2026-09-18 검수) — 서버도 409 로 거절한다. */}
    {detail?.case.status === 'closed' ? (
      <div className="wire-container">
        <Card
          title="상담 종결"
          tone="warn"
          action={
            <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
          }
        >
          <Empty>종결된 상담, 새 일정 불가</Empty>
        </Card>
      </div>
    ) : (
    <form className="wire-container schedule-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset className="schedule-inputs" disabled={saving} aria-label="상담 일정 입력">
        {/* 카드 하나다(2026-09-18 Q C3 — 구 `상담 일시`·`상담 내용` 두 카드 합침).
            첫 행은 일시·종료 시각과 상담 방식이 세로 가운데로 서고, 그 아래 왼쪽은 장소·종결,
            오른쪽은 메모다. */}
        <Card title="상담 내용">
          <div className="schedule-when-row">
            <div className="schedule-when-fields">
              <DateTimeInput idPrefix="schedule" value={at} onChange={setAt} disabled={saving} />
              {/* 종료 시각(Q 결정 D4). 네이티브 시각 입력이라 24시간제 표기·키보드 입력을 그대로 쓴다. */}
              <Field label="종료 시각" htmlFor="end-time">
                <input id="end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </Field>
            </div>
            <ChoiceGroup legend="상담 방식">
              {METHODS.map(m => <Choice key={m.key} type="radio" name="method" label={m.label}
                checked={method === m.key} onChange={() => setMethod(m.key)} />)}
            </ChoiceGroup>
          </div>
          <div className="schedule-detail-row">
            <div className="schedule-detail-left">
              {/* 장소는 상시 노출이다(C3). 대면이 아니면 서버가 거절하므로 보내지 않는다. */}
              <Field label="상담 장소" htmlFor="place">
                <input id="place" type="text" value={place} onChange={e => setPlace(e.target.value)} placeholder="예: 상담실 1" />
              </Field>
              <Choice type="checkbox" label="종결 상담" checked={isClosing} onChange={() => setIsClosing(v => !v)} />
            </div>
            <Field label="메모" htmlFor="memo" control="textarea">
              <textarea id="memo" rows={5} value={memo} onChange={e => setMemo(e.target.value)} />
            </Field>
          </div>
        </Card>
      </fieldset>
      {/* 안내는 작은 Meta 한 줄이고 버튼과 거리를 둔 왼편에 선다(2026-09-18 Q C4). */}
      <footer className="schedule-savebar" aria-busy={saving}>
        <div className="schedule-save-summary" aria-live="polite">
          <Meta
            parts={[
              scheduledAt ? scheduleFormatter.format(new Date(scheduledAt)) : '날짜와 시간 선택 필요',
              saving ? '일정 저장 중' : null,
            ]}
          />
          {error && <ErrorText>{error}</ErrorText>}
        </div>
        {passThrough ? (
          <Button variant="primary" onClick={() => (window.location.hash = `#/cases/${caseId}/record`)}>
            상담 기록하기
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!scheduledAt || saving}>{saving ? '저장 중…' : '일정 저장'}</Button>
        )}
      </footer>
      {/* 일시 확인 안내(D1). `Dialog`(dialog.tsx)는 여는 버튼이 딸린 부품이라 자동으로 뜨는
          이 자리에 못 쓴다 — 같은 `<dialog>` 문법과 같은 CSS 클래스를 쓴다. `Dialog` 에
          `open` 프롭이 생기면 이 지역 마크업은 지운다(PR 요청). */}
      <dialog
        ref={noticeDialog}
        className="schedule-date-dialog"
        aria-labelledby="schedule-notice-title"
        onCancel={() => setNotice(false)}
        onClose={() => setNotice(false)}
      >
        <h2 id="schedule-notice-title">일시 확인 필요</h2>
        <p className="panel-meta">예정 회차 없음, 지금 일시를 기본값으로 둠</p>
        <FormActions>
          <Button variant="primary" onClick={() => setNotice(false)}>확인</Button>
        </FormActions>
      </dialog>
    </form>
    )}
  </>;
}
