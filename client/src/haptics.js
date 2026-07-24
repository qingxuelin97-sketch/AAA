// haptics — APP 原生壳语义化触觉反馈模式库。
// ----------------------------------------------------------------------------
// 把 appgestures.js 里单一的 tick(8) 升级为有层级的语义触觉：
//   tap / confirm / bump   —— impact（轻 / 中 / 重）
//   select                —— 选择变化（分段控件 / 拖拽排序）
//   success / warn / error —— notification（成功 / 警告 / 失败）
//
// 平台分流：
//   · 原生壳（isNativeShell）：动态 import('@capacitor/haptics')，用原生触觉引擎
//     （iOS Taptic Engine、安卓系统震动）。web 端永远不 import 此包。
//   · web 安卓：navigator.vibrate(pattern) 数组（success/warn/error 各有节奏）。
//   · iOS web / 不支持 vibrate：静默 no-op（iOS Safari 永远不支持 Web Vibration）。
//
// 节流：同类触觉 80ms 内只触发一次，防快速连点连震。
// 门控：data-perf="lite" 或 prefers-reduced-motion 时全部 no-op。
import { isNativeShell } from './appmode.js';

// 原生 Haptics 插件懒加载：首次调用时 import，之后缓存。失败静默（降级到 web vibrate）。
let nativeHaptics = null;
let nativeHapticsTried = false;
async function ensureNative() {
  if (nativeHapticsTried) return nativeHaptics;
  nativeHapticsTried = true;
  if (!isNativeShell()) return null;
  try {
    const m = await import('@capacitor/haptics');
    nativeHaptics = m;
  } catch { /* plugin missing — fall back to web vibrate */ }
  return nativeHaptics;
}

// 预热：native.js initNative() 末尾调用，让首次触觉不必等动态 import。
export function prepareHaptics() { ensureNative(); }

// —— 门控 ——
function gated() {
  if (typeof document !== 'undefined' && document.documentElement.dataset.perf === 'lite') return true;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  return false;
}

// —— 节流：同类 80ms 内只发一次 ——
const lastFire = {};
function throttle(key) {
  const now = Date.now();
  if (lastFire[key] && now - lastFire[key] < 80) return false;
  lastFire[key] = now;
  return true;
}

// —— web vibrate 节奏（安卓 web / 非 native 壳降级用）——
// 数组语义：[静默ms, 震动ms, 静默ms, 震动ms, ...]
const VIBE = {
  tap:      [8],
  confirm:  [14],
  bump:     [24],
  select:   [6],
  success:  [0, 10, 40, 14],
  warn:     [0, 20, 30, 20],
  error:    [0, 30, 60, 30, 60, 30],
};
function webVibrate(key) {
  try {
    const pat = VIBE[key];
    if (pat && navigator.vibrate) navigator.vibrate(pat);
  } catch { /* no-op */ }
}

// —— impact（轻/中/重）——
// Capacitor ImpactStyle: Light=1, Medium=2, Heavy=3, Rigid=4, Soft=5
function impact(style, key) {
  if (gated() || !throttle(key)) return;
  const m = nativeHaptics;
  if (m) {
    try { m.Haptics.impact({ style }); return; } catch { /* */ }
  }
  webVibrate(key);
}

// —— notification（成功/警告/错误）——
// Capacitor NotificationType: Success=1, Warning=2, Error=3
function notify(type, key) {
  if (gated() || !throttle(key)) return;
  const m = nativeHaptics;
  if (m) {
    try { m.Haptics.notification({ type }); return; } catch { /* */ }
  }
  webVibrate(key);
}

// —— selection（选择变化，start/End 包裹一段连续选择）——
let selecting = false;
function selection() {
  if (gated() || !throttle('select')) return;
  const m = nativeHaptics;
  if (m) {
    try { m.Haptics.selectionStart?.(); selecting = true; return; } catch { /* */ }
  }
  webVibrate('select');
}
function selectionEnd() {
  if (!selecting) return;
  selecting = false;
  const m = nativeHaptics;
  if (m) { try { m.Haptics.selectionEnd?.(); } catch { /* */ } }
}

export const haptic = {
  tap:     () => impact(1, 'tap'),       // Light —— 轻点 tab / 按钮
  confirm: () => impact(2, 'confirm'),   // Medium —— 确认（签到 / 收藏）
  bump:    () => impact(3, 'bump'),      // Heavy —— 重磅（删除 / 危险操作）
  select:  () => selection(),            // 选择变化（分段控件 / 拖拽）
  selectEnd: () => selectionEnd(),
  success: () => notify(1, 'success'),   // Success —— 发送成功 / 支付成功
  warn:    () => notify(2, 'warn'),      // Warning —— 错误重试 / 网络断
  error:   () => notify(3, 'error'),     // Error —— 发送失败 / 支付失败
};

// 兼容旧调用：appgestures.js 仍导出 tick(8)。新代码用 haptic.tap()。
// 旧 import { tick } 不破坏。
