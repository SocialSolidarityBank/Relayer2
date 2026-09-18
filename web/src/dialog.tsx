// 모달 하나. 달력 선택창(date-picker.tsx)의 네이티브 <dialog> 틀과 CSS 를 그대로 쓴다 —
// 새 CSS 없이 붙이려고 클래스 이름을 공유한다(2026-09-18 Q — 목표 이력 보기).
//
// 두 가지로 연다. `trigger` 를 주면 여는 버튼까지 같이 그리고(목표 이력), `open` 을 주면
// 부르는 쪽이 열고 닫는다(회차 원본 — 목록의 어느 행에서든 같은 모달 하나를 연다).
// `size="wide"` 는 두 열 본문용 큰 팝업이다(2026-09-18 Q E2 — 폭 min(1200px, 96vw)).
import { useEffect, useRef, type ReactNode } from 'react';
import { Button, FormActions } from './ui.tsx';

export function Dialog({
  id,
  title,
  trigger,
  size,
  open,
  onClose,
  className,
  actions,
  children,
}: {
  id: string;
  title: ReactNode;
  /** 여는 버튼의 글자. 세컨더리 알약이다. `open` 을 쓰는 자리는 주지 않는다. */
  trigger?: string;
  size?: 'wide';
  /** 부르는 쪽이 여닫는 모달. 닫히면(`Escape`·닫기) `onClose` 로 알린다. */
  open?: boolean;
  onClose?: () => void;
  className?: string;
  /** 닫기 왼쪽에 서는 행동(수정·저장). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el || open === undefined) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <>
      {trigger && (
        <button
          type="button"
          className="wire-button"
          data-variant="secondary"
          ref={opener}
          aria-haspopup="dialog"
          aria-controls={`${id}-dialog`}
          onClick={() => dialog.current?.showModal()}
        >
          {trigger}
        </button>
      )}
      <dialog
        id={`${id}-dialog`}
        ref={dialog}
        className={className ? `schedule-date-dialog ${className}` : 'schedule-date-dialog'}
        data-size={size}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          opener.current?.focus();
          onClose?.();
        }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
        <FormActions>
          {actions}
          <Button onClick={() => dialog.current?.close()}>닫기</Button>
        </FormActions>
      </dialog>
    </>
  );
}
