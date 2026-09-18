// 과제 수행 주체(2026-09-18 Q — 요구 16 되돌림). 당사자 ↔ 담당 실무자.
// 반복 입력(LineList)의 입력칸 오른쪽, 추가 버튼 앞에 선다. **늘 선택창**이다(2026-09-18 Q —
// 구 넓은 폭 라디오 둘 + 좁은 폭 선택창 전환 폐지). 폭이 하나라 과제·물어볼 것 입력칸 폭이 같다.
import { OWNER_LABEL, type CardOwner } from './api.ts';
import { Select } from './ui.tsx';

export function TaskOwnerToggle({
  id,
  value,
  onChange,
}: {
  id: string;
  value: CardOwner;
  onChange: (next: CardOwner) => void;
}) {
  const owners = Object.keys(OWNER_LABEL) as CardOwner[];
  return (
    <div className="task-owner">
      <Select id={`${id}-owner-select`} aria-label="수행 주체" value={value} onChange={(v) => onChange(v as CardOwner)}>
        {owners.map((owner) => (
          <option key={owner} value={owner}>
            {OWNER_LABEL[owner]}
          </option>
        ))}
      </Select>
    </div>
  );
}
