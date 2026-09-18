// 02 회차별 요약 뷰 — 4구역 `이번 상담의 핵심` · `이번 회차에서 확인된 변화` · `확인필요` ·
// `완료·해결`. 내용 없는 구역·하위 항목은 그리지 않고, 하위 번호 ①②③ 은 내용 있는 것만
// 세어 렌더 시 매긴다(T12 — 저장된 번호가 아니다).
// override(사람이 고침)가 있으면 `이번 상담의 핵심` 만 그 텍스트로 바뀌고 span 근거·목표
// 연결은 해제된다 — 나머지 구역·01 구조·전사 연결은 그대로(Q 17). 고치는 자리는 화면에
// 없다(2026-09-18 Q — `summary_override` 는 서버 것이다).
//
// 구역 부품(`SummaryItems`·`ChangeSubsections`·`KeywordChips`)은 따로 내보낸다: 당사자
// 정보의 회차 카드는 구역마다 아코디언(`SeqSection`)이 감싸므로 이 뷰의 4구역 틀을 쓰지 않고
// **항목 렌더만** 빌린다(형식 규칙을 두 곳에 복사하지 않는다).
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

/**
 * 항목 문장을 감싸는 자리. 회차 카드는 문장을 근거 모달로 여는 `seq-link` 버튼으로 만들고
 * (span 좌표를 함께 넘긴다), 검토 화면처럼 링크가 없는 자리는 글자 그대로 둔다.
 */
export type ItemLink = (text: string, spans: string[]) => ReactNode;
const linked = (link: ItemLink | undefined, text: string, spans: string[]): ReactNode =>
  link ? link(text, spans) : text;

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

/** 핵심·확인필요·완료·해결의 항목 목록. */
export const SummaryItems = ({
  items,
  sessionSeq,
  link,
}: {
  items: SummaryItem[];
  sessionSeq?: number;
  link?: ItemLink;
}) => (
  <ul className="seq-list">
    {items.map((item, i) => (
      <li key={i}>
        {linked(link, item.text, item.spans)} <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
      </li>
    ))}
  </ul>
);

const PromiseResult = ({
  item,
  sessionSeq,
  link,
}: {
  item: PromiseResultItem;
  sessionSeq?: number;
  link?: ItemLink;
}) => (
  <li>
    <p className="seq-text">약속: "{linked(link, item.promise, item.promise_spans)}"</p>
    <p className="seq-text">실제 결과: "{linked(link, item.result, item.result_spans)}"</p>
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

const NewlyRevealed = ({
  item,
  sessionSeq,
  link,
}: {
  item: NewlyRevealedItem;
  sessionSeq?: number;
  link?: ItemLink;
}) => (
  <li>
    {item.dialogue?.worker && <p className="seq-text">실무자: "{item.dialogue.worker}"</p>}
    {item.dialogue?.participant && <p className="seq-text">당사자: "{item.dialogue.participant}"</p>}
    {/* mode=change 는 전후가 있어 `변화점:`, confirmed 는 없어 `확인된 내용:` — 둘을 섞지 않는다. */}
    <p className="seq-text">{item.mode === 'change' ? '변화점:' : '확인된 내용:'}</p>
    <ul className="seq-list">
      {item.lines.map((l, i) => (
        <li key={i}>{linked(link, l, item.spans)}</li>
      ))}
    </ul>
    <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
  </li>
);

const NewPossibility = ({
  item,
  sessionSeq,
  link,
}: {
  item: NewPossibilityItem;
  sessionSeq?: number;
  link?: ItemLink;
}) => (
  <li>
    {item.dialogue?.worker && <p className="seq-text">실무자: "{item.dialogue.worker}"</p>}
    {item.dialogue?.participant && <p className="seq-text">당사자: "{item.dialogue.participant}"</p>}
    <p className="seq-text">변화점:</p>
    <ul className="seq-list">
      {item.lines.map((l, i) => (
        <li key={i}>{linked(link, l, [...item.change_spans, ...item.plan_spans])}</li>
      ))}
    </ul>
    <GoalTag goal={item.goal} sessionSeq={sessionSeq} />
  </li>
);

/** `이번 회차에서 확인된 변화` 의 건수 — 아코디언 머리의 `N건` 이 세는 값이다. */
export const changeItemCount = (changes: SessionSummary['changes']): number =>
  CHANGE_SUBSECTIONS.reduce((n, key) => n + changes[key].length, 0);

/**
 * `이번 회차에서 확인된 변화` 의 하위 항목 셋. 의미 순서는 고정(약속 이행 여부 → 새로 드러난 것
 * → 새로운 가능성)이고 번호는 비어 있지 않은 것만 세어 ①부터 단다(T12).
 */
export function ChangeSubsections({
  changes,
  sessionSeq,
  link,
}: {
  changes: SessionSummary['changes'];
  sessionSeq?: number;
  link?: ItemLink;
}) {
  const filled = CHANGE_SUBSECTIONS.filter((key) => changes[key].length > 0);
  const body = (key: (typeof CHANGE_SUBSECTIONS)[number]): ReactNode => {
    if (key === 'promise_result')
      return changes.promise_result.map((item, i) => (
        <PromiseResult key={i} item={item} sessionSeq={sessionSeq} link={link} />
      ));
    if (key === 'newly_revealed')
      return changes.newly_revealed.map((item, i) => (
        <NewlyRevealed key={i} item={item} sessionSeq={sessionSeq} link={link} />
      ));
    return changes.new_possibility.map((item, i) => (
      <NewPossibility key={i} item={item} sessionSeq={sessionSeq} link={link} />
    ));
  };
  return (
    <>
      {filled.map((key, i) => (
        <div className="summary-subsection" key={key}>
          <h4 className="summary-subsection-title">
            {SUBSECTION_NO[i]} {CHANGE_SUBSECTION_LABEL[key]}
          </h4>
          <ul className="seq-list">{body(key)}</ul>
        </div>
      ))}
    </>
  );
}

/** 키워드 칩 — 결정적은 민트(사람의 어휘), LLM 추출은 라벤더. 누르면 백링크를 여는 화면이 준다. */
export function KeywordChips({
  keywords,
  onKeywordClick,
}: {
  keywords: Keyword[];
  onKeywordClick?: (keyword: string) => void;
}) {
  if (keywords.length === 0) return null;
  return (
    <div className="keyword-chips">
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
  );
}

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
  const changeCount = changes ? changeItemCount(changes) : 0;

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
            summary && <SummaryItems items={summary.core} sessionSeq={sessionSeq} />
          )}
        </section>
      )}
      {changes && changeCount > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="change">
            이번 회차에서 확인된 변화
          </h3>
          <ChangeSubsections changes={changes} sessionSeq={sessionSeq} />
        </section>
      )}
      {summary && summary.follow_up.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="warn">
            확인필요
          </h3>
          <SummaryItems items={summary.follow_up} sessionSeq={sessionSeq} />
        </section>
      )}
      {summary && summary.completed.length > 0 && (
        <section className="seq-section">
          <h3 className="seq-section-title" data-tone="state">
            완료·해결
          </h3>
          <SummaryItems items={summary.completed} sessionSeq={sessionSeq} />
        </section>
      )}
      <KeywordChips keywords={keywords} onKeywordClick={onKeywordClick} />
    </div>
  );
}
