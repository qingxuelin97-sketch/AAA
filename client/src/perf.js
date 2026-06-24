// Performance tier detection.
//
// The full theme leans on GPU-heavy effects — many stacked `backdrop-filter`
// blurs, large blurred full-screen ambient layers, and ~40 always-running
// animations. On capable desktops that's fine; on phones and low-end machines
// it forces a full-screen recomposite every frame (even idle) and makes taps +
// scrolling stutter badly. "perf-lite" drops those costs (see the
// `html.perf-lite` rules in styles.css) while keeping the layout/colors intact.
//
// Auto-enabled for devices that visibly struggle; force either way with
// localStorage `huanyu_perf` = 'lite' | 'full'.

const KEY = 'huanyu_perf';

const mq = (q) => typeof window !== 'undefined' && window.matchMedia?.(q).matches;

export function prefersLite() {
  try {
    const forced = localStorage.getItem(KEY);
    if (forced === 'lite') return true;
    if (forced === 'full') return false;
  } catch { /* ignore */ }

  if (mq('(prefers-reduced-motion: reduce)')) return true;

  const nav = typeof navigator !== 'undefined' ? navigator : {};
  if (nav.connection?.saveData) return true;

  const mem = nav.deviceMemory;            // GB, Chromium only
  const cores = nav.hardwareConcurrency;   // logical cores
  const coarse = mq('(pointer: coarse)');  // touch device / phone

  // Touch devices universally choke on stacked blur — default them to lite.
  if (coarse) return true;
  // Low-end desktops too.
  if (mem && mem <= 4) return true;
  if (cores && cores <= 4) return true;
  return false;
}

let lite = false;
export const isLite = () => lite;

// Apply once, before first paint, so there's no heavy → light flash.
export function initPerf() {
  if (typeof document === 'undefined') return;
  lite = prefersLite();
  document.documentElement.classList.toggle('perf-lite', lite);
}

// Let users flip it at runtime (Settings can call this). Persists the choice.
export function setPerfMode(mode /* 'lite' | 'full' | 'auto' */) {
  try {
    if (mode === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch { /* ignore */ }
  initPerf();
}
