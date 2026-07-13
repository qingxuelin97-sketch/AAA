// Performance controller — adapts the UI's visual richness to the device.
//
// Heavy chrome (backdrop blur, endless decorative animations, large drop
// shadows) looks great on a desktop GPU but tanks battery and frame-rate on
// phones and low-end laptops. We expose a single `data-perf` flag on <html>
// that CSS keys off to strip the most GPU-bound effects. The mode is resolved
// from a saved user preference ('auto' | 'high' | 'lite'); in 'auto' we probe
// the hardware and pick the cheaper path on weak devices. Applied before React
// mounts so there's no flash of the expensive layout.
import { isAppMode } from './appmode.js';

const KEY = 'huanyu_perf';
// 会话级自适应降级标记（不落盘：下次冷启动仍是满血 auto，见 initAdaptivePerf）。
const DEGRADED_KEY = 'huanyu_perf_degraded';

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
    if (mem && mem <= 3) return true;
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
  // 自适应降级（initAdaptivePerf 检出持续严重掉帧）只影响本会话，同样只在
  // auto 档生效 —— 用户手选 high/lite 永远说了算。
  try { if (sessionStorage.getItem(DEGRADED_KEY)) return 'lite'; } catch { /* */ }
  // Native WebViews pay a higher price for backdrop sampling and many
  // independently composited animations. Auto starts in a static,
  // dimensional tier; full effects remain available as an explicit choice.
  if (isAppMode()) return deviceIsWeak() ? 'lite' : 'balanced';
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
  // 用户显式表态即清掉本会话的自适应降级 —— 手动选择永远优先。
  try { sessionStorage.removeItem(DEGRADED_KEY); } catch { /* */ }
  return applyPerf(pref);
}

// True when the resulting mode is the cheap one — JS-side effects (observers,
// per-frame work) can consult this to bow out entirely.
export function isLite() { return document.documentElement.dataset.perf === 'lite'; }

// 运行时自适应降级器（仅 APP 壳 + auto 档 + 当前满血时启动）。
// 用 Long Animation Frames 被动观测 —— 绝不跑常驻 rAF 循环（rAF 本身会强制
// 满帧渲染费电）。连续 3 个 10s 窗口 LoAF 时长占比 >35%（持续严重掉帧，而非
// 偶发卡顿）才触发：打会话级标记 → 降到 lite（复用全部既有降级规则）→ 发
// huanyu-perf-degraded 事件（AppLayout 展示可关闭提示）。产品决策不破坏：
// 默认满血不变、只在严重掉帧时降、不落盘、用户手选可即刻覆盖。
export function initAdaptivePerf() {
  if (!isAppMode() || getPerfPref() !== 'auto' || resolvePerf() === 'lite') return;
  if (typeof PerformanceObserver === 'undefined'
    || !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return;
  let loafMs = 0;
  let badWindows = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) loafMs += e.duration;
  });
  try { obs.observe({ type: 'long-animation-frame' }); } catch { return; }
  const iv = setInterval(() => {
    // 后台窗口不计（动画已被 data-page-hidden 挂起，数据无意义）
    if (document.hidden) { loafMs = 0; badWindows = 0; return; }
    const ratio = loafMs / 10000;
    loafMs = 0;
    if (ratio > 0.35) badWindows++; else badWindows = 0;
    if (badWindows >= 3) {
      clearInterval(iv);
      obs.disconnect();
      try { sessionStorage.setItem(DEGRADED_KEY, '1'); } catch { /* */ }
      applyPerf();
      try { window.dispatchEvent(new Event('huanyu-perf-degraded')); } catch { /* */ }
    }
  }, 10000);
}

export function initPerf() {
  applyPerf();
  initAdaptivePerf();
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
