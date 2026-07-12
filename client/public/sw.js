/* 幻域 PWA service worker — offline app shell.
   Strategy: network-first for navigations (always try fresh index.html, fall back
   to cache when offline), cache-first for hashed build assets (immutable). */
const CACHE = 'huanyu-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch 3rd-party (model APIs, images)

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { caches.open(CACHE).then((c) => c.put('./index.html', r.clone())); return r; })
      .catch(() => caches.match('./index.html').then((m) => m || caches.match('./'))));
    return;
  }
  // hashed assets — cache first, then fill cache
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (url.pathname.includes('/assets/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest'))) {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return r;
  }).catch(() => caches.match(req))));
});
