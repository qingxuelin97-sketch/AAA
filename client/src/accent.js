// Six persisted accent palettes. An unset App shell uses the frozen IX action
// authority; ordinary Web keeps the established clay default.

const KEY = 'huanyu_accent';

// c / name 是 **Web 壳**的展示值；appC / appName 是 App 壳的。
// 两壳的令牌在 DOM 上互斥，同一个 id 落到的颜色本来就不同 —— 设置页此前只画
// c，于是 App 用户看到的色点全是假的：最刺眼的是 clay，点是黏土橙 #d97757，
// 选中后整个 App 是青蓝 #0B72B0（clay 在 App 里不写 data-accent，直接落到
// app-rainbow.css:40 的品牌青）。其余五色的点也用着 Web 的值。
// appC 一律取 App 实际生效的 --ix-act（app-ix-accents.css:11-15 的浅色块）。
export const ACCENTS = [
  { id: 'clay', name: '黏土橙', c: '#d97757', appName: '幻域青', appC: '#0B72B0' },
  { id: 'dusk', name: '暮霭紫', c: '#7c5cbf', appC: '#5C50B4' },
  { id: 'teal', name: '松石青', c: '#2f8f9d', appC: '#0E6E93' },
  { id: 'forest', name: '苔原绿', c: '#5c8a63', appC: '#3E7C33' },
  { id: 'rose', name: '蔷薇红', c: '#c25573', appC: '#A83262' },
  { id: 'amber', name: '琥珀金', c: '#b3892f', appC: '#8A5A12' },
];

// 设置页的色点按壳取值 —— 别让色点说谎。
export function accentSwatch(a, isApp) {
  return isApp
    ? { c: a.appC || a.c, name: a.appName || a.name }
    : { c: a.c, name: a.name };
}

export function getAccent() {
  const v = localStorage.getItem(KEY);
  if (ACCENTS.some(a => a.id === v)) return v;
  // An unset data-accent keeps each shell's own baseline. Explicit persisted
  // ids are mapped by the App-fenced IX accent companion without changing Web.
  return 'clay';
}

export function applyAccent(id = getAccent()) {
  // The default writes no attribute; each shell retains its own CSS baseline.
  if (id === 'clay') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = id;
  try { window.dispatchEvent(new Event('huanyu-accent')); } catch { /* */ }
}

export function setAccent(id) {
  localStorage.setItem(KEY, id);
  applyAccent(id);
}

export function initAccent() { applyAccent(); }
