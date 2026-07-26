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
import { initAppMode, isAppMode } from './appmode.js';
import { installGlobalErrorCapture } from './logger.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';
// Lumen Web 三件套（令牌 → 桥接 → 材质）：Web 壳的 Lumen Glass 权威。全部选择器
// 围栏在 html:not([data-app="1"])，与 App 围栏 DOM 互斥；桥接靠特异性取胜，
// 不依赖 import 顺序，因此放在 styles.css 之后、App 层之前即可。
import './styles/web-lumen-tokens.css';
import './styles/web-lumen-bridge.css';
import './styles/web-lumen-materials.css';
import './styles/web-lumen-shell.css';
import './styles/web-lumen-controls.css';
import './styles/web-lumen-pages.css';
import './styles/web-lumen-states.css';
import './styles/web-lumen-misc.css';
import './styles/web-lumen-longtail.css';
// App 层 CSS（chat-app + runtime + Lumen 全家）自 W6 起按模式分包：静态 import
// 整体搬入 styles/app-entry.js（顺序逐行保持，顺序即级联权威），isAppMode()
// 时在 render 前 await 动态加载 —— Web 用户不再下载 ~700KB App CSS。

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

// W6 CSS 按模式分包：App 壳在 render 前补载 App 层样式包（initAppMode 已解析
// data-app，时机足够早；App 启动闪屏遮盖加载帧）。加载失败不阻断启动 ——
// 宁可先渲染出功能，样式包由 lazyRetry 同类逻辑兜底（Vite 动态 import 自带
// 一次网络失败即 reject，这里静默重试一次后放行）。
const ensureAppStyles = () => (isAppMode()
  ? import('./styles/app-entry.js').catch(() => new Promise(r => setTimeout(r, 300)).then(() => import('./styles/app-entry.js')).catch(() => {}))
  : Promise.resolve());

if (NATIVE) {
  ensureAppStyles().then(render);
} else if (STATIC && !RUNTIME_SERVER) {
  Promise.all([
    import('./mock/backend.js').then(({ installMockBackend }) => installMockBackend()),
    ensureAppStyles(),
  ]).then(render);
} else {
  ensureAppStyles().then(render);
}
