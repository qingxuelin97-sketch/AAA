import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './api.jsx';
import AppBootstrap from './AppBootstrap.jsx';
import { OverlayProvider } from './overlay.jsx';
import { AppNavProvider } from './appNavigation.jsx';
import { initTheme } from './theme.js';
import { initAccent } from './accent.js';
import { initPerf } from './perf.js';
import { initFx } from './fx.js';
import { initAppMode } from './appmode.js';
import { installGlobalErrorCapture } from './logger.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
// 仪与匣读数字体（JetBrains Mono · OFL）：--ix-font-mono 首选项，App 壳的等宽「读数」
// 依赖它保证跨端一致；latin 子集 400/600 两档（读数只覆盖数字/拉丁/单位，中文永不套等宽），
// 静态/APK 构建也需要（App 正是消费方），Web 仅注册 @font-face、无家族引用即零渲染影响。
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
// APP 端沉浸对话皮肤（白+青玻璃深度进化）—— 在 styles.css 之后引入，import 顺序即级联
// 顺序，故此文件为 app 对话皮肤的唯一权威来源（覆盖 styles.css 里历史层叠的 chat 规则）。
import './chat/chat-app.css';
// PR4 native material and balanced-performance overrides. Quiet Aqua loads
// immediately after it and preserves the same balanced/lite performance gate.
import './styles/app-runtime.css';
// IX runtime authority: every App layer consumes the frozen --ix-* namespace directly.
import './styles/app-ix-tokens.css';
import './styles/app-ix-accents.css';
import './styles/app-controls.css';
import './styles/app-pages-quiet-aqua.css';
// Shared App composition and HIG rules remain fenced; IX pages are the final cascade.
import './styles/app-experience-v3.css';
import './styles/app-hig-v5.css';
// Historical S3-S7 composition is folded into the IX page tail; no runtime bridge remains.
import './styles/app-ix-core.css';
import './styles/app-ix-pages-a.css';
import './styles/app-ix-pages-b.css';
import './styles/app-ix-pages-c.css';
// IX-6/IX-7 tail: long-tail pages, states, and migrated stage composition.
import './styles/app-ix-pages-d.css';

const INSECURE_HTTP_TEST = import.meta.env.VITE_INSECURE_HTTP_TEST === '1';
if (INSECURE_HTTP_TEST) {
  document.documentElement.dataset.insecureHttp = '1';
}
initAppMode(); // resolve native/app shell → data-app first (theme defaults depend on it)
initTheme();   // apply saved theme before first paint (no flash; App system mode defaults light)
initAccent();  // apply saved accent palette before first paint
initPerf();    // resolve device perf tier → data-perf, gating heavy GPU effects
initFx();      // global click ripples + tap bursts
installGlobalErrorCapture(); // 三端统一：捕获 window.onerror / unhandledrejection 并上报

const NATIVE = !!window.Capacitor?.isNativePlatform?.();

// Register the PWA service worker (web only; Capacitor serves from a native scheme).
if (!NATIVE && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const base = import.meta.env.BASE_URL || './';
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => {});
  });
}

// Static build (GitHub Pages): use an in-browser backend + hash routing so the
// app works as pure static files with no server.
const STATIC = import.meta.env.VITE_STATIC === '1';

// 开源中文衬线（Noto Serif SC · OFL）：仅 web 版加载 —— 标题的 CJK 字形从系统默认
// 升级为真正的设计衬线。按 unicode-range 切片，浏览器只取用到的子集（~百 KB 级）；
// 静态/APK 构建跳过，安装包不膨胀（App 内继续用系统字体）。
if (!STATIC) {
  import('@fontsource/noto-serif-sc/500.css').catch(() => {});
  import('@fontsource/noto-serif-sc/600.css').catch(() => {});
  import('@fontsource/noto-serif-sc/700.css').catch(() => {});
}
const Router = STATIC ? HashRouter : BrowserRouter;

function render() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {INSECURE_HTTP_TEST && (
        <div className="http-test-badge" role="status" aria-label="HTTP 内测版">
          HTTP 内测版
        </div>
      )}
      <ErrorBoundary>
        <AppBootstrap native={NATIVE}>
          {(initialSession) => (
            <Router>
              <OverlayProvider>
                <AppNavProvider>
                  <AuthProvider initialSession={initialSession}>
                    <App />
                  </AuthProvider>
                </AppNavProvider>
              </OverlayProvider>
            </Router>
          )}
        </AppBootstrap>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// 启动形态分流（强制联网的地基）：
//   · 原生 App（APK）→ 服务器地址已在底层焊死（见 api.jsx getApiBase），永远直连
//     真实后端，绝不装 mock、绝不离线。用户无需、也无从配置。
//   · 网页 / 静态站演示 → 无真实后端时装内置 mock 跑离线演示（本仓库预览与试玩用）。
//   · 同源部署（服务器自己托管前端）→ 直接 render，/api 走同源。
const RUNTIME_SERVER = (() => { try { return (localStorage.getItem('huanyu_server') || '').trim(); } catch { return ''; } })();
if (NATIVE) {
  render();
} else if (STATIC && !RUNTIME_SERVER) {
  import('./mock/backend.js').then(({ installMockBackend }) => { installMockBackend(); render(); });
} else {
  render();
}
