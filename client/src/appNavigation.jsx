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
    if (!isEditableTarget(active)) return false;
    active.blur?.();
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

  const requestBack = useCallback(async ({ source = 'app' } = {}) => {
    if (overlays?.closeTop?.()) return true;
    if (dismissInput()) return true;
    if (!confirmDirty()) return true;

    const route = getAppRoute(location.pathname);
    if (route.parent) {
      navigate(route.parent, { replace: false });
      return true;
    }
    if (route.tab !== null && location.pathname !== DEFAULT_APP_TAB) {
      navigate(DEFAULT_APP_TAB, { replace: false });
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
  }, [confirmDirty, dismissInput, location.pathname, navigate, overlays]);
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
  const value = useMemo(() => ({ route, requestBack, registerDirty }), [route, requestBack, registerDirty]);
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
}
