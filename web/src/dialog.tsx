// 읽기 전용 모달 하나. 달력 선택창(date-picker.tsx)의 네이티브 <dialog> 틀과 CSS 를 그대로 쓴다 —
// 새 CSS 없이 붙이려고 클래스 이름을 공유한다(2026-09-18 Q — 목표 이력 보기).
import { useRef, type ReactNode } from 'react';
import { Button, FormActions } from './ui.tsx';

export function Dialog({
  id,
  title,
  trigger,
  children,
}: {
  id: string;
  title: string;
  /** 여는 버튼의 글자. 세컨더리 알약이다. */
  trigger: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
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
      <dialog
        id={`${id}-dialog`}
        ref={dialog}
        className="schedule-date-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => opener.current?.focus()}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
        <FormActions>
          <Button onClick={() => dialog.current?.close()}>닫기</Button>
        </FormActions>
      </dialog>
    </>
  );
}
