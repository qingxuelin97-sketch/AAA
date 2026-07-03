// Theme controller — light / dark / system, persisted in localStorage so it applies
// before React mounts (no flash) and works even on the login screen.
import { isAppMode } from './appmode.js';

const KEY = 'huanyu_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeMode() { return localStorage.getItem(KEY) || 'system'; }
export function resolveTheme(mode = getThemeMode()) {
  if (mode === 'system') {
    // App 壳的原生观感默认深色（对标沉浸式内容 App）；用户在设置里显式选浅色仍然生效。
    if (isAppMode()) return 'dark';
    return mq().matches ? 'dark' : 'light';
  }
  return mode;
}
export function applyTheme(mode = getThemeMode()) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  // keep the mobile status-bar / PWA theme color in sync
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#15120e' : '#f4f2ec');
  try { window.dispatchEvent(new Event('huanyu-theme')); } catch { /* */ }
}
export function setThemeMode(mode) { localStorage.setItem(KEY, mode); applyTheme(mode); }

// 毛玻璃（玻璃拟态）外观开关 — persisted, applied via data-glass on <html>.
const GLASS_KEY = 'huanyu_glass';
// 默认开启毛玻璃：未显式设置过时返回 true（APP 端高度玻璃拟态，掩饰粗糙感）。
export function getGlass() { const v = localStorage.getItem(GLASS_KEY); return v === null ? true : v === '1'; }
export function applyGlass(on = getGlass()) { document.documentElement.dataset.glass = on ? 'on' : 'off'; }
export function setGlass(on) { localStorage.setItem(GLASS_KEY, on ? '1' : '0'); applyGlass(on); }

export function initTheme() {
  applyTheme();
  applyGlass();
  try { mq().addEventListener('change', () => { if (getThemeMode() === 'system') applyTheme('system'); }); } catch { /* older browsers */ }
}
