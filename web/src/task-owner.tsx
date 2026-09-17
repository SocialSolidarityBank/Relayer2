// 과제 수행 주체 토글(2026-09-18 Q — 요구 16 되돌림). 당사자 ↔ 담당 실무자.
// 반복 입력(LineList)의 입력칸 오른쪽, 추가 버튼 앞에 선다. 라디오 두 개라 키보드·스크린리더 그대로 된다.
import { OWNER_LABEL, type CardOwner } from './api.ts';
import { Choice } from './ui.tsx';

export function TaskOwnerToggle({
  id,
  value,
  onChange,
}: {
  id: string;
  value: CardOwner;
  onChange: (next: CardOwner) => void;
}) {
  return (
    <div className="wire-choice-group" role="radiogroup" aria-label="수행 주체" style={{ display: 'flex', gap: 'var(--space-4)', flex: 'none' }}>
      {(Object.keys(OWNER_LABEL) as CardOwner[]).map((owner) => (
        <Choice
          key={owner}
          type="radio"
          name={`${id}-owner`}
          label={OWNER_LABEL[owner]}
          checked={value === owner}
          onChange={() => onChange(owner)}
        />
      ))}
    </div>
  );
}
