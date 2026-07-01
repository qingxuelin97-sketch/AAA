import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth, getToken, API_BASE } from './api.jsx';

// 已知的事件名集合。EventSource 需在建连时为每个具名事件注册监听器，
// 这里枚举服务端会推送的全部事件，建连时一次性注册。
// 业务侧用 useRealtimeEvent(name, fn) 订阅，handler 写进 ref，每次渲染都刷新，无需重绑。
const KNOWN_EVENTS = ['ready', 'dm', 'friend', 'notification', 'character_new'];

const RealtimeContext = createContext(null);

// 静态构建（GitHub Pages / 单文件离线版 / Capacitor 离线壳）走的是浏览器内 mock 后端，无 SSE；
// 此时 Provider 退化为 no-op，不影响渲染。
const STATIC = import.meta.env.VITE_STATIC === '1';

// 重连上限：超过此次数后停止自动重连，避免 token 永久失效时无限打请求。
const MAX_RETRIES = 6;

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | connecting | open | closed
  const esRef = useRef(null);
  const handlersRef = useRef(new Map()); // event -> Set<fn>
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const stoppedRef = useRef(false);

  const dispatch = useCallback((event, data) => {
    const set = handlersRef.current.get(event);
    if (!set || !set.size) return;
    for (const fn of [...set]) { try { fn(data); } catch { /* handler 抛错不影响其他订阅者 */ } }
  }, []);

  // 核心连接逻辑：每次重连都重新读取 token，避免闭包持有陈旧 token 导致 401 死循环。
  const connect = useCallback(() => {
    if (stoppedRef.current || STATIC) return;
    const token = getToken();
    if (!token) { setStatus('idle'); return; }
    // 超过重连上限：停止重试，等待下次手动触发（如页面恢复可见）。
    if (retryRef.current >= MAX_RETRIES) { setStatus('closed'); return; }

    setStatus('connecting');
    const es = new EventSource(API_BASE + '/api/realtime/stream?token=' + encodeURIComponent(token));
    esRef.current = es;

    es.onopen = () => { retryRef.current = 0; setStatus('open'); };
    es.onerror = () => {
      // 临时断网时浏览器会自动重连；致命错误（如 401 鉴权失败 / 服务停止）readyState===CLOSED。
      if (es.readyState === EventSource.CLOSED) {
        setStatus('closed');
        retryRef.current = Math.min(retryRef.current + 1, MAX_RETRIES);
        const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
        timerRef.current = setTimeout(connect, delay);
      } else {
        setStatus('connecting');
      }
    };

    for (const name of KNOWN_EVENTS) {
      es.addEventListener(name, (e) => {
        let data = null;
        try { data = JSON.parse(e.data); } catch { data = e.data; }
        dispatch(name, data);
      });
    }
  }, [dispatch]);

  useEffect(() => {
    if (STATIC || !user) {
      stoppedRef.current = true;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setStatus('idle');
      return;
    }
    stoppedRef.current = false;
    retryRef.current = 0;
    connect();

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setStatus('idle');
    };
  }, [user?.id, connect]);

  // 移动端生命周期：app 切到后台时 OS 会杀掉 SSE 长连接，回前台后需立即重连。
  // Web 端同理：标签页切到后台一段时间后连接也会断。监听 visibilitychange + Capacitor pause/resume。
  useEffect(() => {
    if (STATIC || !user) return;
    // 切到后台：主动关闭 SSE，省电省流量，避免移动 OS 维持半开 TCP 跑心跳。
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setStatus('closed');
    };
    // 回前台：连接已断，立即重连。
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (esRef.current && esRef.current.readyState === EventSource.OPEN) return;
      retryRef.current = 0;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      connect();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') onHidden();
      else if (document.visibilityState === 'visible') onVisible();
    };
    document.addEventListener('visibilitychange', onVis);
    // Capacitor 原生壳：pause/resume 与 visibilitychange 在部分 WebView 不同步，双保险。
    let pauseUnsub, resumeUnsub;
    try {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('pause', onHidden).then?.(h => { pauseUnsub = h; });
        App.addListener('resume', onVisible).then?.(h => { resumeUnsub = h; });
      }).catch(() => {});
    } catch { /* not in native shell */ }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try { pauseUnsub?.remove?.(); resumeUnsub?.remove?.(); } catch { /* */ }
    };
  }, [user?.id, connect]);

  const subscribe = useCallback((event, fn) => {
    if (!handlersRef.current.has(event)) handlersRef.current.set(event, new Set());
    handlersRef.current.get(event).add(fn);
    return () => { handlersRef.current.get(event)?.delete(fn); };
  }, []);

  return (
    <RealtimeContext.Provider value={{ status, subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

// 订阅一个具名事件。handler 通过 ref 持有，每次渲染都刷新到最新闭包，
// 因此订阅只在 event 名变化时重绑，避免业务侧手抖把 handler 列进依赖导致频繁重订阅。
export function useRealtimeEvent(event, handler) {
  const ctx = useContext(RealtimeContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!ctx) return;
    const fn = (data) => { try { handlerRef.current?.(data); } catch { /* */ } };
    return ctx.subscribe(event, fn);
  }, [ctx, event]);
}
