// 당사자 정보 — 탭 4(GLOSSARY §6-4): 회차별 요약 · 15초 다시보기 · 목표 · 정보.
// 당사자 카드와 할 일 전체는 두지 않는다(요구 25·28). 종결 버튼은 `정보` 탭에 있다.
import { useEffect, useState } from 'react';
import { getCaseDetail, getConsents, recordConsent, type CaseDetail, type ConsentView } from '../api.ts';
import { Badge, Button, Card, DataRows, Empty, FormActions, Item, PageHeader } from '../ui.tsx';
import { BriefingScreen } from './briefing.tsx';

const TABS = ['회차별 요약', '15초 다시보기', '목표', '정보'] as const;
type Tab = (typeof TABS)[number];

const dateLabel = (iso: string | null): string => {
  if (!iso) return '날짜 없음';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

/** 회차별 요약 — 회차 목록과 원문. 상담 종결은 회차가 아니므로 번호 없이 따로 붙는다(SPEC §4-3). */
function Sessions({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const [openIds, setOpenIds] = useState<number[]>([]);
  const done = detail.sessions.filter((s) => s.status === 'done');

  if (done.length === 0) return <Card title="회차별 요약"><Empty>아직 기록한 상담이 없어요.</Empty></Card>;

  return (
    <>
      <Card title="회차별 요약" hint="AI 없이 만든 기록 상태예요. 요약이 아니에요.">
        {done.map((s) => (
          <div className="wire-repeat-card" key={s.id}>
            <Item
              title={`${s.seq}회차 · ${dateLabel(s.held_at)}${s.kind === 'intake' ? ' · 인테이크' : ''}`}
              desc={s.line}
              action={
                <>
                  <Button
                    onClick={() =>
                      setOpenIds((prev) =>
                        prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                      )
                    }
                  >
                    {openIds.includes(s.id) ? '원문 닫기' : '원문 보기'}
                  </Button>
                  {s.kind === 'intake' ? (
                    <Button onClick={() => (window.location.hash = `#/cases/${caseId}/intake`)}>
                      고쳐 쓰기
                    </Button>
                  ) : (
                    <Button
                      onClick={() => (window.location.hash = `#/cases/${caseId}/sessions/${s.id}/edit`)}
                    >
                      고쳐 쓰기
                    </Button>
                  )}
                </>
              }
            />
            {openIds.includes(s.id) && <p className="info-original">{s.memo ?? '수기 기록이 없어요.'}</p>}
          </div>
        ))}
      </Card>
      {detail.closure && (
        <Card title="상담 종결" hint="회차가 아니에요. 번호를 받지 않아요.">
          <Item
            title={dateLabel(detail.closure.closed_at)}
            desc={`${detail.closure.close_reason}${
              detail.closure.unfinished_note ? ` · ${detail.closure.unfinished_note}` : ''
            }`}
          />
        </Card>
      )}
    </>
  );
}

/** 목표 — 전체 상담 목표와 그 수정 이력, 회차별 오늘 상담 목표. */
function Goals({ detail }: { detail: CaseDetail }) {
  const withGoal = detail.sessions.filter((s) => s.today_goal_text);
  const history = detail.goal_revisions;
  return (
    <>
      <Card title="전체 상담 목표">
        {detail.case.overall_goal ? (
          <p className="wire-item-title">{detail.case.overall_goal}</p>
        ) : (
          <Empty>아직 정하지 않았어요. 비워 두어도 괜찮아요.</Empty>
        )}
      </Card>
      <Card title="전체 상담 목표 이력" hint="고쳐도 지난 회차에 찍힌 당시 목표는 그대로예요.">
        {history.length === 0 ? (
          <Empty>아직 이력이 없어요.</Empty>
        ) : (
          history.map((r, i) => (
            <Item
              key={`${r.created_at}-${i}`}
              title={r.text ?? '(비움)'}
              desc={`${dateLabel(r.created_at)}${i === 0 ? ' · 처음 정함' : ' · 고침'}`}
            />
          ))
        )}
      </Card>
      <Card title="회차별 오늘 상담 목표">
        {withGoal.length === 0 ? (
          <Empty>이어받은 목표가 아직 없어요.</Empty>
        ) : (
          withGoal.map((s) => (
            <Item key={s.id} title={s.today_goal_text ?? ''} desc={`${s.seq}회차 · ${dateLabel(s.held_at)}`} />
          ))
        )}
      </Card>
    </>
  );
}

/** 동의 — 영역마다 현재 상태와 그 자리에서 받기·철회. 사건은 쌓이기만 한다. */
function Consents({ caseId }: { caseId: number }) {
  const [rows, setRows] = useState<ConsentView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getConsents(caseId).then(setRows);
  }, [caseId]);

  const decide = async (domain: ConsentView[number]['domain'], decision: 'grant' | 'withdraw') => {
    setBusy(true);
    try {
      setRows(await recordConsent(caseId, { domain, decision }));
    } finally {
      setBusy(false);
    }
  };

  const STATUS: Record<string, string> = {
    granted: '동의함',
    not_granted: '동의 없음',
    unconfirmed: '확인 필요',
  };

  return (
    <Card title="동의" hint="지운 적 없는 사건을 접어 낸 현재 상태예요. 철회해도 지난 기록은 남아요.">
      {rows === null ? (
        <Empty>불러오는 중이에요.</Empty>
      ) : (
        rows.map((row) => (
          <div className="wire-repeat-card" key={row.domain}>
            <Item
              title={`${row.label} · ${STATUS[row.status] ?? row.status}`}
              desc={row.copy}
              action={
                row.status === 'granted' ? (
                  <Button disabled={busy} onClick={() => void decide(row.domain, 'withdraw')}>
                    철회
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => void decide(row.domain, 'grant')}>
                    동의 받기
                  </Button>
                )
              }
            />
            {row.decided_at && <p className="panel-meta">{dateLabel(row.decided_at)}</p>}
          </div>
        ))
      )}
    </Card>
  );
}

