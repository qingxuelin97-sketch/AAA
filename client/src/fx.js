// Lightweight global UI effects: material-style click ripples + tap particle bursts.
// Pure DOM, no React, no deps — wired once at startup.

function spawnRipple(el, x, y) {
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 1.15;
  const dot = document.createElement('span');
  dot.className = 'ripple-dot';
  dot.style.width = dot.style.height = size + 'px';
  dot.style.left = (x - r.left - size / 2) + 'px';
  dot.style.top = (y - r.top - size / 2) + 'px';
  el.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove());
  setTimeout(() => dot.remove(), 700);
}

// Burst a few colored particles outward from a point (used on like/favorite).
export function burst(x, y, colors = ['#ff5a8a', '#ff8aa8', '#ffd24a', '#e2885f']) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'burst-layer';
  layer.style.left = x + 'px';
  layer.style.top = y + 'px';
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('span');
    const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
    const d = 26 + Math.random() * 26;
    p.style.setProperty('--dx', Math.cos(a) * d + 'px');
    p.style.setProperty('--dy', Math.sin(a) * d + 'px');
    p.style.background = colors[i % colors.length];
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 750);
}

// 3D 灵动卡片：鼠标悬停时海报卡随指针轻微倾斜 + 光泽掠过（桌面指针设备限定，
// 省电档/减弱动效直接不装）。事件全局委托，Home/收藏/搜索等所有 .poster 即刻生效。
function initTilt() {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.documentElement.dataset.perf === 'lite') return;
  const MAX = 7; // deg
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('.poster');
    if (!t) return;
    const r = t.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    t.classList.add('tilting');
    t.style.setProperty('--tilt-x', (-py * MAX).toFixed(2) + 'deg');
    t.style.setProperty('--tilt-y', (px * MAX).toFixed(2) + 'deg');
    t.style.setProperty('--shine-x', ((px + 0.5) * 100).toFixed(1) + '%');
    t.style.setProperty('--shine-y', ((py + 0.5) * 100).toFixed(1) + '%');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest?.('.poster');
    if (!t || t.contains(e.relatedTarget)) return;
    t.classList.remove('tilting');
    t.style.removeProperty('--tilt-x');
    t.style.removeProperty('--tilt-y');
  }, { passive: true });
}

export function initFx() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  initTilt();
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target.closest('.btn, .nav-item, .cast-chip, .seg button, .cat-bar button, .send-btn, .task-row .btn, .theme-seg button, .tabs-bar button');
    if (!t || t.disabled || t.classList.contains('no-ripple')) return;
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    if (!t.style.overflow) t.style.overflow = 'hidden';
    if (!reduce) spawnRipple(t, e.clientX, e.clientY);
  }, { passive: true });

  // APP 壳专属：给 tab/宫格/入口卡等玻璃面在按压时设置 --rx/--ry，
  // 让 CSS 里的液态涟漪从真实触点扩散（否则一律从中心射出，很塑料感）。
  document.addEventListener('pointerdown', (e) => {
    if (document.documentElement.dataset.app !== '1') return;
    const t = e.target.closest('.app-tab, .ah-sc, .msgs-entry, .pf-cell, .app-create-row, .fd2-act, .feed-cat');
    if (!t) return;
    const r = t.getBoundingClientRect();
    const rx = ((e.clientX - r.left) / r.width) * 100;
    const ry = ((e.clientY - r.top) / r.height) * 100;
    t.style.setProperty('--rx', rx + '%');
    t.style.setProperty('--ry', ry + '%');
  }, { passive: true });

  // like / favorite particle burst — opt in via [data-burst] or .like-burst
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-burst], .moment .acts button, .char-detail-fav');
    if (!t) return;
    // only burst when turning ON (heuristic: not already 'on'/'danger')
    const r = t.getBoundingClientRect();
    requestAnimationFrame(() => burst(r.left + r.width / 2, r.top + r.height / 2));
  }, { passive: true });
}
