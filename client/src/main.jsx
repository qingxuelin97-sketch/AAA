import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './api.jsx';
import { initTheme } from './theme.js';
import { initAccent } from './accent.js';
import { initPerf } from './perf.js';
import { initFx } from './fx.js';
import { initAppMode } from './appmode.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';

initAppMode(); // resolve native/app shell → data-app first (theme defaults depend on it)
initTheme();   // apply saved theme before first paint (no flash; app shell defaults dark)
initAccent();  // apply saved accent palette before first paint
initPerf();    // resolve device perf tier → data-perf, gating heavy GPU effects
initFx();      // global click ripples + tap bursts

// Register the PWA service worker (web only; Capacitor serves from a native scheme).
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const base = import.meta.env.BASE_URL || './';
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => {});
  });
}

// Native shell only: wire status bar / back button / splash (code-split, never loaded on web).
if (window.Capacitor?.isNativePlatform?.()) {
  import('./native.js').then((m) => m.initNative()).catch(() => {});
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
}
const Router = STATIC ? HashRouter : BrowserRouter;

function render() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Router>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </React.StrictMode>
  );
}

// 单包双模式（接通真实服务器的地基）：
//   · 未配置服务器地址 → 安装内置 mock 后端（纯离线演示，现状不变）
//   · 在「设置 → 服务器连接」配置了地址 → 跳过 mock，所有 /api 走真实后端
//     （api.jsx 的 getApiBase() 会为每个请求补全服务器域名）
const RUNTIME_SERVER = (() => { try { return (localStorage.getItem('huanyu_server') || '').trim(); } catch { return ''; } })();
if (STATIC && !RUNTIME_SERVER) {
  import('./mock/backend.js').then(({ installMockBackend }) => { installMockBackend(); render(); });
} else {
  render();
}
