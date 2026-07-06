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

// 官方服务器预设（设置 → 服务器连接 一键选择）。
// 内网地址走局域网（同一 Wi-Fi/内网可用，延迟最低）；公网地址随处可达。
export const SERVER_PRESETS = [
  { id: 'lan', label: '内网服务器', hint: '同一局域网内延迟最低', url: 'http://172.22.139.18:4000' },
  { id: 'wan', label: '公网服务器', hint: '任意网络可达', url: 'http://120.27.249.73:4000' },
];

// 连通性测试：请求 /api/health 并测量往返延迟（ms）。
// 用于设置页的「测试连接」与延迟徽标（目标：交互延迟 < 1000ms）。
export async function pingServer(url, timeoutMs = 8000) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    if (!res.ok || !d.ok) return { ok: false, ms, error: 'HTTP ' + res.status };
    return { ok: true, ms };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: e.name === 'AbortError' ? `超时（${Math.round(timeoutMs / 1000)} 秒无响应）` : (e.message || '网络错误') };
  } finally { clearTimeout(timer); }
}

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

export async function api(path, { method = 'GET', body, raw, timeout } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  const isUpload = body instanceof FormData;
  if (body && !isUpload) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // 普通 JSON 请求带超时兜底：连接远端服务器（尤其移动网络）时避免请求悬挂导致 UI 卡死。
  // 流式响应（raw）与大文件上传不设默认超时。
  let signal;
  let timer = null;
  const ms = timeout ?? (raw || isUpload ? 0 : 30000);
  if (ms > 0) {
    const ctl = new AbortController();
    signal = ctl.signal;
    timer = setTimeout(() => ctl.abort(), ms);
  }
  let res;
  try {
    res = await fetch(getApiBase() + '/api' + path, { method, headers, body: payload, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络或服务器连接');
    throw e;
  } finally { if (timer) clearTimeout(timer); }
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
