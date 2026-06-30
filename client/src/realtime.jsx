import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth, getToken } from './api.jsx';

// 已知的事件名集合。EventSource 需在建连时为每个具名事件注册监听器，
// 这里枚举服务端会推送的全部事件，建连时一次性注册。
// 业务侧用 useRealtimeEvent(name, fn) 订阅，handler 写进 ref，每次渲染都刷新，无需重绑。
const KNOWN_EVENTS = ['ready', 'dm', 'friend', 'notification', 'character_new'];

const RealtimeContext = createContext(null);

// 静态构建（GitHub Pages / 单文件离线版）走的是浏览器内 mock 后端，无 SSE；
// 此时 Provider 退化为 no-op，不影响渲染。
const STATIC = import.meta.env.VITE_STATIC === '1';

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | connecting | open | closed
  const esRef = useRef(null);
  const handlersRef = useRef(new Map()); // event -> Set<fn>
  const retryRef = useRef(0);
  const timerRef = useRef(null);

  const dispatch = useCallback((event, data) => {
    const set = handlersRef.current.get(event);
    if (!set || !set.size) return;
    for (const fn of [...set]) { try { fn(data); } catch { /* handler 抛错不影响其他订阅者 */ } }
  }, []);

  useEffect(() => {
    if (STATIC || !user) {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setStatus('idle');
      return;
    }
    const token = getToken();
    if (!token) return;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      const es = new EventSource('/api/realtime/stream?token=' + encodeURIComponent(token));
      esRef.current = es;

      es.onopen = () => { retryRef.current = 0; setStatus('open'); };
      es.onerror = () => {
        // 临时断网时浏览器会自动重连；致命错误（如 401 鉴权失败 / 服务停止）readyState===CLOSED。
        if (es.readyState === EventSource.CLOSED) {
          setStatus('closed');
          // 指数退避手动重连，上限 30s，避免服务端宕机时疯狂打请求。
          retryRef.current = Math.min(retryRef.current + 1, 5);
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
    };

    connect();
    return () => {
      stopped = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setStatus('idle');
    };
  }, [user?.id, dispatch]);

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
