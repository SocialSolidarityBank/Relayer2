// CCC wire 계약을 쓰는 최소 부품. 클래스 이름과 구조는 정본 그대로이며 새 이름을 만들지 않는다.
// 근거: web/src/styles/wire.css(=CCC wire-styles.ts), web/src/styles/shell.css(=CCC layout.tsx).
import { useEffect, useState, type ReactNode } from 'react';
import { LIFE_AREAS } from './areas.ts';
import { API_FAILED } from './api.ts';

/**
 * 네 방향 공용 꺽쇠. 12px 슬롯 안의 한 SVG 경로를 회전해 방향만 바꾼다.
 * 출처: CCC `apps/web/app/components/wire/chevron.tsx`(Apache-2.0). 경로와 슬롯을 그대로 쓴다.
 */
export function Chevron({ dir = 'down' }: { dir?: 'up' | 'down' | 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" className="wire-chevron" data-dir={dir} focusable="false" viewBox="0 0 12 12">
      <path
        d="M3.3 4.65 6 7.35 8.7 4.65"
        fill="none"
        stroke="var(--chevron-color, var(--sub))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * 뒤로 가기. 정본 `apps/web/app/components/wire/back-link.tsx` 를 해시 라우팅에 맞춰 옮겼다.
 *
 * 모든 화면 좌상단 같은 자리다. 브라우저 뒤로가기를 없애는 것이 아니라 **화면에도 같은
 * 출구를 하나 낸다** — 두 방법의 결과가 같다. 처음 여는 사람에게는 보이는 출구가 없다.
 *
 * **돌아갈 곳이 없으면 아예 그리지 않는다.** 없는 출구를 그려 두면 눌러도 아무 일이
 * 일어나지 않아 화면이 고장난 것처럼 보인다.
 */
export function BackLink() {
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);
  if (!canGoBack) return null;
  return (
    <div className="page-backbar">
      <button type="button" className="page-back" onClick={() => window.history.back()}>
        <Chevron dir="left" />
        <span>뒤로</span>
      </button>
    </div>
  );
}

/**
 * 동의 문안의 표준 양식 항목. **동의를 받는 자리마다 같은 것을 보여 준다**(2026-09-16 검수).
 *
 * 해시에 묶인 내용이 곧 이것이다 — 무엇을 받고, 왜 받고, 얼마나 두고, 거부하면 어떻게 되는지.
 * 이걸 감춘 채 받은 동의는 당사자가 본 적 없는 문안에 대한 동의다.
 */
export function ConsentDetail({
  copy,
}: {
  copy: {
    items: string[];
    purpose_text: string;
    retention_text: string;
    refusal_text: string;
    recipient: string | null;
    version: string;
    hash: string;
  };
}) {
  return (
    <Fold title="자세히 보기">
      <DataRows
        rows={[
          ['무엇을 받나', copy.items.join(' · ')],
          ['왜 받나', copy.purpose_text],
          ['얼마나 두나', copy.retention_text],
          ...(copy.recipient ? ([['어디로 가나', copy.recipient]] as Array<[string, ReactNode]>) : []),
          ['거부할 수 있나', copy.refusal_text],
          ['문안 판', `${copy.version} · 지문 ${copy.hash}`],
        ]}
      />
    </Fold>
  );
}

/**
 * 회차간 사실관계 변화(2026-09-16 Q). 지난 회차와 이번 회차의 **원문**을 나란히 보여 준다.
 * 어느 쪽이 맞는지 적지 않는다 — 번복했을 수 있고, 판정은 사람 몫이다.
 * 검토 화면과 회차별 요약이 같은 부품을 쓴다.
 */
export function FactChanges({ items }: { items: Array<{ topic: string; before: { seq: number; quote: string }; after: { seq: number; quote: string }; note: string }> }) {
  if (items.length === 0) return <Empty>지난 회차와 어긋나는 사실이 없어요.</Empty>;
  return (
    <>
      {items.map((f, i) => (
        <div className="wire-repeat-card" key={i}>
          <Item title={f.topic} desc={f.note} />
          <DataRows
            rows={[
              [`${f.before.seq}회차 원문`, f.before.quote],
              [`${f.after.seq}회차 원문`, f.after.quote],
            ]}
          />
        </div>
      ))}
    </>
  );
}

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

/**
 * 접히는 카드. 이식한 `wire-card-details` 계약을 그대로 쓴다(CCC DESIGN §5 · RULES:316-322).
 *
 * 접힌 상태는 제목 줄만 남은 카드이고, 펼치면 `surface-card[open]` 의 그라데이션 테두리를 받는다.
 * 접혀 있을 때는 **카드 면 전체가 누를 자리**다 — 제목 글자만 눌리면 22px 표적이 된다.
 * 그 규칙은 CSS 에 이미 있고(`wire.css:566`), 여기서는 마크업만 맞춘다.
 */
export function Fold({
  title,
  desc,
  open,
  children,
}: {
  title: string;
  /** 접힌 채로도 보이는 한 줄. 펼치지 않고 고를 수 있어야 한다. */
  desc?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="surface-card wire-card wire-card-details" open={open}>
      <summary className="wire-card-summary">
        <span className="wire-card-title">
          {title}
          {desc && <span className="wire-item-desc">{desc}</span>}
        </span>
        <span className="wire-card-summary-right">
          <Chevron dir="down" />
        </span>
      </summary>
      <div className="wire-card-divider" />
      <div className="wire-card-body">{children}</div>
    </details>
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
        {/* select 는 네이티브 화살표를 끈다(wire.css). 꺽쇠가 없으면 입력칸으로 보인다. */}
        {control === 'select' && <Chevron />}
      </div>
      {hint && <p className="wire-form-hint">{hint}</p>}
    </div>
  );
}

/**
 * 딱지 없이 줄 안에 서는 선택창. `Field` 를 못 쓰는 자리(카드 행 오른쪽 등)에 쓴다.
 * 네이티브 화살표를 끄고 꺽쇠를 직접 그린다 — 안 그리면 입력칸으로 보인다(2026-09-16 Q).
 */
export function Select({
  value,
  onChange,
  children,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <div className="wire-input-box" data-control="select">
      <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <Chevron />
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

/** 적어만 두고 `추가`를 누르지 않은 줄도 저장에 포함한다(2026-09-15 Q: 추가는 저장이 아니다). */
export const withDraft = (lines: Line[], draft: Line): Line[] =>
  draft.text.trim() ? [...lines, { ...draft, text: draft.text.trim() }] : lines;

/** 한 줄씩 적어 쌓는 입력. 인테이크와 상담 기록하기가 같은 부품을 쓴다. */
export function LineList({
  id,
  label,
  placeholder,
  withArea,
  lines,
  draft,
  onDraft,
  onChange,
}: {
  /** id 는 공백 없는 슬러그다. 라벨을 그대로 쓰면 유효하지 않은 id 가 된다. */
  id: string;
  label: string;
  placeholder: string;
  withArea?: boolean;
  lines: Line[];
  /** 아직 `추가`를 누르지 않은 한 줄. 부모가 들고 있다가 저장할 때 함께 넣는다. */
  draft: Line;
  onDraft: (next: Line) => void;
  onChange: (next: Line[]) => void;
}) {
  const area = draft.area ?? LIFE_AREAS[0].key;
  const setArea = (key: string) => onDraft({ ...draft, area: key });
  const setDraft = (text: string) => onDraft({ ...draft, text });
  const add = () => {
    if (!draft.text.trim()) return;
    onChange([...lines, withArea ? { text: draft.text.trim(), area } : { text: draft.text.trim() }]);
    onDraft({ text: '', area });
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
      {/* 입력칸과 버튼은 한 행이다(DESIGN-RULES §3: 번호 없이 입력칸·버튼 순서로 가로 배치).
          라벨은 카드 제목이 이미 말하므로 행마다 반복하지 않고 접근성 이름으로만 남긴다. */}
      <div className="wire-field-with-action" data-no-label="true">
        <div className="wire-form-field">
          <div className="wire-input-box" data-control="input">
            <input
              id={`${id}-input`}
              type="text"
              aria-label={label}
              placeholder={placeholder}
              value={draft.text}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
        </div>
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

/**
 * 부르기가 실패했을 때 뜨는 줄(2026-09-16 검수).
 *
 * 화면들이 실패를 안 잡아 `불러오는 중이에요` 에서 멈추는 일이 있었다. 멈춘 화면은
 * 고장과 구별되지 않는다 — **무엇이 잘못됐는지 말하고 다시 할 길을 준다.**
 * 화면마다 catch 를 다는 것이 정석이고, 이것은 그 전에 두는 안전선이다.
 */
export function ApiFailureBanner() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMessage(e instanceof CustomEvent ? String(e.detail) : '요청이 실패했어요.');
    window.addEventListener(API_FAILED, on);
    return () => window.removeEventListener(API_FAILED, on);
  }, []);
  if (!message) return null;
  return (
    <div className="api-failure" role="alert">
      <span>{message}</span>
      <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
      <Button onClick={() => setMessage(null)}>닫기</Button>
    </div>
  );
}
