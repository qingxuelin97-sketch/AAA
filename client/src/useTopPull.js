// useTopPull — APP 原生壳「顶部下拉唤出通知抽屉」手势。
// ----------------------------------------------------------------------------
// 与 appgestures.js 的 PTR（下拉刷新）错开：PTR 起手在内容区（main 内任意位置），
// 本手势起手必须在屏幕顶部 24px + safeAreaTop 内（状态栏区域）。原生壳有状态栏，
// 顶部区域天然适合放「下拉看通知」这种系统级手势。
//
// 仅监听 touch（移动端原生手势），鼠标不响应。enabled=false 时完全 no-op
// （抽屉已展开时禁用，避免重复触发）。
import { useEffect } from 'react';
import { isAppMode } from './appmode.js';

const TOP_ZONE = 24;             // 起手 Y 容差（px，状态栏下沿以下 24px 内算命中）
const MIN_PULL = 8;              // 小于 8px 的抖动忽略（防误触）
const VEL_SNAP_FULL = 0.6;       // 快速下拉 >0.6 px/ms → 直接全展开

function safeAreaTop() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--app-sat') || '';
    const n = parseFloat(v);
    if (isFinite(n) && n > 0) return n;
  } catch { /* */ }
  // env(safe-area-inset-top) 无法同步读，回退到 0；状态栏覆盖区由原生壳 CSS 已避让。
  return 0;
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled  是否启用手势（抽屉展开时建议 false）
 * @param {(dy:number)=>void} opts.onPull  拖动中实时回调（dy=下拉像素，正值向下）
 * @param {(dy:number, vel:number)=>void} opts.onEnd  松手回调，由调用方决定吸附档
 */
export function useTopPull({ enabled = true, onPull, onEnd }) {
  useEffect(() => {
    if (!enabled || !isAppMode()) return;
    const onPullRef = { current: onPull };
    const onEndRef = { current: onEnd };
    onPullRef.current = onPull;
    onEndRef.current = onEnd;

    let startY = 0;
    let startT = 0;
    let active = false;
    let lastY = 0;
    let lastT = 0;
    let prevY = 0;
    let prevT = 0;
    let raf = 0;
    let pendingDy = 0;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const zone = TOP_ZONE + safeAreaTop();
      if (t.clientY > zone) return; // 起手不在顶部带 → 不接管
      active = true;
      startY = t.clientY;
      startT = lastT = prevT = Date.now();
      lastY = prevY = t.clientY;
    };

    const onTouchMove = (e) => {
      if (!active) return;
      const t = e.touches[0];
      const dy = t.clientY - startY;
      if (dy < MIN_PULL) return;
      // 拦截默认滚动（避免同时把页面往下拉）
      if (e.cancelable && dy > 4) e.preventDefault();
      pendingDy = dy;
      prevY = lastY; prevT = lastT;
      lastY = t.clientY;
      lastT = Date.now();
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          onPullRef.current?.(pendingDy);
        });
      }
    };

    const onTouchEnd = () => {
      if (!active) return;
      active = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const dy = lastY - startY;
      // 末段速度：用最后一次 move 的位移 / 时间。dt<=1 视为无速度信号（防除零）。
      const segDy = lastY - prevY;
      const segDt = lastT - prevT;
      const vel = segDt > 1 ? segDy / segDt : 0;
      onEndRef.current?.(dy, vel);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled]);
}
