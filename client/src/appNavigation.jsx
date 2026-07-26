import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isAppMode, isNativeShell } from './appmode.js';
import { DEFAULT_APP_TAB, getAppRoute } from './routeRegistry.js';
import { useOverlayStack } from './overlay.jsx';

const AppNavigationContext = createContext(null);
const EXIT_WINDOW_MS = 2000;

export function isEditableTarget(node) {
  if (!node || (typeof document !== 'undefined' && node === document.body)) return false;
  if (node.disabled || node.readOnly) return false;
  return !!node.matches?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

export function AppNavProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const overlays = useOverlayStack();
  const dirtyEntries = useRef(new Map());
  const lastRootBack = useRef(0);
  const [exitHint, setExitHint] = useState(false);
  const hintTimer = useRef(null);
  const requestBackRef = useRef(null);

  const registerDirty = useCallback((id, entry) => {
    dirtyEntries.current.set(id, entry);
    return () => dirtyEntries.current.delete(id);
  }, []);

  const dismissInput = useCallback(() => {
    const active = document.activeElement;
    const editable = isEditableTarget(active);
    const keyboardOpen = document.documentElement.dataset.keyboard === '1';
    if (!editable && !keyboardOpen) return false;
    if (editable) active.blur?.();
    if (isNativeShell()) import('./native.js').then((m) => m.dismissNativeKeyboard?.()).catch(() => {});
    return true;
  }, []);

  const confirmDirty = useCallback(() => {
    const entries = [...dirtyEntries.current.values()].reverse();
    const dirty = entries.find((entry) => {
      try { return entry.isDirty?.(); } catch { return false; }
    });
    if (!dirty) return true;
    return window.confirm(dirty.message || '有尚未保存的内容，确定离开吗？');
  }, []);

  // All App navigation funnels through this synchronous guard before a route
  // transition starts. Keeping the prompt outside View Transitions prevents a
  // cancelled confirmation from leaving a frozen route snapshot behind.
  const confirmNavigation = useCallback(() => confirmDirty(), [confirmDirty]);
  const requestNavigate = useCallback((to, options) => {
    if (!confirmNavigation()) return false;
    navigate(to, options);
    return true;
  }, [confirmNavigation, navigate]);

  const requestBack = useCallback(async ({ source = 'app' } = {}) => {
    if (overlays?.closeTop?.()) return true;
    if (dismissInput()) return true;
    if (!confirmNavigation()) return true;

    const route = getAppRoute(location.pathname);
    const contextualParent = location.state?.appBackTo;
    if (typeof contextualParent === 'string' && contextualParent.startsWith('/') && contextualParent !== location.pathname) {
      navigate(contextualParent, { replace: true, state: { appNavDir: 'pop' } });
      return true;
    }
    if (route.parent) {
      navigate(route.parent, { replace: true, state: { appNavDir: 'pop' } });
      return true;
    }
    if (route.tab !== null && location.pathname !== DEFAULT_APP_TAB) {
      navigate(DEFAULT_APP_TAB, { replace: true, state: { appNavDir: 'pop' } });
      return true;
    }

    // Only a second hardware press exits. Browser preview and edge gestures
    // consume the event at the root instead of trying to close the tab.
    if (source !== 'hardware') return true;
    const now = Date.now();
    if (now - lastRootBack.current <= EXIT_WINDOW_MS) return false;
    lastRootBack.current = now;
    setExitHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setExitHint(false), EXIT_WINDOW_MS);
    return true;
  }, [confirmNavigation, dismissInput, location.pathname, location.state, navigate, overlays]);
  requestBackRef.current = requestBack;

  useEffect(() => {
    if (!isNativeShell()) return undefined;
    let unset;
    let disposed = false;
    import('./native.js').then(({ setNativeBackHandler }) => {
      if (disposed) return;
      unset = setNativeBackHandler?.(() => requestBackRef.current?.({ source: 'hardware' }));
    }).catch(() => {});
    return () => { disposed = true; unset?.(); };
  }, []);

  useEffect(() => () => clearTimeout(hintTimer.current), []);
  useEffect(() => {
    lastRootBack.current = 0;
    setExitHint(false);
    clearTimeout(hintTimer.current);
  }, [location.pathname]);

  const route = useMemo(() => getAppRoute(location.pathname), [location.pathname]);
  const value = useMemo(
    () => ({ route, requestBack, requestNavigate, confirmNavigation, registerDirty }),
    [route, requestBack, requestNavigate, confirmNavigation, registerDirty],
  );
  return (
    <AppNavigationContext.Provider value={value}>
      {children}
      {exitHint && <div className="app-exit-hint" role="status">再按一次返回键退出</div>}
    </AppNavigationContext.Provider>
  );
}

export function useAppNavigation() {
  const value = useContext(AppNavigationContext);
  if (!value) throw new Error('useAppNavigation must be used inside AppNavProvider');
  return value;
}

export function useAppNavigationOptional() {
  return useContext(AppNavigationContext);
}

export function useUnsavedChanges(isDirty, message = '有尚未保存的内容，确定离开吗？') {
  const enabled = isAppMode();
  const navigation = useContext(AppNavigationContext);
  const dirtyRef = useRef(!!isDirty);
  const messageRef = useRef(message);
  const idRef = useRef(`dirty-${Date.now()}-${Math.random()}`);
  dirtyRef.current = !!isDirty;
  messageRef.current = message;

  useEffect(() => enabled ? navigation?.registerDirty(idRef.current, {
    isDirty: () => dirtyRef.current,
    get message() { return messageRef.current; },
  }) : undefined, [enabled, navigation]);

  useEffect(() => {
    if (!enabled || !isDirty) return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [enabled, isDirty]);

  // Saving and route navigation often happen in the same async continuation.
  // React has not necessarily rendered the new `isDirty=false` value before
  // navigate() runs, so callers need a synchronous way to clear the guard.
  return useCallback(() => { dirtyRef.current = false; }, []);
}

// Tracks form objects by identity instead of serialising a potentially huge
// worldbook on every keystroke. Loaders call markClean(next) with the exact
// object they install; subsequent immutable form updates become dirty. A
// successful save clears both React state and the synchronous navigation ref.
export function useUnsavedValue(value, ready, message) {
  const cleanValueRef = useRef(value);
  const currentValueRef = useRef(value);
  const [dirty, setDirty] = useState(false);
  currentValueRef.current = value;
  const clearNavigationGuard = useUnsavedChanges(ready && dirty, message);

  useEffect(() => {
    if (ready && value !== cleanValueRef.current) setDirty(true);
  }, [ready, value]);

  return useCallback((nextValue = currentValueRef.current) => {
    cleanValueRef.current = nextValue;
    setDirty(false);
    clearNavigationGuard();
  }, [clearNavigationGuard]);
}
