import React, { createContext, useContext, useEffect, useState } from 'react';

const TOKEN_KEY = 'huanyu_token';

// API 基址：Web 同源部署留空（走相对 /api）；Capacitor 原生壳里 webview 运行在
// https://localhost，需通过 VITE_API_BASE 指向真实后端才能连通 REST 与 SSE。
export const API_BASE = import.meta.env.VITE_API_BASE || '';

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
  const res = await fetch(API_BASE + '/api' + path, { method, headers, body: payload });
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
