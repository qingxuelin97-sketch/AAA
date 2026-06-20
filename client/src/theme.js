// Theme controller — light / dark / system, persisted in localStorage so it applies
// before React mounts (no flash) and works even on the login screen.
const KEY = 'huanyu_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeMode() { return localStorage.getItem(KEY) || 'system'; }
export function resolveTheme(mode = getThemeMode()) {
  return mode === 'system' ? (mq().matches ? 'dark' : 'light') : mode;
}
export function applyTheme(mode = getThemeMode()) {
  document.documentElement.dataset.theme = resolveTheme(mode);
}
export function setThemeMode(mode) { localStorage.setItem(KEY, mode); applyTheme(mode); }
export function initTheme() {
  applyTheme();
  try { mq().addEventListener('change', () => { if (getThemeMode() === 'system') applyTheme('system'); }); } catch { /* older browsers */ }
}
