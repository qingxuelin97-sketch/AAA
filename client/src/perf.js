// Performance controller — adapts the UI's visual richness to the device.
//
// Heavy chrome (backdrop blur, endless decorative animations, large drop
// shadows) looks great on a desktop GPU but tanks battery and frame-rate on
// phones and low-end laptops. We expose a single `data-perf` flag on <html>
// that CSS keys off to strip the most GPU-bound effects. The mode is resolved
// from a saved user preference ('auto' | 'high' | 'lite'); in 'auto' we probe
// the hardware and pick the cheaper path on weak devices. Applied before React
// mounts so there's no flash of the expensive layout.
const KEY = 'huanyu_perf';

export function getPerfPref() {
  const v = localStorage.getItem(KEY);
  return v === 'high' || v === 'lite' ? v : 'auto';
}

// Heuristic: is this a device that will struggle with blur + perpetual motion?
// We weigh CPU cores, RAM, the user's data-saver flag and a coarse pointer
// (touch). Any strong low-end signal flips us to the lite path.
function deviceIsWeak() {
  try {
    const nav = navigator;
    if (nav.connection?.saveData) return true;                 // user asked to save data
    const cores = nav.hardwareConcurrency || 0;
    const mem = nav.deviceMemory || 0;                         // GiB, Chrome-only
    if (cores && cores <= 4) return true;
    if (mem && mem <= 4) return true;
    // Touch primary + small viewport ⇒ treat as a phone unless it's clearly
    // a beefy machine (already returned false above on high core/mem).
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
    if (coarse && small) return true;
  } catch { /* very old browser — assume capable */ }
  return false;
}

export function resolvePerf(pref = getPerfPref()) {
  if (pref === 'high') return 'high';
  if (pref === 'lite') return 'lite';
  // auto = 最高画质。旧启发式把「触屏+小屏」一律判为低端机 → 几乎所有手机
  // 都被降到 lite（毛玻璃/动效全关，观感大打折扣）。产品决策改为：默认满血，
  // 需要省电的用户在设置里手动切「省电模式」。deviceIsWeak 仅保留给显式
  // 数据节省（saveData）场景兜底。
  return navigator.connection?.saveData ? 'lite' : 'high';
}

export function applyPerf(pref = getPerfPref()) {
  const mode = resolvePerf(pref);
  document.documentElement.dataset.perf = mode;
  try { window.dispatchEvent(new Event('huanyu-perf')); } catch { /* */ }
  return mode;
}

export function setPerfPref(pref) {
  localStorage.setItem(KEY, pref);
  return applyPerf(pref);
}

// True when the resulting mode is the cheap one — JS-side effects (observers,
// per-frame work) can consult this to bow out entirely.
export function isLite() { return document.documentElement.dataset.perf === 'lite'; }

export function initPerf() {
  applyPerf();
  // In 'auto', re-evaluate if the data-saver preference changes mid-session.
  try {
    navigator.connection?.addEventListener?.('change', () => {
      if (getPerfPref() === 'auto') applyPerf('auto');
    });
  } catch { /* */ }
  // Pause every CSS animation while the tab is hidden (styles.css keys off
  // [data-page-hidden]). Ambient loops otherwise keep the compositor busy in
  // background tabs; resuming on return is instant and invisible to the user.
  try {
    const sync = () => {
      if (document.hidden) document.documentElement.dataset.pageHidden = '';
      else delete document.documentElement.dataset.pageHidden;
    };
    document.addEventListener('visibilitychange', sync);
    sync();
  } catch { /* */ }
}
