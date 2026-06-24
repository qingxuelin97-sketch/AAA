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

export function initFx() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target.closest('.btn, .nav-item, .cast-chip, .seg button, .cat-bar button, .send-btn, .task-row .btn, .theme-seg button, .tabs-bar button');
    if (!t || t.disabled || t.classList.contains('no-ripple')) return;
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    if (!t.style.overflow) t.style.overflow = 'hidden';
    if (!reduce) spawnRipple(t, e.clientX, e.clientY);
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
