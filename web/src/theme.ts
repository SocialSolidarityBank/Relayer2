// 테마. 토큰은 이미 이식돼 있다(`tokens.css` 의 `:root[data-theme="dark"]` 와
// `[data-contrast="high"]`). 없던 것은 **그 속성을 켜는 장치**뿐이라 여기서 그것만 만든다.
//
// 값을 새로 정하지 않는다. CCC 가 정한 다크 값(DESIGN §11)을 그대로 쓴다.

export type Theme = 'light' | 'dark';

const KEY = 'relayer-theme';

/**
 * 고른 테마가 없으면 **기기 설정을 따른다**. 밤에 쓰는 사람에게 흰 화면을 들이밀지 않는다.
 * 한 번 고르면 그 선택이 기기 설정을 이긴다 — 사람이 고른 것이 더 구체적인 뜻이다.
 */
export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
}

/**
 * 아직 고른 적이 없는 사람만 기기 설정 변화를 따라간다.
 * 직접 고른 사람의 화면을 OS 가 밤이 됐다고 바꿔 버리면 안 된다.
 */
export function followSystemTheme(onChange: (theme: Theme) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => {
    if (localStorage.getItem(KEY)) return;
    onChange(e.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
