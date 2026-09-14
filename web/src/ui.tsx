// CCC wire 계약을 쓰는 최소 부품. 클래스 이름과 구조는 정본 그대로이며 새 이름을 만들지 않는다.
// 근거: web/src/styles/wire.css(=CCC wire-styles.ts), web/src/styles/shell.css(=CCC layout.tsx).
import type { ReactNode } from 'react';

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
  checked,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  label: string;
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
      <span className="wire-choice-text">{label}</span>
    </label>
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
