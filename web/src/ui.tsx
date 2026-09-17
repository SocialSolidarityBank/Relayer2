// CCC wire 계약을 쓰는 최소 부품. 클래스 이름과 구조는 정본 그대로이며 새 이름을 만들지 않는다.
// 근거: web/src/styles/wire.css(=CCC wire-styles.ts), web/src/styles/shell.css(=CCC layout.tsx).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * 확인 대화상자(2026-09-17 Q). 되돌리기 어려운 행동 앞에 선다 — 지금은 상담 종결 하나다.
 * 네이티브 `<dialog>` 의 모달을 쓴다(날짜 선택기와 같은 방식): Escape·바깥 클릭이 곧 취소고,
 * 초점은 브라우저가 가둔다. 확인 버튼은 danger 톤이고 기본 초점은 취소다 —
 * 잘못 눌러 열렸을 때 Enter 가 종결로 이어지면 안 된다.
 */
export function Confirm({
  open,
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** 왜 멈춰 세웠는지. 조건마다 한 줄이고, 없으면 확인만 묻는다. */
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={onCancel} onClose={onCancel}>
      <h2 id="confirm-title">{title}</h2>
      {lines.length > 0 && (
        <ul className="confirm-lines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="wire-form-actions">
        <Button onClick={onCancel}>취소</Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
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
          ['무엇을 받나', copy.items.join(', ')],
          ['왜 받나', copy.purpose_text],
          ['얼마나 두나', copy.retention_text],
          ...(copy.recipient ? ([['어디로 가나', copy.recipient]] as Array<[string, ReactNode]>) : []),
          ['거부할 수 있나', copy.refusal_text],
          ['문안 판', `${copy.version}, 지문 ${copy.hash}`],
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
  if (items.length === 0) return <Empty>지난 회차와 어긋나는 사실 없음</Empty>;
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

/**
 * 화면 제목 줄. `actions` 를 주면 이식한 `.page-actions` 슬롯에 담아 제목과 **같은 행에서
 * 세로 가운데·오른쪽 끝**에 세운다(2026-09-17 Q). 767 이하에서는 이식 규칙이 제목 아래
 * 오른쪽으로 내린다.
 */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="wire-page-title">{title}</h1>
        {meta && <p className="panel-meta">{meta}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/**
 * 당사자 중심 화면의 머리 — **여기가 이 사람의 카드다**(CCC `ParticipantHeroCard`, D38).
 * 이식 CSS(`wire.css:269-293`)를 그대로 쓰고 새 클래스를 만들지 않는다.
 *
 * 구분선 **위에는 이름과 행동만**, 아래는 라벨/값 정보 격자다(내부 폭 760 초과 4열, 그 아래
 * 80px 라벨 행). 값이 칸보다 길면 **한 줄로 잘라 말줄임**하고 전체는 `title` 로 남긴다
 * (2026-09-17 Q — 카드 장폭이 넓어 4열이 들어간다). 값이 없는 항목은 호출부가 빈 값을 주면
 * 자동으로 빠진다. **배지를 두지 않는다** — 상태도 라벨/값이다(CCC 2026-09-08 Q).
 * 이름이 없으면 가명이 이름 자리를 대신하고, 이름이 있으면 가명은 정보 격자의 값으로 내려간다.
 *
 * 제목은 `h1` 이다 — 이 화면의 주제가 화면 용도가 아니라 **사람**이다(DESIGN.md §4).
 * 스크롤을 따라오지 않는다(sticky 는 셸과 기록 레일의 것이다).
 */
export function ParticipantHero({
  name,
  pseudonym,
  details = [],
  actions,
}: {
  name: string | null;
  pseudonym: string;
  details?: ReadonlyArray<[string, ReactNode]>;
  actions?: ReactNode;
}) {
  const shown = details.filter(([, value]) => value !== null && value !== undefined && value !== '');
  return (
    <header className="page-header surface-card participant-hero-card">
      <div className="participant-hero-top">
        <h1 className="participant-hero-title">
          <span className="participant-name-group" data-size="hero">
            <span className={name ? 'participant-name' : 'participant-name participant-card-name is-empty'}>
              {name ?? pseudonym}
            </span>
          </span>
        </h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {shown.length > 0 && (
        <>
          <hr className="participant-hero-divider" />
          <div className="participant-hero-info">
            <div className="participant-hero-details">
              {shown.map(([label, value]) => (
                <div
                  className="wire-field-row"
                  data-layout="stack"
                  data-size="sm"
                  data-truncate="true"
                  key={label}
                >
                  <span className="wire-field-label">{label}</span>
                  <span className="wire-field-value" title={typeof value === 'string' ? value : undefined}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </header>
  );
}

/**
 * surface-card wire-card + 제목·구분선·본문. 카드 div 를 손으로 만들지 않는다(DESIGN.md §5).
 */
export function Card({
  title,
  badge,
  hint,
  action,
  tone,
  children,
  className,
}: {
  title?: string;
  /** 제목 옆에 붙는 식별자 배지(주소 이름 따위). 이식 `.wire-card-head` 는 배지를 auto 마진에서 뺀다. */
  badge?: ReactNode;
  hint?: ReactNode;
  /** 제목과 같은 행 오른쪽 끝에 서는 행동 하나(이식 `.wire-card-head`). */
  action?: ReactNode;
  /** 제목 색. `ai` = AI 산출(라벤더), `warn` = 주목·경고(코랄). 없으면 기본 --ink(DESIGN.md §6). */
  tone?: 'ai' | 'warn';
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `surface-card wire-card ${className}` : 'surface-card wire-card'}>
      {title && (
        <>
          {badge || action ? (
            <div className="wire-card-title" data-tone={tone}>
              <div className="wire-card-head">
                <h2>{title}</h2>
                {badge && <span className="wire-badge"><span className="wire-badge-label">{badge}</span></span>}
                {action}
              </div>
            </div>
          ) : (
            <h2 className="wire-card-title" data-tone={tone}>{title}</h2>
          )}
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
 *
 * 펼친 제목 줄 아래에는 **가로선을 두지 않는다**(2026-09-17 Q). 제목과 본문은 24 여백으로
 * 갈리고, 선은 한 카드 안에 여러 구획이 있을 때만 뜻이 있다. 이식 CSS 의 `[open]` 제목 줄
 * 아래 선은 `app.css` 에서 끈다.
 */
export function Fold({
  title,
  desc,
  open,
  group,
  action,
  onOpen,
  crisis = false,
  children,
}: {
  /** 문자열이 기본이다. 배지를 제목 줄에 함께 세울 때만 노드를 준다. */
  title: ReactNode;
  /** 접힌 채로도 보이는 한 줄. 펼치지 않고 고를 수 있어야 한다. */
  desc?: ReactNode;
  open?: boolean;
  /** 같은 이름을 준 카드끼리는 하나만 펼쳐진다(브라우저가 하는 일, `<details name>`). */
  group?: string;
  /**
   * 머리줄 오른쪽 끝(꺽쇠 앞)에 서는 행동. 접힌 채로도 누를 수 있다.
   * 누를 때 카드가 접히거나 펼쳐지지 않게 호출부가 `stopPropagation` 을 건다.
   */
  action?: ReactNode;
  /** 펼치는 순간 한 번 부른다 — 펼쳐야 필요한 값을 그때 불러오는 자리다. */
  onOpen?: () => void;
  /** 위험 신호가 붙은 카드. 이식 CSS 의 `is-crisis`(risk 테두리·틴트)를 그대로 쓴다. */
  crisis?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`surface-card wire-card wire-card-details${crisis ? ' is-crisis' : ''}`}
      name={group}
      open={open}
      onToggle={event => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary className="wire-card-summary">
        <span className="wire-card-title">
          <span className="fold-title-text">{title}</span>
          {desc && <span className="wire-item-desc fold-title-desc">{desc}</span>}
        </span>
        <span className="wire-card-summary-right">
          {action}
          {/* 꺽쇠는 그라데이션 테두리 원 안에 든다(이식 `.wire-chevron-button`, CCC·릴레이어1과 같다).
              펼치면 이식 CSS 가 180도 돌리고, 면은 `app.css` 가 반전시킨다. */}
          <span className="wire-chevron-button wire-disclosure-chevron" aria-hidden="true">
            <Chevron dir="down" />
          </span>
        </span>
      </summary>
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
  hideLabel,
  tone,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  control?: 'input' | 'textarea' | 'select';
  required?: boolean;
  /** 카드 제목이 이미 같은 말을 하면 라벨 행을 빼고 입력의 `aria-label` 로만 남긴다(2026-09-18 UI-8). */
  hideLabel?: boolean;
  /** 라벨 색. 기본 민트, `ai` = 라벤더, `warn` = 코랄(DESIGN.md §6). */
  tone?: 'ai' | 'warn';
  children: ReactNode;
}) {
  return (
    <div className="wire-form-field">
      {!hideLabel && (
        <label className="wire-form-label" htmlFor={htmlFor} data-tone={tone}>
          {label}
          {required && <span className="wire-badge wire-required-marker"><span className="wire-badge-label">필수</span></span>}
        </label>
      )}
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
  disabled,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  /** 라디오는 묶음 이름이 있어야 한다. 홀로 선 체크상자는 없어도 된다. */
  name?: string;
  label: string;
  hint?: string;
  checked: boolean;
  /** 저장 중에는 같은 체크를 두 번 누르지 못하게 막는다. */
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="wire-choice">
      <input
        type={type}
        className={type === 'radio' ? 'wire-radio' : 'wire-checkbox'}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="wire-choice-text">
        {label}
        {hint && <span className="wire-choice-hint">{hint}</span>}
      </span>
    </label>
  );
}

export type Line = { text: string; area?: string; owner?: 'participant' | 'worker' };

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
  readOnly,
  ownerToggle,
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
  /** 원본 보기(2026-09-18 UI-3): 적힌 줄만 보이고 입력칸·추가·삭제는 없다. */
  readOnly?: boolean;
  /** 입력칸과 추가 버튼 사이에 서는 수행 주체 토글(2026-09-18 UI-2). 과제 목록만 준다. */
  ownerToggle?: ReactNode;
}) {
  if (readOnly) {
    return lines.length === 0 ? (
      <Empty>없음</Empty>
    ) : (
      <>
        {lines.map((line, i) => (
          <div className="wire-repeat-card" key={`${line.text}-${i}`}>
            <Item
              title={`${withArea ? `${LIFE_AREAS.find((a) => a.key === line.area)?.label} · ` : ''}${line.text}`}
              desc={line.owner ? (line.owner === 'worker' ? '담당 실무자' : '당사자') : undefined}
            />
          </div>
        ))}
      </>
    );
  }
  const area = draft.area ?? LIFE_AREAS[0].key;
  const setArea = (key: string) => onDraft({ ...draft, area: key });
  const setDraft = (text: string) => onDraft({ ...draft, text });
  const add = () => {
    if (!draft.text.trim()) return;
    const line: Line = { text: draft.text.trim() };
    if (withArea) line.area = area;
    if (draft.owner) line.owner = draft.owner;
    onChange([...lines, line]);
    // 주체는 다음 줄에도 유지된다 — 실무자 일을 연달아 적을 때 매번 고르지 않게(2026-09-18 Q).
    onDraft({ text: '', area, owner: draft.owner });
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
        {ownerToggle}
        <Button onClick={add}>추가</Button>
      </div>
      {lines.map((line, i) => (
        <div className="wire-repeat-card" key={`${line.text}-${i}`}>
          <Item
            title={withArea ? <Meta parts={[LIFE_AREAS.find((a) => a.key === line.area)?.label, line.text]} /> : line.text}
            desc={line.owner ? (line.owner === 'worker' ? '담당 실무자' : '당사자') : undefined}
            action={<Button onClick={() => onChange(lines.filter((_, j) => j !== i))}>삭제</Button>}
          />
        </div>
      ))}
    </>
  );
}

/**
 * 한 항목. 행동이 있으면 **글 왼쪽 · 행동 오른쪽, 세로 가운데**로 선다(2026-09-17 Q).
 * 글 묶음은 이식한 `.wire-row-text`(행 안 글 묶음) 계약을 그대로 쓴다 — 남는 폭을 먹는다.
 * 제목·설명은 **한 줄**이고 넘치면 말줄임한다(2026-09-18 Q, `app.css`) — 문자열이면 전체를
 * `title` 로 남겨 마우스를 올리면 읽힌다. 배치는 `app.css` 가 정하고 여기서는 묶음만 만든다.
 */
export function Item({ title, desc, action }: { title: ReactNode; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="wire-item">
      <div className="wire-row-text">
        <p className="wire-item-title" title={typeof title === 'string' ? title : undefined}>{title}</p>
        {desc && <p className="wire-item-desc" title={typeof desc === 'string' ? desc : undefined}>{desc}</p>}
      </div>
      {action && <div className="wire-item-action">{action}</div>}
    </div>
  );
}

export const Badge = ({ tone, children }: { tone?: 'mint' | 'lavender' | 'blue' | 'coral'; children: ReactNode }) => (
  <span className="wire-badge" data-tone={tone}>
    <span className="wire-badge-label">{children}</span>
  </span>
);

/**
 * 성격이 다른 정보 조각을 한 줄에 잇는다(2026-09-18 Q). 부호(`·`, `|`) 없이 **간격**으로만
 * 가른다 — 조각 사이 공백 한 칸(글자 폭, 복사·낭독에서 낱말이 붙지 않게) 에 `app.css` 의
 * `.wire-meta-row` 보정이 12 를 더해 약 16 이 된다. 빈 조각은 그리지 않는다.
 * 부모의 말줄임(`text-overflow`)이 그대로 먹도록 인라인이다. 전체 문구는 `title` 로 보존한다.
 */
export const Meta = ({ parts }: { parts: ReadonlyArray<ReactNode> }) => {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return (
    <span className="wire-meta-row" title={shown.every((p) => typeof p === 'string') ? shown.join(' ') : undefined}>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span>{p}</span>
        </Fragment>
      ))}
    </span>
  );
};

/** 이름·값 표. 이식 CSS 의 CCC-81 표 부품을 그대로 쓴다. */
export const DataRows = ({ rows }: { rows: ReadonlyArray<[ReactNode, ReactNode]> }) => (
  <dl className="wire-data-rows">
    {rows.map(([label, value], i) => (
      <div className="wire-data-row" key={typeof label === 'string' ? label : i}>
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
    const on = (e: Event) => setMessage(e instanceof CustomEvent ? String(e.detail) : '요청 실패');
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
