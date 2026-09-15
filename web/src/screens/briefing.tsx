// 15초 다시보기 — 읽기 전용 6구획(SPEC §3). CCC wire 계약을 쓴다.
// 사람이 적는 항목(목표·오늘 물어볼 것·확인할 과제)은 비면 빼고,
// AI가 관여하는 항목(위험 신호·직전 회차 요약)은 비어도 남기고 상태를 쓴다.
import { useEffect, useState } from 'react';
import { getBriefing, type Briefing, type BriefingItem } from '../api.ts';
import { Button, Card, Empty, Item, PageHeader } from '../ui.tsx';

const AI_OFF_LABEL: Record<string, string> = {
  ai_disabled: 'AI 확인 안 함',
  no_recording: '녹음이 없어 확인 못 함',
  pending: '확인 중',
};

const source = (item: BriefingItem): string =>
  `${item.source_session_seq}회차${item.last_result === 'unchecked' ? ' · 지난 회차 미확인' : ''}`;

/** `hideHeader` 는 당사자 정보 탭 안에서 쓸 때다. 제목이 두 번 뜨지 않게 한다. */
export function BriefingScreen({ caseId, hideHeader }: { caseId: number; hideHeader?: boolean }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  useEffect(() => {
    void getBriefing(caseId).then(setBriefing);
  }, [caseId]);

  if (!briefing) return <p className="empty">불러오는 중이에요.</p>;
  const card = briefing.participant_card;
  const when = card.scheduled_at ? new Date(card.scheduled_at).toLocaleString('ko-KR') : null;

  return (
    <>
      {!hideHeader && (
        <PageHeader title="15초 다시보기" meta={`${card.name ?? card.pseudonym} · ${card.program_name}`} />
      )}

      <div className="wire-container">
        {/* 1. 위험 신호 — 비어도 빠지지 않는다. 화면에서 유일한 위험색 테두리다. */}
        <section className="risk-banner">
          <div className="risk-banner-head">
            <h2 className="risk-banner-title">위험 신호</h2>
          </div>
          {briefing.risk_signals.items.length === 0 ? (
            <p className="empty">위험 신호 없음</p>
          ) : (
            <ul className="risk-banner-list">
              {briefing.risk_signals.items.map((r) => (
                <li key={r.card_id}>
                  <Item title={r.text} desc={source(r)} />
                </li>
              ))}
            </ul>
          )}
          <p className="panel-meta">{AI_OFF_LABEL[briefing.risk_signals.status.reason ?? 'ai_disabled']}</p>
        </section>

        {/* 2. 당사자 카드 */}
        <Card
          title={card.name ?? card.pseudonym}
          hint={`${card.program_name} · ${card.session_seq}회차${
            card.sessions_planned ? ` / 총 ${card.sessions_planned}회차` : ''
          }${when ? ` · ${when}` : ''}`}
        >
          <div className="wire-form-actions">
            <Button
              variant="primary"
              onClick={() => {
                window.location.hash = `#/cases/${caseId}/record`;
              }}
            >
              상담 기록하기
            </Button>
          </div>
        </Card>

        {/* 3~6 은 읽는 카드다. 넓은 화면에서 두 칸으로 앉아 15초 안에 눈에 들어오게 한다. */}
        <div className="briefing-cards-grid two-col">
        {/* 3. 목표 — 비면 뺀다 */}
        {briefing.goals && (
          <Card title="목표">
            <div className="goal-tree-section">
              {briefing.goals.overall ? (
                <>
                  <p className="goal-tree-label">전체 상담 목표</p>
                  <p className="goal-tree-overall-text">{briefing.goals.overall}</p>
                </>
              ) : (
                <Empty>전체 상담 목표 없음</Empty>
              )}
              {briefing.goals.today && (
                <>
                  <p className="goal-tree-label">오늘 상담 목표</p>
                  <p className="goal-tree-overall-text">{briefing.goals.today.text}</p>
                  <p className="panel-meta">{briefing.goals.today.from_session_seq}회차에서 적음</p>
                </>
              )}
            </div>
          </Card>
        )}

        {/* 4. 직전 회차 요약 — 비어도 빠지지 않는다 */}
        <Card title="직전 회차 요약">
          {briefing.last_session_summary.session_seq ? (
            <>
              <Item title={briefing.last_session_summary.line ?? ''} />
              <p className="panel-meta">
                {briefing.last_session_summary.session_seq}회차 · 요약 없음 (AI 확인 안 함)
              </p>
            </>
          ) : (
            <Empty>아직 기록된 회차가 없어요.</Empty>
          )}
        </Card>

        {/* 5. 오늘 물어볼 것 — 비면 뺀다 */}
        {briefing.today_questions && (
          <Card title="오늘 물어볼 것">
            {briefing.today_questions.map((q) => (
              <div className="wire-repeat-card" key={q.card_id}>
                <Item title={q.text} desc={source(q)} />
              </div>
            ))}
          </Card>
        )}

        {/* 6. 확인할 과제 — 비면 뺀다 */}
        {briefing.open_tasks && (
          <Card title="확인할 과제">
            {briefing.open_tasks.items.map((t) => (
              <div className="wire-repeat-card" key={t.card_id}>
                <Item title={t.text} desc={source(t)} />
              </div>
            ))}
            {briefing.open_tasks.unchecked_carried_over > 0 && (
              <p className="panel-meta">
                지난 회차에 확인 안 함으로 넘어온 것 {briefing.open_tasks.unchecked_carried_over}건
              </p>
            )}
          </Card>
        )}
        </div>
      </div>
    </>
  );
}
