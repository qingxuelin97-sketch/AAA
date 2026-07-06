import React, { createContext, useContext, useEffect, useState } from 'react';

const TOKEN_KEY = 'huanyu_token';
const SERVER_KEY = 'huanyu_server';

// API 基址三级解析（接通真实服务器的地基）：
//   1) 用户在「设置 → 服务器连接」里配置的地址（localStorage，APK 单包双模式：
//      留空=离线演示（mock），填写=连接真实后端）
//   2) 构建期 VITE_API_BASE（CI 打包时注入固定服务器）
//   3) 空 = Web 同源部署（相对 /api）
export function getServerPref() {
  try { return (localStorage.getItem(SERVER_KEY) || '').trim(); } catch { return ''; }
}
export function setServerPref(url) {
  const v = String(url || '').trim().replace(/\/+$/, '');
  try { v ? localStorage.setItem(SERVER_KEY, v) : localStorage.removeItem(SERVER_KEY); } catch { /* */ }
  return v;
}
export function getApiBase() {
  return getServerPref() || import.meta.env.VITE_API_BASE || '';
}
// 兼容既有引用（模块加载时解析一次；运行中修改服务器地址后需整页重载生效）
export const API_BASE = getApiBase();

// 相对上传资源（/uploads/...）在 APK 指向独立后端时必须补全域名，
// 否则会打到 webview 自身的 https://localhost。所有展示层统一走这里解析。
export function assetUrl(u) {
  if (!u || typeof u !== 'string') return u;
  return u.startsWith('/uploads/') ? getApiBase() + u : u;
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
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(getApiBase() + '/api' + path, { method, headers, body: payload });
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
    api('/auth/me').then(d => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
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
    try { const d = await api('/auth/me'); setUser(d.user); return d.user; } catch { /* */ }
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
