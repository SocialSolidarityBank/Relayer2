// 대조 패널 — 문장을 고르면 수기↔전사를 나란히 놓는 자리(원본 팝업 우측, ≤767 하단).
// 불일치는 `차이점` 까지 4항목, 일반 연결은 차이점 없이 3항목, 키워드 칩은 같은 자리에
// 백링크 목록을 연다(Q 11). 4조건 조건표는 저장만 하고 화면에 내지 않는다.
import type { ReactNode } from 'react';
import type { Backlink, Paragraph } from './api.ts';
export type ContrastPanelProps = {
  mode: 'discrepancy' | 'link' | 'backlinks' | 'empty';
  /** `차이점` — discrepancy 모드에서만. */
  difference?: string;
  transcriptText?: string;
  writtenText?: string;
  /** `연결된 수기 단락` 버튼이 가리키는 단락. 없으면 버튼도 없다. */
  paragraph?: Paragraph | null;
  keyword?: string;
  backlinks?: Backlink[];
  onGoToParagraph?: (paragraphId: string) => void;
  onGoToBacklink?: (item: Backlink) => void;
};

const Block = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="contrast-block">
    <p className="contrast-label">{label}</p>
    {children}
  </div>
);

export function ContrastPanel(props: ContrastPanelProps) {
  const { mode } = props;
  return (
    <div className="analysis-panel" role="region" aria-label="대조">
      {mode === 'empty' && <p className="seq-section-note">문장을 고르면 대조</p>}
      {(mode === 'discrepancy' || mode === 'link') && (
        <>
          {mode === 'discrepancy' && (
            <Block label="차이점">
              <p className="seq-text">{props.difference}</p>
            </Block>
          )}
          <Block label="녹음 내용">
            <p className="seq-text">{props.transcriptText}</p>
          </Block>
          <Block label="수기 내용">
            <p className="seq-text">{props.writtenText}</p>
          </Block>
          {props.paragraph && (
            <Block label="연결된 수기 단락">
              <button
                type="button"
                className="contrast-goto"
                onClick={() => props.onGoToParagraph?.(props.paragraph!.id)}
              >
                {props.paragraph.id} {props.paragraph.title}
              </button>
            </Block>
          )}
        </>
      )}
      {mode === 'backlinks' && (
        <>
          <p className="contrast-label">{props.keyword}</p>
          <ul className="seq-list">
            {(props.backlinks ?? []).map((b, i) => (
              <li key={i}>
                <button type="button" className="contrast-goto" onClick={() => props.onGoToBacklink?.(b)}>
                  {b.seq}회차 · {b.paragraph_id ?? '단락 없음'} — {b.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
