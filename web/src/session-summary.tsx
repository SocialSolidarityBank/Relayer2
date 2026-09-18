// 02 회차별 요약 뷰 — 4구역 `이번 상담의 핵심` · `이번 회차에서 확인된 변화` · `확인필요` ·
// `완료·해결`. 내용 없는 구역·하위 항목은 그리지 않고, 하위 번호 ①②③ 은 내용 있는 것만
// 세어 렌더 시 매긴다(T12 — 저장된 번호가 아니다).
// override(사람이 고침)가 있으면 `이번 상담의 핵심` 만 그 텍스트로 바뀌고 span 근거·목표
// 연결은 해제된다 — 나머지 구역·01 구조·전사 연결은 그대로(Q 17).
import type { ReactNode } from 'react';
import {
  CHANGE_SUBSECTIONS,
  CHANGE_SUBSECTION_LABEL,
  type GoalLink,
  type Keyword,
  type NewlyRevealedItem,
  type NewPossibilityItem,
  type PromiseResultItem,
  type SessionSummary,
  type SummaryItem,
  type SummaryOverride,
} from './api.ts';
import { Badge } from './ui.tsx';

const SUBSECTION_NO = ['①', '②', '③'] as const;

/** 줄글 여러 개는 불렛, 한 줄이면 단락 하나 — participant-info 의 Lines 와 같은 규칙. */
const Lines = ({ text }: { text: string }) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? (
    <ul className="seq-list">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  ) : (
    <p className="seq-text">{text}</p>
  );
};

/** 항목이 어느 목표와 연결되는지 표시 — `전체 목표` / `N회차 목표`(Q 2). */
const GoalTag = ({ goal, sessionSeq }: { goal: GoalLink; sessionSeq?: number }) =>
  goal === 'overall' ? (
    <span className="seq-section-note">전체 목표</span>
  ) : goal === 'session' ? (
    <span className="seq-section-note">{sessionSeq != null ? `${sessionSeq}회차 목표` : '회차 목표'}</span>
  ) : null;

const SummaryLines = ({ items, sessionSeq }: { items: SummaryItem[]; sessionSeq?: number }) => (
  <ul className="seq-list">
    {items.map((item, i) => (
      <li key={i}>
        {item.text} <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
      </li>
    ))}
  </ul>
);

const PromiseResult = ({ item, sessionSeq }: { item: PromiseResultItem; sessionSeq?: number }) => (
  <li>
    <p className="seq-text">약속: "{item.promise}"</p>
    <p className="seq-text">실제 결과: "{item.result}"</p>
    {item.changes.length > 0 && (
      <>
        <p className="seq-text">변화점:</p>
        <ul className="seq-list">
          {item.changes.map((c, i) => (
            <li key={i}>
              [{c.before}] → [{c.after}]{c.meaning ? ` (${c.meaning})` : ''}
            </li>
          ))}
        </ul>
      </>
    )}
    {item.conclusion && <p className="seq-text">∴ {item.conclusion}</p>}
    <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
  </li>
);

const NewlyRevealed = ({ item, sessionSeq }: { item: NewlyRevealedItem; sessionSeq?: number }) => (
  <li>
    {item.dialogue?.worker && <p className="seq-text">실무자: "{item.dialogue.worker}"</p>}
    {item.dialogue?.participant && <p className="seq-text">당사자: "{item.dialogue.participant}"</p>}
    {/* mode=change 는 전후가 있어 `변화점:`, confirmed 는 없어 `확인된 내용:` — 둘을 섞지 않는다. */}
    <p className="seq-text">{item.mode === 'change' ? '변화점:' : '확인된 내용:'}</p>
    <ul className="seq-list">
      {item.lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
    <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
  </li>
);

const NewPossibility = ({ item, sessionSeq }: { item: NewPossibilityItem; sessionSeq?: number }) => (
  <li>
    {item.dialogue?.worker && <p className="seq-text">실무자: "{item.dialogue.worker}"</p>}
    {item.dialogue?.participant && <p className="seq-text">당사자: "{item.dialogue.participant}"</p>}
    <p className="seq-text">변화점:</p>
    <ul className="seq-list">
      {item.lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
    <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
  </li>
);

export function SessionSummaryView({
  summary,
  keywords,
  override,
  legacy,
  sessionSeq,
  onKeywordClick,
}: {
  summary: SessionSummary | null;
  keywords: Keyword[];
  override: SummaryOverride | null;
  /** v6 분석이 없고 구버전 승인 요약만 있을 때 — 핵심 구역에 텍스트 + `구버전 정리` 배지만. */
  legacy?: string | null;
  /** `N회차 목표` 태그의 N. */
  sessionSeq?: number;
  onKeywordClick?: (keyword: string) => void;
}) {
  const changes = summary?.changes;
  // 하위 항목은 의미 순서가 고정(약속 이행 여부 → 새로 드러난 것 → 새로운 가능성)이고
  // 번호는 비어 있지 않은 것만 세어 ①부터 단다.
  const filled = changes ? CHANGE_SUBSECTIONS.filter((k) => changes[k].length > 0) : [];

  const subsectionBody = (key: (typeof CHANGE_SUBSECTIONS)[number]): ReactNode => {
    if (!changes) return null;
    if (key === 'promise_result')
      return changes.promise_result.map((item, i) => <PromiseResult key={i} item={item} sessionSeq={sessionSeq} />);
    if (key === 'newly_revealed')
      return changes.newly_revealed.map((item, i) => <NewlyRevealed key={i} item={item} sessionSeq={sessionSeq} />);
    return changes.new_possibility.map((item, i) => <NewPossibility key={i} item={item} sessionSeq={sessionSeq} />);
  };

  return (
    <div className="seq-sections" data-cols="2">
      {(override || legacy || (summary && summary.core.length > 0)) && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="ai">
            이번 상담의 핵심
            {override && <Badge tone="mint">사람이 고침</Badge>}
            {!override && legacy && <Badge>구버전 정리</Badge>}
          </h3>
          {override ? (
            <Lines text={override.text} />
          ) : legacy ? (
            <Lines text={legacy} />
          ) : (
            summary && <SummaryLines items={summary.core} sessionSeq={sessionSeq} />
          )}
        </section>
      )}
      {filled.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="change">
            이번 회차에서 확인된 변화
          </h3>
          {filled.map((key, i) => (
            <div className="summary-subsection" key={key}>
              <h4 className="summary-subsection-title">
                {SUBSECTION_NO[i]} {CHANGE_SUBSECTION_LABEL[key]}
              </h4>
              <ul className="seq-list">{subsectionBody(key)}</ul>
            </div>
          ))}
        </section>
      )}
      {summary && summary.follow_up.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="warn">
            확인필요
          </h3>
          <SummaryLines items={summary.follow_up} sessionSeq={sessionSeq} />
        </section>
      )}
      {summary && summary.completed.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="state">
            완료·해결
          </h3>
          <SummaryLines items={summary.completed} sessionSeq={sessionSeq} />
        </section>
      )}
      {keywords.length > 0 && (
        <div className="keyword-chips is-wide">
          {keywords.map((k) =>
            onKeywordClick ? (
              <button key={k.text} type="button" className="keyword-chip" onClick={() => onKeywordClick(k.text)}>
                <Badge tone={k.source === 'llm' ? 'lavender' : 'mint'}>{k.text}</Badge>
              </button>
            ) : (
              <Badge key={k.text} tone={k.source === 'llm' ? 'lavender' : 'mint'}>
                {k.text}
              </Badge>
            ),
          )}
        </div>
      )}
    </div>
  );
}
