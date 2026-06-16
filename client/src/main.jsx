import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './api.jsx';
import '@fontsource-variable/inter';
import './styles.css';

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
