// Six persisted accent palettes. An unset HTTP App-shell preview starts with
// Quiet Aqua; ordinary Web keeps the established clay default.
import { isAppMode } from './appmode.js';

const KEY = 'huanyu_accent';

export const ACCENTS = [
  { id: 'clay', name: '黏土橙', c: '#d97757' },
  { id: 'dusk', name: '暮霭紫', c: '#7c5cbf' },
  { id: 'teal', name: '松石青', c: '#2f8f9d' },
  { id: 'forest', name: '苔原绿', c: '#5c8a63' },
  { id: 'rose', name: '蔷薇红', c: '#c25573' },
  { id: 'amber', name: '琥珀金', c: '#b3892f' },
];

export function getAccent() {
  const v = localStorage.getItem(KEY);
  if (ACCENTS.some(a => a.id === v)) return v;
  return isAppMode() ? 'teal' : 'clay';
}

export function applyAccent(id = getAccent()) {
  // 默认色不落属性，CSS 基线即黏土橙；其余色靠 [data-accent=…] 覆盖变量。
  if (id === 'clay') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = id;
  try { window.dispatchEvent(new Event('huanyu-accent')); } catch { /* */ }
}

export function setAccent(id) {
  localStorage.setItem(KEY, id);
  applyAccent(id);
}

export function initAccent() { applyAccent(); }
