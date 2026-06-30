// App-mode controller — decides whether to render the dedicated *native app*
// shell (AppLayout: launcher home + raised create FAB + grid drawer) instead of
// the responsive web shell (Layout: sidebar / mobile top-bar + bottom nav).
//
// The two shells live side by side and never mix: web / mobile-web keep the
// original layout, the packaged Capacitor app gets a distinctly app-flavoured
// one. A dev preview switch (`?app=1` in the URL, persisted) lets us validate
// the app layout in a plain browser without an APK.

const KEY = 'huanyu_app';

// True only inside the packaged native shell (Capacitor Android / iOS).
export function isNativeShell() {
  try { return !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
}

// Whether to use the app shell at all: native always, or the persisted preview flag.
export function isAppMode() {
  if (isNativeShell()) return true;
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

// Resolve `?app=1` / `?app=0` once at boot (browser preview toggle) and stamp
// <html data-app> so CSS can branch before React mounts (no flash of web chrome).
export function initAppMode() {
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.has('app')) {
      const v = sp.get('app');
      if (v === '0' || v === 'off' || v === 'false') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '1');
    }
  } catch { /* no URL / storage */ }
  const on = isAppMode();
  document.documentElement.dataset.app = on ? '1' : '0';
  if (isNativeShell()) document.documentElement.dataset.native = '1';
  return on;
}
