// 테마. 토큰은 이미 이식돼 있다(`tokens.css` 의 `:root[data-theme="dark"]` 와
// `[data-contrast="high"]`). 없던 것은 **그 속성을 켜는 장치**뿐이라 여기서 그것만 만든다.
//
// 값을 새로 정하지 않는다. CCC 가 정한 다크 값(DESIGN §11)을 그대로 쓴다.

/** 화면에 실제로 칠하는 두 값. */
export type Theme = 'light' | 'dark';

/**
 * 사람이 고르는 세 값(2026-09-16 Q). `system` 은 **고르지 않기를 고른 것**이라
 * 저장은 하되 칠할 때는 그 순간의 기기 설정으로 바꿔 쓴다.
 */
export type ThemeChoice = Theme | 'system';

const KEY = 'relayer-theme';

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/** 저장된 선택. 없으면 `system` — 밤에 쓰는 사람에게 흰 화면을 들이밀지 않는다. */
export function themeChoice(): ThemeChoice {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function initialTheme(): Theme {
  const choice = themeChoice();
  return choice === 'system' ? systemTheme() : choice;
}

/** 고른 값을 적어 두고 그 자리에서 칠한다. */
export function setTheme(choice: ThemeChoice): Theme {
  localStorage.setItem(KEY, choice);
  const theme = choice === 'system' ? systemTheme() : choice;
  applyTheme(theme);
  return theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * `system` 을 고른 사람만 기기 설정 변화를 따라간다.
 * 직접 고른 사람의 화면을 OS 가 밤이 됐다고 바꿔 버리면 안 된다.
 */
export function followSystemTheme(onChange: (theme: Theme) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => {
    if (themeChoice() !== 'system') return;
    onChange(e.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
