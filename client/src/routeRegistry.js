// Native App route policy. Page elements remain declared in App.jsx, while
// shell behaviour has one authoritative registry: parent, owning tab, Dock,
// status-bar tone, refresh/cache strategy and dirty-data policy.
//
// surface（叠印 Overprint）：表面极性由路由声明，不由主题决定。'immersive' 恒为
// 深台，墨阶翻转为纯白，机身条随之换极性；'index' 跟随 data-theme。默认从
// statusBar 推导，因为沉浸状态栏与深台是同一件事的两个面。
const R = (pattern, options = {}) => ({
  pattern,
  parent: Object.prototype.hasOwnProperty.call(options, 'parent') ? options.parent : '/',
  tab: Object.prototype.hasOwnProperty.call(options, 'tab') ? options.tab : '/',
  dock: options.dock ?? false,
  fullBleed: options.fullBleed ?? false,
  statusBar: options.statusBar ?? 'surface',
  surface: options.surface ?? ((options.statusBar ?? 'surface') === 'immersive' ? 'immersive' : 'index'),
  refresh: options.refresh ?? 'remount',
  cache: options.cache ?? 'none',
  dirty: options.dirty ?? 'none',
});

export const DEFAULT_APP_TAB = '/today';

export const APP_ROUTE_REGISTRY = Object.freeze([
  R('/today', { parent: null, tab: '/today', dock: true, cache: 'keep-alive', refresh: 'evict' }),
  R('/', { parent: null, tab: '/', dock: true, fullBleed: true, cache: 'keep-alive', refresh: 'evict', statusBar: 'immersive' }),
  R('/messages', { parent: null, tab: '/messages', dock: true, cache: 'keep-alive', refresh: 'evict' }),
  R('/me', { parent: null, tab: '/me', dock: true, cache: 'keep-alive', refresh: 'evict' }),

  R('/app-controls', { parent: '/today', tab: '/today', dock: false, refresh: 'none' }),
  R('/chats/:id', { parent: '/messages', tab: '/messages', statusBar: 'immersive' }),
  R('/chats', { parent: '/messages', tab: '/messages' }),
  R('/group/:id', { parent: '/groups', tab: '/messages' }),
  R('/groups', { parent: '/messages', tab: '/messages' }),
  R('/theater/:id', { parent: '/theater', tab: '/' }),
  R('/theater', { parent: '/', tab: '/' }),

  R('/character/new', { parent: '/', tab: '/', dirty: 'confirm' }),
  R('/character/:id/edit', { parent: '/character/:id', tab: '/', dirty: 'confirm' }),
  R('/character/:id', { parent: '/', tab: '/' }),
  R('/script/new', { parent: '/scripts', tab: '/', dirty: 'confirm' }),
  R('/script/:id/edit', { parent: '/script/:id', tab: '/', dirty: 'confirm' }),
  R('/script/:id', { parent: '/scripts', tab: '/' }),
  R('/scripts', { parent: '/', tab: '/' }),
  R('/worldbook/:id/edit', { parent: '/worldbook/:id', tab: '/me', dirty: 'confirm' }),
  R('/worldbook/:id', { parent: '/worldbooks', tab: '/me' }),
  R('/worldbooks', { parent: '/library', tab: '/me' }),
  R('/atelier/read/:id', { parent: '/atelier', tab: '/', statusBar: 'immersive' }),
  R('/atelier/:id', { parent: '/atelier', tab: '/', dirty: 'confirm' }),
  R('/atelier', { parent: '/', tab: '/' }),

  R('/notifications', { parent: '/today', tab: '/today' }),
  R('/search', { parent: '/today', tab: '/today' }),
  R('/announcements', { parent: '/today', tab: '/today' }),
  R('/events', { parent: '/today', tab: '/today' }),
  R('/gacha', { parent: '/today', tab: '/today' }),
  R('/leaderboard', { parent: '/today', tab: '/today' }),
  R('/achievements', { parent: '/me', tab: '/me' }),
  R('/insights', { parent: '/me', tab: '/me' }),
  R('/favorites', { parent: '/me', tab: '/me' }),
  R('/friends', { parent: '/me', tab: '/me' }),
  R('/wallet', { parent: '/me', tab: '/me' }),
  R('/settings', { parent: '/me', tab: '/me', dirty: 'confirm' }),
  R('/vip', { parent: '/me', tab: '/me' }),
  R('/profile', { parent: '/me', tab: '/me' }),
  R('/user/:id', { parent: '/', tab: '/' }),

  R('/community', { parent: '/', tab: '/' }),
  R('/tags', { parent: '/', tab: '/' }),
  R('/parliament', { parent: '/', tab: '/' }),
  R('/draw', { parent: '/', tab: '/' }),
  R('/studio', { parent: '/me', tab: '/me' }),
  R('/library', { parent: '/me', tab: '/me' }),
  R('/publish', { parent: '/me', tab: '/me', dirty: 'confirm' }),
  R('/admin', { parent: '/me', tab: '/me' }),
  R('/features', { parent: '/', tab: '/' }),
  R('/help', { parent: '/settings', tab: '/me' }),
  R('/auth', { parent: null, tab: null, dock: false, refresh: 'none' }),
]);

function splitPath(value) {
  return String(value || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
}

function matchPattern(pattern, path) {
  const a = splitPath(pattern).split('/');
  const b = splitPath(path).split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) {
      try { params[a[i].slice(1)] = decodeURIComponent(b[i] || ''); }
      catch { params[a[i].slice(1)] = b[i] || ''; }
    }
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

function fillPattern(pattern, params) {
  if (!pattern) return pattern;
  return pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(params[key] || ''));
}

export function getAppRoute(path) {
  const clean = splitPath(path);
  for (const route of APP_ROUTE_REGISTRY) {
    const params = matchPattern(route.pattern, clean);
    if (params) return { ...route, path: clean, params, parent: fillPattern(route.parent, params) };
  }
  return { ...R(clean), path: clean, params: {} };
}

export function getAppParent(path) {
  return getAppRoute(path).parent;
}

export function appDockVisible(path) {
  return getAppRoute(path).dock;
}

export function statusBarContextForTone(tone) {
  if (tone === 'immersive') return { color: '#0e1013', dark: true };
  return null;
}
