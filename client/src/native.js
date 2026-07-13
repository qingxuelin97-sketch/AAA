// Native (Capacitor) integration — loaded ONLY inside the native app shell, never on web.
// Wires the hardware back button, status-bar theming and splash-screen dismissal.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
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

// 设备完整性信号采集 —— 预留原生接口。
// 采集结果写入 window.__HY_INTEGRITY（紧凑 JSON 字符串），api.jsx 存在即随
// 请求头 X-Device-Integrity 上报，服务端注册闸评估（见 server/integrity.js）。
// 形态：{ r: 0|1, t: '<play-integrity-jws>' } —— r=root 软信号，t=Play
// Integrity 令牌（硬信号，服务端验签）。
//
// 现状：本仓库未提交 android/ios 原生工程，也未接入 root 检测 / Play
// Integrity 原生插件，故此处采集不到任何信号、不写全局变量 —— 服务端因此
// 判定 unknown、永不拦截（对现网零影响）。落地原生插件后（如社区
// capacitor 插件或自研），把结果填进 sig 即自动接通整条链路：
//   · Play Integrity：`@capacitor-community/...` 或原生 requestIntegrityToken；
//   · root 启发式：su 路径 / test-keys 构建 / 已知超级用户管理器包名。
// 采集失败一律静默（宁可缺信号也不阻断启动）。
async function collectIntegrity() {
  try {
    if (Capacitor.getPlatform() === 'web') return;
    const sig = {};
    // —— 原生插件接入点（现无插件，sig 保持为空）——
    // const token = await IntegrityPlugin.requestToken({ nonce });
    // if (token) sig.t = String(token).slice(0, 8000);
    // const rooted = await RootCheckPlugin.isRooted();
    // if (rooted) sig.r = 1;
    if (sig.r != null || sig.t) window.__HY_INTEGRITY = JSON.stringify(sig);
  } catch { /* 采集失败静默：缺信号 = 服务端判定 unknown = 不拦截 */ }
}

export async function initNative() {
  // 设备标识（Android = ANDROID_ID，iOS = identifierForVendor）：挂到全局供
  // api.jsx 附加 X-Device-Id 头，服务端用于注册配额（限单设备开小号）。
  // 本文件只在原生壳加载（main.jsx 动态 import），Web 端永远不带此头。
  // 取值失败静默跳过 —— 服务端对缺失设备头不硬拒（Web 壳本来就没有）。
  try {
    const { identifier } = await Device.getId();
    if (identifier) window.__HY_DEVICE_ID = String(identifier).slice(0, 64);
  } catch { /* plugin not available */ }
  await collectIntegrity();
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
