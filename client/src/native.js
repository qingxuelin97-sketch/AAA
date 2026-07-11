// Native (Capacitor) integration — loaded ONLY inside the native app shell, never on web.
// Wires the hardware back button, status-bar theming and splash-screen dismissal.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { resolveTheme } from './theme.js';
import { appBack } from './nav.js';

// 页面语境覆盖：沉浸页（深色聊天/剧场等）可临时把状态栏刷成自己的底色，
// 否则 App 浅色主题下状态栏恒为奶白，压在深色聊天页顶部就是一条刺眼的白带
// （overlaysWebView:false 时状态栏是 WebView 之上的一条实心原生条）。
// 页面通过 window 事件声明/撤销语境：
//   dispatchEvent(new CustomEvent('huanyu-statusbar', { detail: { color: '#100d16', dark: true } }))
//   dispatchEvent(new CustomEvent('huanyu-statusbar', { detail: null }))  // 恢复主题默认
let ctxOverride = null;

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
      // App 浅色主题（白+青）底色对齐 --bg #eefbfd，而非旧 Web 奶白，避免与页面顶部形成色差。
      await StatusBar.setBackgroundColor({ color: dark ? '#0c0c0e' : '#eefbfd' });
    }
  } catch { /* plugin not available */ }
}

export async function initNative() {
  await syncStatusBar();
  // Android hardware back: 有历史则后退，否则退出 app。
  // 旧实现用 location.hash 判断根页，但 BrowserRouter 下 hash 恒空，
  // 导致只要不在首屏按返回键就直接退出 app，历史回退完全失效。
  try {
    App.addListener('backButton', () => {
      // appBack：带 pop 方向过渡的 history.back()（浮层哨兵在场时自动跳过过渡）。
      if (window.history.length > 1) appBack();
      else App.exitApp();
    });
  } catch { /* */ }
  // Re-apply status bar when the app resumes or the user toggles the theme.
  try { App.addListener('resume', syncStatusBar); } catch { /* */ }
  window.addEventListener('huanyu-theme', syncStatusBar);
  window.addEventListener('huanyu-statusbar', (e) => { ctxOverride = e.detail || null; syncStatusBar(); });
  setTimeout(() => { SplashScreen.hide().catch(() => {}); }, 300);
}
