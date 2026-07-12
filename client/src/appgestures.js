// Touch gestures for the native app shell (AppLayout) — swipe between top tabs,
// pull-to-refresh, and left-edge swipe-back. Attached to the scrolling content
// element. No-ops gracefully on desktop/no-touch. Kept framework-light: a single
// pointer-tracking effect, callbacks read from a ref so listeners bind once.
import { useEffect, useRef } from 'react';

// Light haptic tick where supported (Android web / native vibrate); silent on iOS.
export function tick(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* */ } }

// Elements that own horizontal scrolling / their own touch semantics — swiping
// inside them must NOT trigger tab navigation.
const NO_SWIPE = '.ah-rail, .chat-scroll, .chat-input-bar, input, textarea, [data-noswipe], .app-launcher, .app-sheet, .sp-stage, .feed-root';

export function useAppGestures(scrollRef, handlers) {
  const cb = useRef(handlers);
  cb.current = handlers;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return undefined;

    let sx = 0, sy = 0, tracking = false, mode = '', fromEdge = false, pull = 0;
    // 非 passive 的 touchmove 只在「本次手势可能变成下拉刷新」（起手时已在页顶）
    // 时临时挂上、touchend 即摘。曾经常驻 { passive: false } —— 全 APP 每一次
    // 滚动的每一帧合成器都要停下来等主线程跑完监听器才敢滚，主线程一忙
    // （玻璃模糊 + React 提交）滚动就整段掉帧。摘掉后日常滚动全程 passive，
    // 合成器自由滚，只有页顶下拉这一种手势付阻塞成本。
    let pullBound = false;
    // 下拉距离回调按 rAF 节流：touchmove 触发频率可高于刷新率（120Hz 屏 /
    // 多次采样），每次都 setState 会放大 React 提交压力。
    let raf = 0;
    const emitPull = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; cb.current.onPullMove?.(pull); });
    };

    // 方向判定（h=横滑 / pull=页顶下拉 / v=普通纵滑），两个 move 监听共用。
    const detect = (dx, dy) => {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.4) mode = 'h';
      else if (dy > 0 && (window.scrollY || document.documentElement.scrollTop || 0) <= 0) mode = 'pull';
      else mode = 'v';
    };
    const onMovePassive = (e) => {
      if (!tracking || pullBound || mode) return;
      const t = e.touches[0];
      detect(t.clientX - sx, t.clientY - sy);
    };
    const onMovePull = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (!mode) detect(dx, dy);
      if (mode === 'pull') {
        pull = Math.min(120, dy * 0.55);
        if (pull > 0) { if (e.cancelable) e.preventDefault(); emitPull(); }
      }
    };
    const unbindPull = () => {
      if (!pullBound) return;
      pullBound = false;
      el.removeEventListener('touchmove', onMovePull);
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; unbindPull(); return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; mode = ''; pull = 0;
      fromEdge = sx <= 24;
      tracking = !e.target.closest?.(NO_SWIPE);
      const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
      if (tracking && atTop && !pullBound) {
        pullBound = true;
        el.addEventListener('touchmove', onMovePull, { passive: false });
      } else if (pullBound && (!tracking || !atTop)) {
        unbindPull();
      }
    };
    const onEnd = (e) => {
      unbindPull();
      if (!tracking) return; tracking = false;
      const t = (e.changedTouches && e.changedTouches[0]) || {};
      const dx = (t.clientX || 0) - sx, dy = (t.clientY || 0) - sy;
      if (mode === 'pull') { cancelAnimationFrame(raf); raf = 0; cb.current.onPullEnd?.(pull > 66); return; }
      if (mode === 'h' && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) cb.current.onNext?.();
        else if (fromEdge) cb.current.onBack?.();
        else cb.current.onPrev?.();
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMovePassive, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      unbindPull();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMovePassive);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef]);
}
