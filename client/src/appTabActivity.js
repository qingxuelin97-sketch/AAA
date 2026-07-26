import { useEffect, useRef } from 'react';

const EVENT = 'huanyu-app-tab-active';

// KeepAlive preserves scroll and local state, but business data must still be
// revalidated when a top-level destination becomes visible again.
export function notifyAppTabActive(path) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { path } })); } catch { /* old WebView */ }
}

export function useAppTabActive(path, callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const onActive = (event) => {
      if (event.detail?.path === path) callbackRef.current?.();
    };
    window.addEventListener(EVENT, onActive);
    return () => window.removeEventListener(EVENT, onActive);
  }, [path]);
}
