// A안: 선택 완료와 일정 저장을 구분한다. 예정 회차를 만드는 API는 그대로 쓴다.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../dialog.tsx';
import { getCase, getCaseDetail, planSession } from '../api.ts';
import type { CaseDetail, CaseView, NewSessionInput } from '../api.ts';
import {
  Button,
  Card,
  Choice,
  ChoiceGroup,
  ChoicePill,
  Empty,
  ErrorText,
  Field,
  Meta,
  PageHeader,
  ParticipantHero,
  participantHeroDetails,
} from '../ui.tsx';
import { METHODS } from '../vocab.ts';
import { DateTimeInput, TimeSelect } from '../date-time-input.tsx';
import { dateTimeFromIso, dateTimeLabel, dateTimeToIso, durationOf, EMPTY_DATE_TIME } from '../date-time.ts';
import './schedule-new.css';

// 저장 요약의 일시 표기는 `date-time.ts` 의 `dateTimeLabel` 하나다(2026-09-18 Q).
/** 예정 회차가 없을 때의 기본값은 **지금**이다(Q 결정 D1). 빈 칸이 아니라 확인할 값을 준다. */
const nowDateTime = () => dateTimeFromIso(new Date().toISOString());

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
  /** 일시를 확인하라는 작은 안내(D1·C5). 예정 회차가 없이 기록하러 들어왔을 때 한 번 뜬다. */
  const [notice, setNotice] = useState(false);

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
   * 예정 회차가 있으면 그 일시·방식·장소·메모가 채워진 채 시작한다(D1) — 값은 사례 조회 하나가
   * 다 준다. **사례가 오기 전에는 판단하지 않는다**: 첫 렌더의 `planned === null` 을 "예정 없음"으로
   * 읽으면 예정 회차가 있는 사람에게도 안내 팝업이 떠서 버튼을 가린다(2026-09-18 e2e 실측).
   */
  useEffect(() => {
    if (!view || !thenRecord) return;
    if (!planned) {
      setNotice(true);
      return;
    }
    if (planned.scheduled_at) setAt(dateTimeFromIso(planned.scheduled_at));
    if (planned.method) setMethod(planned.method as NewSessionInput['method']);
    setPlace(planned.place ?? '');
    setMemo(planned.plan_memo ?? '');
    setIsClosing(planned.is_closing);
  }, [view, thenRecord]);

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
        // 소요 분은 §4 계약(`sessions.duration_min`, L5)이다. 종료 시각을 안 적으면 보내지 않고,
        // 그 한 칸 때문에 일정 저장이 막히지 않는다.
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
    {/* 페이지 제목은 HERO 바로 위 `h1` 이다(2026-09-18 Q — 구 뒤로 줄 눈썹 텍스트 대체). */}
    <PageHeader title="상담 일정 등록" />
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
        {/* 카드 하나다(2026-09-18 Q). 세 행: ①날짜·시작 시간·종료 시각 ②상담 방식·장소 ③메모.
            제목 줄 오른쪽에 종결 상담 **알약 체크**와 저장 버튼이 함께 선다(2026-09-18 Q). */}
        <Card
          title="상담 정보"
          action={
            <div className="schedule-title-actions">
              <ChoicePill label="종결 상담" checked={isClosing} onChange={() => setIsClosing(v => !v)} />
              {passThrough ? (
                <Button variant="primary" onClick={() => (window.location.hash = `#/cases/${caseId}/record`)}>상담 기록하기</Button>
              ) : (
                <Button type="submit" variant="primary" disabled={!scheduledAt || saving}>{saving ? '저장 중…' : '일정 저장'}</Button>
              )}
            </div>
          }
        >
          <div className="when-row">
            <DateTimeInput idPrefix="schedule" value={at} onChange={setAt} disabled={saving} />
            {/* 종료 시각(Q 결정 D4)은 시작 시간과 같은 선택창이다(2026-09-18 Q). */}
            <TimeSelect id="end-time" label="종료 시각" value={endTime} onChange={setEndTime} disabled={saving} />
          </div>
          <div className="schedule-method-row">
            <ChoiceGroup legend="상담 방식">
              {METHODS.map(m => <Choice key={m.key} type="radio" name="method" label={m.label}
                checked={method === m.key} onChange={() => setMethod(m.key)} />)}
            </ChoiceGroup>
            {/* 장소는 상시 노출이다(C3). 대면이 아니면 서버가 거절하므로 보내지 않는다. */}
            <Field label="상담 장소" htmlFor="place">
              <input id="place" type="text" value={place} onChange={e => setPlace(e.target.value)} placeholder="예: 상담실 1" />
            </Field>
          </div>
          <Field label="메모" htmlFor="memo" control="textarea">
            <textarea id="memo" rows={5} value={memo} onChange={e => setMemo(e.target.value)} />
          </Field>
          {/* 안내·오류는 카드 안 마지막 줄이다(구 하단 저장 바 대체, 2026-09-18 Q). */}
          <p className="schedule-save-note" aria-live="polite">
            <Meta parts={[scheduledAt ? dateTimeLabel(scheduledAt) : '날짜와 시간 선택 필요', saving ? '일정 저장 중' : null]} />
          </p>
          {error && <ErrorText>{error}</ErrorText>}
        </Card>
      </fieldset>
      {/* 일시 확인 안내(D1·C5). 부르는 쪽이 여닫는 `Dialog` — 닫기가 확인이다. */}
      <Dialog id="schedule-notice" title="일시 확인 필요" open={notice} onClose={() => setNotice(false)}>
        <p className="panel-meta">예정 회차 없음, 지금 일시를 기본값으로 둠</p>
      </Dialog>
    </form>
    )}
  </>;
}
