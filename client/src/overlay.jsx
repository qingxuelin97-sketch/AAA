import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAppMode } from './appmode.js';

const OverlayContext = createContext(null);

export function OverlayProvider({ children }) {
  const [stack, setStack] = useState([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const register = useCallback((entry) => {
    const id = entry.id || `overlay-${Date.now()}-${Math.random()}`;
    setStack((current) => [...current.filter((item) => item.id !== id), { ...entry, id }]);
    return () => setStack((current) => current.filter((item) => item.id !== id));
  }, []);

  const closeTop = useCallback(() => {
    const current = stackRef.current;
    const top = current[current.length - 1];
    if (!top) return false;
    try { top.close?.(); } catch { /* a broken overlay must not break native back */ }
    return true;
  }, []);

  useEffect(() => {
    if (!stack.length) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = 'hidden';
    if (scrollbar) document.body.style.paddingRight = `${scrollbar}px`;

    const top = stack[stack.length - 1];
    const root = document.getElementById('root');
    const overlayRoot = top?.rootRef?.current;
    const isolate = !!(top?.isolate && root && overlayRoot && !root.contains(overlayRoot));
    const previousHidden = root?.getAttribute('aria-hidden');
    const previousInert = root?.inert;
    if (isolate) {
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (isolate && root) {
        root.inert = !!previousInert;
        if (previousHidden == null) root.removeAttribute('aria-hidden');
        else root.setAttribute('aria-hidden', previousHidden);
      }
    };
  }, [stack]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || !stack.length) return;
      event.preventDefault();
      event.stopPropagation();
      closeTop();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [closeTop, stack.length]);

  const value = useMemo(() => ({ register, closeTop }), [register, closeTop]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlayStack() {
  return useContext(OverlayContext);
}

// Registers an already-rendered overlay without mutating browser history.
// Focus is moved into it and restored to the launcher when the overlay closes.
export function useAppOverlay(open, onClose, { rootRef, isolate = false } = {}) {
  const enabled = isAppMode();
  const stack = useContext(OverlayContext);
  const register = stack?.register;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const idRef = useRef(`overlay-${Date.now()}-${Math.random()}`);

  useEffect(() => {
    if (!enabled || !open || !register) return undefined;
    const previousFocus = document.activeElement;
    const unregister = register({
      id: idRef.current,
      close: () => closeRef.current?.(),
      rootRef,
      isolate,
    });
    const raf = requestAnimationFrame(() => {
      const root = rootRef?.current;
      if (!root) return;
      const first = root.querySelector(
        '[autofocus], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first || root).focus?.({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      unregister();
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus?.({ preventScroll: true }));
    };
  }, [enabled, open, register, rootRef, isolate]);

  useEffect(() => {
    if (!enabled || !open || !rootRef?.current) return undefined;
    const root = rootRef.current;
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...root.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault(); root.focus?.(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', trap);
    return () => root.removeEventListener('keydown', trap);
  }, [enabled, open, rootRef]);

  return idRef.current;
}
