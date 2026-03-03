export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'bt_theme_mode';

export function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}

export function startSystemThemeWatcher(): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    if (readThemeMode() === 'system') {
      applyThemeMode('system');
    }
  };
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
