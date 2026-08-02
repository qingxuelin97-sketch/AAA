import React, { createContext, useContext, useEffect, useState } from 'react';
import { isAppMode } from './appmode.js';

const TOKEN_KEY = 'huanyu_token';
const APP_TOKEN_KEY = 'huanyu_app_token';
const APP_TOKEN_MIGRATION_KEY = 'huanyu_app_token_migrated';
const SERVER_KEY = 'huanyu_server';
const HTTP_TEST_BUILD = import.meta.env.VITE_INSECURE_HTTP_TEST === '1';

// 原生 App 的服务地址只允许在构建时注入，不接受用户侧覆盖。这样既能固定
// 正式后端，也不会把可被中间人篡改的明文 HTTP 地址烙进每一个安装包。

// 兼容保留：Web 同源部署时的本地覆盖入口（设置页已不再暴露，值恒为空 → 同源相对 /api）。
export function getServerPref() {
  try { return (localStorage.getItem(SERVER_KEY) || '').trim(); } catch { return ''; }
}
export function setServerPref(url) {
  const v = String(url || '').trim().replace(/\/+$/, '');
  try { v ? localStorage.setItem(SERVER_KEY, v) : localStorage.removeItem(SERVER_KEY); } catch { /* */ }
  return v;
}
// API 基址解析：
//   · 打包期显式注入的 VITE_API_BASE 最优先（换服务器不改码）
//   · 原生 App → 构建期注入的 HTTPS 正式服务器（强制联网）
//   · 网页 → 本地覆盖（恒空）→ 同源相对 /api
export function getApiBase() {
  const env = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
  if (window.Capacitor?.isNativePlatform?.()) {
    const secure = /^https:\/\//i.test(env);
    const explicitHttpTest = HTTP_TEST_BUILD && /^http:\/\//i.test(env);
    if (!secure && !explicitHttpTest) throw new Error('此安装包未配置安全的 HTTPS 服务地址，请由管理员重新打包');
    return env;
  }
  if (env) return env;
  return getServerPref();
}

function requiredApiBase() {
  return getApiBase();
}

// 相对上传资源（/uploads/...）在 APK 指向独立后端时必须补全域名，
// 否则会打到 webview 自身的 https://localhost。所有展示层统一走这里解析。
export function assetUrl(u) {
  if (!u || typeof u !== 'string') return u;
  return u.startsWith('/uploads/') ? requiredApiBase() + u : u;
}

export function getToken() {
  if (isAppMode()) {
    const scopedToken = localStorage.getItem(APP_TOKEN_KEY);
    if (scopedToken) return scopedToken;
    // Read the legacy key once for upgrades. Once App auth has been written or
    // cleared, never fall back to the Web session again (especially on logout).
    if (localStorage.getItem(APP_TOKEN_MIGRATION_KEY) === '1') return null;
    return localStorage.getItem(TOKEN_KEY);
  }
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  const app = isAppMode();
  const key = app ? APP_TOKEN_KEY : TOKEN_KEY;
  if (app) localStorage.setItem(APP_TOKEN_MIGRATION_KEY, '1');
  if (t) localStorage.setItem(key, t);
  else localStorage.removeItem(key);
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function api(path, { method = 'GET', body, raw, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // App surface is explicit and never inferred from the URL on the server.
  // It gates the pink-v1 demo presentation without changing ordinary Web data.
  if (isAppMode()) headers['X-Huanyu-App'] = '1';
  // 原生壳设备标识（native.js 启动时写入）：服务端注册配额用。Web 端恒无此头。
  if (window.__HY_DEVICE_ID) headers['X-Device-Id'] = window.__HY_DEVICE_ID;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(requiredApiBase() + '/api' + path, { method, headers, body: payload, signal });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `请求失败 (${res.status})`, {
    status: res.status,
    code: data.code || '',
    retryAfter: res.headers.get('Retry-After') || '',
  });
  return data;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/upload', { method: 'POST', body: fd });
}

const AuthContext = createContext(null);

export async function restoreAuthSession({ retainTransient = isAppMode() } = {}) {
  const currentToken = getToken();
  if (!currentToken) return { state: 'anonymous', user: null, error: null };
  try {
    const data = await api('/auth/me');
    if (data.token) setToken(data.token);
    else if (isAppMode() && !localStorage.getItem(APP_TOKEN_KEY)) setToken(currentToken);
    return { state: 'authenticated', user: data.user, error: null };
  } catch (error) {
    // Only an authoritative authentication verdict invalidates the local
    // session. Offline/timeout/5xx keeps the token and offers a retry screen.
    if (error?.status === 401 || error?.status === 403) {
      setToken(null);
      return { state: 'anonymous', user: null, error: null };
    }
    // Keep the established Web interaction baseline. Retained offline sessions
    // are an App-shell policy, where intermittent mobile connectivity is normal.
    if (!retainTransient) {
      setToken(null);
      return { state: 'anonymous', user: null, error: null };
    }
    return { state: 'retry', user: null, error };
  }
}

export function AuthProvider({ children, initialSession }) {
  const [user, setUser] = useState(initialSession?.user || null);
  const [loading, setLoading] = useState(initialSession === undefined);
  const [sessionError, setSessionError] = useState(initialSession?.state === 'retry' ? initialSession.error : null);

  const applySession = (session) => {
    setUser(session?.user || null);
    setSessionError(session?.state === 'retry' ? session.error : null);
    return session;
  };

  useEffect(() => {
    if (initialSession !== undefined) return;
    restoreAuthSession().then(applySession).finally(() => setLoading(false));
    // Initial session is deliberately sampled once; native bootstrap already
    // completed before this provider mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(d.token); setUser(d.user); setSessionError(null); return d.user;
  };
  const register = async (form) => {
    const d = await api('/auth/register', { method: 'POST', body: form });
    setToken(d.token); setUser(d.user); setSessionError(null); return d.user;
  };
  const logout = () => { setToken(null); setUser(null); setSessionError(null); };
  const refreshUser = async () => {
    const session = await restoreAuthSession({ retainTransient: true });
    // Background refreshes (balance/realtime resume) must not replace a
    // usable screen with the recovery gate on a transient network failure.
    if (session.state === 'retry' && user) return user;
    applySession(session);
    return session.user;
  };
  const retrySession = async () => {
    setLoading(true);
    try { return applySession(await restoreAuthSession()); }
    finally { setLoading(false); }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, loading, sessionError, refreshUser, retrySession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
