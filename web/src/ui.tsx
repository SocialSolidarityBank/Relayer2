// CCC wire 계약을 쓰는 최소 부품. 클래스 이름과 구조는 정본 그대로이며 새 이름을 만들지 않는다.
// 근거: web/src/styles/wire.css(=CCC wire-styles.ts), web/src/styles/shell.css(=CCC layout.tsx).
import { useState, type ReactNode } from 'react';
import { LIFE_AREAS } from './areas.ts';

export function PageHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="wire-page-title">{title}</h1>
        {meta && <p className="panel-meta">{meta}</p>}
      </div>
    </header>
  );
}

/** surface-card wire-card + 제목·구분선·본문. 카드 div 를 손으로 만들지 않는다(DESIGN.md §5). */
export function Card({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `surface-card wire-card ${className}` : 'surface-card wire-card'}>
      {title && (
        <>
          <h2 className="wire-card-title">{title}</h2>
          <div className="wire-card-divider" />
        </>
      )}
      <div className="wire-card-body">
        {hint && <p className="panel-meta">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

export function Button({
  variant = 'secondary',
  children,
  ...rest
}: { variant?: 'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="wire-button" data-variant={variant} {...rest}>
      <span className="wire-button-text">{children}</span>
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  control = 'input',
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  control?: 'input' | 'textarea' | 'select';
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="wire-form-field">
      <label className="wire-form-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="wire-badge wire-required-marker"><span className="wire-badge-label">필수</span></span>}
      </label>
      <div className="wire-input-box" data-control={control}>
        {children}
      </div>
      {hint && <p className="wire-form-hint">{hint}</p>}
    </div>
  );
}

/** 선택은 알약 버튼이 아니라 네이티브 radio·checkbox 다(DESIGN-RULES §선택지). */
export function ChoiceGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="wire-fieldset">
      <legend>{legend}</legend>
      <div className="wire-choice-group">{children}</div>
    </fieldset>
  );
}

export function Choice({
  type,
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  /** 라디오는 묶음 이름이 있어야 한다. 홀로 선 체크상자는 없어도 된다. */
  name?: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="wire-choice">
      <input
        type={type}
        className={type === 'radio' ? 'wire-radio' : 'wire-checkbox'}
        name={name}
        checked={checked}
        onChange={onChange}
      />
      <span className="wire-choice-text">
        {label}
        {hint && <span className="wire-choice-hint">{hint}</span>}
      </span>
    </label>
  );
}

export type Line = { text: string; area?: string };

/** 한 줄씩 적어 쌓는 입력. 인테이크와 상담 기록하기가 같은 부품을 쓴다. */
export function LineList({
  id,
  label,
  placeholder,
  withArea,
  lines,
  onChange,
}: {
  /** id 는 공백 없는 슬러그다. 라벨을 그대로 쓰면 유효하지 않은 id 가 된다. */
  id: string;
  label: string;
  placeholder: string;
  withArea?: boolean;
  lines: Line[];
  onChange: (next: Line[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [area, setArea] = useState<string>(LIFE_AREAS[0].key);
  const add = () => {
    if (!draft.trim()) return;
    onChange([...lines, withArea ? { text: draft.trim(), area } : { text: draft.trim() }]);
    setDraft('');
  };
  return (
    <>
      {withArea && (
        <Field label="영역" htmlFor={`${id}-area`} control="select">
          <select id={`${id}-area`} value={area} onChange={(e) => setArea(e.target.value)}>
            {LIFE_AREAS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="wire-field-with-action">
        <Field label={label} htmlFor={`${id}-input`}>
          <input
            id={`${id}-input`}
            type="text"
            aria-label={label}
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Button onClick={add}>추가</Button>
      </div>
      {lines.map((line, i) => (
        <div className="wire-repeat-card" key={`${line.text}-${i}`}>
          <Item
            title={`${withArea ? `${LIFE_AREAS.find((a) => a.key === line.area)?.label} · ` : ''}${line.text}`}
            action={<Button onClick={() => onChange(lines.filter((_, j) => j !== i))}>지우기</Button>}
          />
        </div>
      ))}
    </>
  );
}

export function Item({ title, desc, action }: { title: ReactNode; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="wire-item">
      <p className="wire-item-title">{title}</p>
      {desc && <p className="wire-item-desc">{desc}</p>}
      {action && <div className="wire-item-action">{action}</div>}
    </div>
  );
}

export const Badge = ({ tone, children }: { tone?: 'mint' | 'lavender' | 'blue'; children: ReactNode }) => (
  <span className="wire-badge" data-tone={tone}>
    <span className="wire-badge-label">{children}</span>
  </span>
);

/** 이름·값 표. 이식 CSS 의 CCC-81 표 부품을 그대로 쓴다. */
export const DataRows = ({ rows }: { rows: ReadonlyArray<[string, ReactNode]> }) => (
  <dl className="wire-data-rows">
    {rows.map(([label, value]) => (
      <div className="wire-data-row" key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

export const FormActions = ({ children }: { children: ReactNode }) => (
  <div className="wire-form-actions">{children}</div>
);

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <p className="wire-error" role="alert">
    {children}
  </p>
);
