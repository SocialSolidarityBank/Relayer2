// 상담 종결 — 회차가 아니다. 상담을 한 것처럼 기록하지 않는다(SPEC §4-3).
// 미완료 과제는 보여 주기만 하고 자동으로 완료·중단 처리하지 않는다.
import { useEffect, useState } from 'react';
import { closeCase, getCaseDetail, type CaseDetail } from '../api.ts';
import { Button, Card, Choice, ChoiceGroup, Empty, ErrorText, Field, FormActions, Item, ParticipantHero } from '../ui.tsx';

// 종결 사유는 통합사례관리 종결 구분을 따른다. 없는 말을 지어내지 않는다.
const REASONS = ['목표 달성', '타 기관 의뢰', '당사자 거부·중단', '연락 두절', '이사·전출', '기타'] as const;

export function CloseScreen({ caseId }: { caseId: number }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCaseDetail(caseId).then(setDetail);
  }, [caseId]);

  if (!detail) return <p className="empty">불러오는 중이에요.</p>;

  const unfinished = detail.open_cards.filter((c) => c.kind === 'promise');
  const lastSeq = detail.sessions.filter((s) => s.status === 'done').at(-1)?.seq ?? null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await closeCase(caseId, { close_reason: reason, unfinished_note: note.trim() || null });
      window.location.hash = `#/cases/${caseId}/info`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '종결하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  // 당사자 카드 정보 넷(2026-09-17 Q — ②ⓐ 모든 화면 같은 격자).
  // 당사자 카드 정보 넷(2026-09-17 Q): ID · 사업과 회차 · 연락처 · 이메일.
  const heroDetails: Array<[string, string]> = [
    ['당사자 ID', detail.pseudonym],
    [
      '참여 사업',
      `${detail.case.program_name}${lastSeq ? ` · 마지막 ${lastSeq}회차` : ' · 기록 없음'}`,
    ],
    ['연락처', detail.participant.phone ?? ''],
    ['이메일', detail.participant.email ?? ''],
  ];


  if (detail.closure)
    return (
      <>
        <ParticipantHero
          name={detail.participant.name}
          pseudonym={detail.pseudonym}
          details={heroDetails}
          actions={
            <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
          }
        />
        <div className="wire-container">
          <Card title="이미 종결한 사례예요">
            <Item title={detail.closure.close_reason} desc={new Date(detail.closure.closed_at).toLocaleString('ko-KR')} />
            <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보로</Button>
          </Card>
        </div>
      </>
    );

  return (
    <>
      <ParticipantHero
        name={detail.participant.name}
        pseudonym={detail.pseudonym}
        details={heroDetails}
        actions={
          <Button onClick={() => (window.location.hash = `#/cases/${caseId}/info`)}>당사자 정보</Button>
        }
      />
      <div className="wire-container">
        <Card title="미완료 과제" hint="종결해도 완료나 중단으로 바꾸지 않아요. 남은 그대로 기록에 남아요.">
          {unfinished.length === 0 ? (
            <Empty>남은 과제가 없어요.</Empty>
          ) : (
            unfinished.map((c) => (
              <Item
                key={c.id}
                title={c.text}
                desc={c.source_session_seq ? `${c.source_session_seq}회차에서 시작` : '출처 회차 없음'}
              />
            ))
          )}
        </Card>

        <Card title="종결 사유" hint="이 기록은 상담 회차가 아니에요. 회차 번호를 받지 않아요.">
          <ChoiceGroup legend="종결 사유">
            {REASONS.map((r) => (
              <Choice
                key={r}
                type="radio"
                name="reason"
                label={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
            ))}
          </ChoiceGroup>
          <Field label="남길 말" htmlFor="note" control="textarea" hint="미완료 과제를 어떻게 하기로 했는지 적어요.">
            <textarea
              id="note"
              rows={3}
              aria-label="남길 말"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </Card>

        <FormActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? '종결 중…' : '종결 확정'}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
