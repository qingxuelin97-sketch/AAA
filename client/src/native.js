// Native (Capacitor) integration — loaded ONLY inside the native app shell, never on web.
// Wires the hardware back button, status-bar theming and splash-screen dismissal.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { resolveTheme } from './theme.js';
import { preparePlayIntegrity } from './playIntegrity.js';

// 页面语境覆盖：沉浸页（深色聊天/剧场等）可临时把状态栏刷成自己的底色，
// 否则 App 浅色主题下状态栏恒为奶白，压在深色聊天页顶部就是一条刺眼的白带
// （overlaysWebView:false 时状态栏是 WebView 之上的一条实心原生条）。
// 页面通过 window 事件声明/撤销语境：
//   dispatchEvent(new CustomEvent('huanyu-statusbar', { detail: { color: '#100d16', dark: true } }))
//   dispatchEvent(new CustomEvent('huanyu-statusbar', { detail: null }))  // 恢复主题默认
let ctxOverride = null;
let initialized = false;
let nativeBackHandler = null;

export async function syncStatusBar() {
  try {
    if (ctxOverride) {
      // dark=true 表示深色底 → 需要浅色图标（Style.Dark named for background）
      await StatusBar.setStyle({ style: ctxOverride.dark ? Style.Dark : Style.Light });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: ctxOverride.color });
      }
      return;
    }
    const dark = resolveTheme() === 'dark';
    // Style.Dark = dark background w/ light icons; Style.Light = light background w/ dark icons.
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    if (Capacitor.getPlatform() === 'android') {
      // Native system chrome follows the IX App canvas; Web keeps its own palette.
      await StatusBar.setBackgroundColor({ color: dark ? '#0F1312' : '#E4F1F6' });
    }
  } catch { /* plugin not available */ }
}

export async function initNative() {
  // Warm the standard-token provider before the registration screen needs it.
  // Failure is intentionally non-fatal: invited/whitelisted users remain able
  // to register, while the backend still refuses an unverified public signup.
  await preparePlayIntegrity().catch(() => false);
  // 设备标识（Android = ANDROID_ID，iOS = identifierForVendor）：挂到全局供
  // api.jsx 附加 X-Device-Id 头，服务端用于注册配额（限单设备开小号）。
  // 本文件只在原生壳加载（main.jsx 动态 import），Web 端永远不带此头。
  // 取值失败静默跳过 —— 服务端对缺失设备头不硬拒（Web 壳本来就没有）。
  try {
    const { identifier } = await Device.getId();
    if (identifier) window.__HY_DEVICE_ID = String(identifier).slice(0, 64);
  } catch { /* plugin not available */ }
  try {
    // Android 15+ is edge-to-edge by default. App-only safe-area tokens keep
    // interactive controls outside the system bars.
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch { /* older plugin / platform */ }
  await syncStatusBar();
  if (initialized) return;
  initialized = true;
  // The Router-aware AppNavProvider owns the back ordering. Native glue exits
  // only when the provider declines the second root press.
  try {
    App.addListener('backButton', async () => {
      let handled = false;
      try { handled = (await nativeBackHandler?.()) === true; } catch { handled = true; }
      if (!handled) App.exitApp();
    });
  } catch { /* */ }
  // Re-apply status bar when the app resumes or the user toggles the theme.
  try { App.addListener('resume', syncStatusBar); } catch { /* */ }
  const keyboardOn = (info = {}) => {
    document.documentElement.dataset.keyboard = '1';
    document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, Number(info.keyboardHeight) || 0)}px`);
  };
  const keyboardOff = () => {
    delete document.documentElement.dataset.keyboard;
    document.documentElement.style.removeProperty('--keyboard-height');
  };
  try {
    Keyboard.addListener('keyboardWillShow', keyboardOn);
    Keyboard.addListener('keyboardDidShow', keyboardOn);
    Keyboard.addListener('keyboardWillHide', keyboardOff);
    Keyboard.addListener('keyboardDidHide', keyboardOff);
  } catch { /* */ }
  window.addEventListener('huanyu-theme', syncStatusBar);
  window.addEventListener('huanyu-statusbar', (e) => { ctxOverride = e.detail || null; syncStatusBar(); });
}

export function setNativeBackHandler(handler) {
  nativeBackHandler = typeof handler === 'function' ? handler : null;
  return () => { if (nativeBackHandler === handler) nativeBackHandler = null; };
}

export async function dismissNativeKeyboard() {
  try { await Keyboard.hide(); } catch { /* plugin not available */ }
  finally {
    delete document.documentElement.dataset.keyboard;
    document.documentElement.style.removeProperty('--keyboard-height');
  }
}

export async function hideNativeSplash() {
  try { await SplashScreen.hide(); } catch { /* plugin not available */ }
}