/** 정보 — 기본 정보와 상담 종결 버튼. */
function Info({ detail, caseId }: { detail: CaseDetail; caseId: number }) {
  const rows: Array<[string, string]> = [
    ['이름', detail.participant.name ?? '—'],
    ['연락처', detail.participant.phone ?? '—'],
    ['이메일', detail.participant.email ?? '—'],
    ['가명', detail.pseudonym],
    ['참여 사업', detail.case.program_name],
    ['예정 회차', detail.case.sessions_planned ? `${detail.case.sessions_planned}회` : '정하지 않음'],
  ];
  return (
    <>
      <Card title="기본 정보" hint="이름·연락처·이메일은 금고에서 꺼내 보여 줘요. 상담 기록에는 남지 않아요.">
        <DataRows rows={rows} />
      </Card>
      <Consents caseId={caseId} />

      <Card title="상담 종결">
        {detail.closure ? (
          <Empty>{`${dateLabel(detail.closure.closed_at)}에 종결했어요. · ${detail.closure.close_reason}`}</Empty>
        ) : (
          <>
            <p className="panel-meta">
              미완료 과제 {detail.open_cards.filter((c) => c.kind === 'promise').length}건이 남아 있어요. 종결
              화면에서 함께 확인해요.
            </p>
            <FormActions>
              <Button onClick={() => (window.location.hash = `#/cases/${caseId}/close`)}>상담 종결</Button>
            </FormActions>
          </>
        )}
      </Card>
    </>
  );
}

export function ParticipantInfoScreen({ caseId }: { caseId: number }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<Tab>('회차별 요약');

  useEffect(() => {
    void getCaseDetail(caseId).then(setDetail);
  }, [caseId]);

  if (!detail) return <p className="empty">불러오는 중이에요.</p>;

  return (
    <>
      <PageHeader
        title="당사자 정보"
        meta={
          <>
            {`${detail.participant.name ?? detail.pseudonym} · ${detail.case.program_name}`}
            {detail.case.status === 'closed' && <Badge>종결</Badge>}
          </>
        }
      />
      <div className="wire-container">
        <div className="info-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className="wire-step"
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '회차별 요약' && <Sessions detail={detail} caseId={caseId} />}
        {tab === '목표' && <Goals detail={detail} />}
        {tab === '정보' && <Info detail={detail} caseId={caseId} />}
      </div>
      {/* 15초 다시보기는 같은 화면을 그대로 쓴다. 두 벌로 만들지 않는다. */}
      {tab === '15초 다시보기' && <BriefingScreen caseId={caseId} hideHeader />}
    </>
  );
}
