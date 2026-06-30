// Touch gestures for the native app shell (AppLayout) — swipe between top tabs,
// pull-to-refresh, and left-edge swipe-back. Attached to the scrolling content
// element. No-ops gracefully on desktop/no-touch. Kept framework-light: a single
// pointer-tracking effect, callbacks read from a ref so listeners bind once.
import { useEffect, useRef } from 'react';

// Light haptic tick where supported (Android web / native vibrate); silent on iOS.
export function tick(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* */ } }

// Elements that own horizontal scrolling / their own touch semantics — swiping
// inside them must NOT trigger tab navigation.
const NO_SWIPE = '.ah-rail, .chat-scroll, .chat-input-bar, input, textarea, [data-noswipe], .app-launcher, .app-sheet, .sp-stage, .app-feed-page';

export function useAppGestures(scrollRef, handlers) {
  const cb = useRef(handlers);
  cb.current = handlers;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return undefined;

    let sx = 0, sy = 0, tracking = false, mode = '', fromEdge = false, pull = 0;

    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; mode = ''; pull = 0;
      fromEdge = sx <= 24;
      tracking = !e.target.closest?.(NO_SWIPE);
    };
    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.4) mode = 'h';
        else if (dy > 0 && (window.scrollY || document.documentElement.scrollTop || 0) <= 0) mode = 'pull';
        else mode = 'v';
      }
      if (mode === 'pull') {
        pull = Math.min(120, dy * 0.55);
        if (pull > 0) { if (e.cancelable) e.preventDefault(); cb.current.onPullMove?.(pull); }
      }
    };
    const onEnd = (e) => {
      if (!tracking) return; tracking = false;
      const t = (e.changedTouches && e.changedTouches[0]) || {};
      const dx = (t.clientX || 0) - sx, dy = (t.clientY || 0) - sy;
      if (mode === 'pull') { cb.current.onPullEnd?.(pull > 66); return; }
      if (mode === 'h' && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) cb.current.onNext?.();
        else if (fromEdge) cb.current.onBack?.();
        else cb.current.onPrev?.();
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef]);
}
