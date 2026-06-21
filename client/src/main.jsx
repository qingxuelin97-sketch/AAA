import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './api.jsx';
import { initTheme } from './theme.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';

initTheme(); // apply saved theme before first paint (no flash)

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

if (STATIC) {
  import('./mock/backend.js').then(({ installMockBackend }) => { installMockBackend(); render(); });
} else {
  render();
}
