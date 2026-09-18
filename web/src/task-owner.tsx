// 과제 수행 주체 토글(2026-09-18 Q — 요구 16 되돌림). 당사자 ↔ 담당 실무자.
// 반복 입력(LineList)의 입력칸 오른쪽, 추가 버튼 앞에 선다. 넓으면 라디오 둘, 입력칸이
// 좁아지면(행 폭 460 미만, 컨테이너 질의) 라디오가 자리를 침해하므로 선택창으로 바꾼다(2026-09-18 Q).
import { OWNER_LABEL, type CardOwner } from './api.ts';
import { Choice, Select } from './ui.tsx';

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
      <div className="task-owner-radios wire-choice-group" role="radiogroup" aria-label="수행 주체">
        {owners.map((owner) => (
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
      <div className="task-owner-select">
        <Select id={`${id}-owner-select`} aria-label="수행 주체" value={value} onChange={(v) => onChange(v as CardOwner)}>
          {owners.map((owner) => (
            <option key={owner} value={owner}>
              {OWNER_LABEL[owner]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
