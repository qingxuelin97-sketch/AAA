import React, { createContext, useContext, useEffect, useState } from 'react';

const TOKEN_KEY = 'huanyu_token';
const SERVER_KEY = 'huanyu_server';

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
    if (!/^https:\/\//i.test(env)) throw new Error('此安装包未配置安全的 HTTPS 服务地址，请由管理员重新打包');
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
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // 原生壳设备标识（native.js 启动时写入）：服务端注册配额用。Web 端恒无此头。
  if (window.__HY_DEVICE_ID) headers['X-Device-Id'] = window.__HY_DEVICE_ID;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(requiredApiBase() + '/api' + path, { method, headers, body: payload });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/upload', { method: 'POST', body: fd });
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api('/auth/me').then(d => {
      setUser(d.user);
      if (d.token) setToken(d.token); // 服务端滑动续期：签发超 7 天时随响应换发新 token
    }).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(d.token); setUser(d.user); return d.user;
  };
  const register = async (form) => {
    const d = await api('/auth/register', { method: 'POST', body: form });
    setToken(d.token); setUser(d.user); return d.user;
  };
  const logout = () => { setToken(null); setUser(null); };
  const refreshUser = async () => {
    try {
      const d = await api('/auth/me');
      setUser(d.user);
      if (d.token) setToken(d.token); // 滑动续期（同上）
      return d.user;
    } catch { /* */ }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
