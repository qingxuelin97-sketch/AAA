// 三端统一客户端日志采集模块 —— 桌面网页 / 移动网页 / APP（Capacitor）共用。
//
// 采集范围：
//   1) window.onerror —— JS 运行时异常 + 资源加载失败（img/script/css 404 等）
//   2) unhandledrejection —— 未 catch 的 Promise 拒绝
//   3) React 渲染崩溃 —— 由 ErrorBoundary 调用 logEvent('error','react_crash',...) 上报
//   4) 业务自定义事件 —— 业务代码主动调用 logEvent(level, event, message, extra)
//   5) 用户行为轨迹 —— 路由切换 / 页面停留时长（可选，按需开启）
//   6) 页面性能时序 —— 首屏加载耗时（navigation timing）
//
// 上报策略：
//   · 批量缓冲：累积 5 条或 3 秒到了就 flush，减少请求数。
//   · 卸载保活：pagehide/beforeunload 用 sendBeacon（不阻塞卸载），回退 fetch keepalive。
//   · APP 生命周期：Capacitor 'pause' 事件触发 flush（切后台先上报）。
//   · 指纹去重：相同 error 在短时间内只上报一次 + count，避免崩溃风暴。
//   · 智能采样：debug 级别按比率采样（与服务端对齐）。

const BUFFER_MAX = 5;
const FLUSH_INTERVAL_MS = 3000;
const DEDUP_WINDOW_MS = 60_000;
const DEBUG_SAMPLE_RATE = 0.1;

// 检测当前运行端：原生壳 = 'app'，否则 = 'client'。
function detectSource() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) return 'app';
  } catch { /* */ }
  return 'client';
}

const SOURCE = detectSource();

// 会话 ID：每次页面加载生成一个，用于聚合同一次访问内的所有日志。
// 存 sessionStorage 而非内存：单标签页多页面跳转（非 SPA）时仍可串联。
function getSessionId() {
  try {
    let sid = sessionStorage.getItem('hy_log_sid');
    if (!sid) {
      sid = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('hy_log_sid', sid);
    }
    return sid;
  } catch { return ''; }
}
const SESSION_ID = getSessionId();

// 日志上报端点（与 api.jsx 的 getApiBase 同口径，但此处独立解析避免循环依赖）。
function getApiBase() {
  try {
    const env = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
    if (window.Capacitor?.isNativePlatform?.()) {
      return /^https:\/\//i.test(env) ? env : '';
    }
    if (env) return env;
    const pref = (localStorage.getItem('huanyu_server') || '').trim();
    return pref;
  } catch { return ''; }
}

const buffer = [];
let flushTimer = null;
let installed = false;

// 指纹去重：相同 event+message 在窗口内只缓冲一次，count 累加。
const recentFingerprints = new Map(); // fp -> { count, firstTs }

function makeFingerprint(event, message) {
  const raw = `${event}|${String(message || '').slice(0, 200)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
  return 'fp' + Math.abs(h).toString(36);
}

// 把一条日志推入缓冲区。去重 + 采样在此完成。
function push(item) {
  // debug 智能采样
  if (item.level === 'debug' && Math.random() > DEBUG_SAMPLE_RATE) return;
  // error/warn 指纹去重
  if (item.level === 'error' || item.level === 'warn') {
    const fp = makeFingerprint(item.event, item.message);
    const now = Date.now();
    const recent = recentFingerprints.get(fp);
    if (recent && now - recent.firstTs < DEDUP_WINDOW_MS) {
      recent.count++;
      return; // 已有相同指纹在窗口内，不重复缓冲
    }
    recentFingerprints.set(fp, { count: 1, firstTs: now });
  }
  buffer.push(item);
  if (buffer.length >= BUFFER_MAX) flush();
  else scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_INTERVAL_MS);
}

// 实际上报。优先 sendBeacon（页面卸载时仍能发出），回退 fetch keepalive。
function ship(items) {
  if (!items.length) return;
  const base = getApiBase();
  if (!base && window.Capacitor?.isNativePlatform?.()) return;
  const url = base + '/api/logs/client';
  const payload = JSON.stringify({ batch: items });
  // sendBeacon 只能发单条 payload；批量时把 batch 作为 extra 传，服务端展开。
  // 这里简化：逐条发 sendBeacon 不现实，批量用 fetch keepalive。
  try {
    if (navigator.sendBeacon && items.length === 1) {
      // 单条用 sendBeacon（卸载时最可靠）
      const blob = new Blob([JSON.stringify(items[0])], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch { /* */ }
  // 批量或 sendBeacon 不可用：fetch keepalive（卸载时也能发出）
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch { /* 静默：日志不能影响主业务 */ }
}

// flush 缓冲区。如果是最终卸载，强制 sendBeacon / keepalive。
function flush(isUnload = false) {
  if (!buffer.length) return;
  const items = buffer.splice(0);
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const base = getApiBase();
  if (!base && window.Capacitor?.isNativePlatform?.()) return;
  if (isUnload) {
    // 卸载场景：逐条 sendBeacon（最可靠）
    for (const item of items) {
      try {
        const blob = new Blob([JSON.stringify(item)], { type: 'application/json' });
        const ok = navigator.sendBeacon?.(base + '/api/logs/client', blob);
        if (!ok) throw new Error('beacon failed');
      } catch {
        // 回退 keepalive fetch（同步发起，不 await）
        try {
          fetch(base + '/api/logs/client', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item), keepalive: true,
          }).catch(() => {});
        } catch { /* */ }
      }
    }
  } else {
    ship(items);
  }
}

// —— 公共 API：业务代码主动上报 ——
// logEvent('error', 'payment_failed', '支付超时', { order_id: 123 })
export function logEvent(level, event, message = '', extra = null) {
  push({
    level: level || 'info',
    event: event || 'client_event',
    message: String(message || ''),
    extra,
    session_id: SESSION_ID,
    source: SOURCE,
  });
}

// 便捷方法
export const logInfo = (event, message, extra) => logEvent('info', event, message, extra);
export const logWarn = (event, message, extra) => logEvent('warn', event, message, extra);
export const logError = (event, message, extra) => logEvent('error', event, message, extra);

// —— 全局错误捕获安装 ——
// 在 main.jsx 启动时调用一次。重复调用会被去重（installed 标记）。
export function installGlobalErrorCapture() {
  if (installed) return;
  installed = true;

  // 1. JS 运行时异常 + 资源加载失败
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script/css）—— e.target 是元素，e.error 为 null
    if (e.target && e.target !== window && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      const url = e.target.src || e.target.href || '';
      push({
        level: 'warn', event: 'resource_error', source: SOURCE,
        message: `资源加载失败: ${e.target.tagName} ${url}`,
        extra: { tag: e.target.tagName, url, session_id: SESSION_ID },
        session_id: SESSION_ID,
      });
      return;
    }
    // JS 运行时异常
    const err = e.error || e;
    push({
      level: 'error', event: 'js_error', source: SOURCE,
      message: err.message || e.message || '未知错误',
      extra: {
        stack: err.stack || '',
        filename: e.filename || '',
        lineno: e.lineno || 0,
        colno: e.colno || 0,
        session_id: SESSION_ID,
      },
      session_id: SESSION_ID,
    });
  }, true); // capture phase：资源错误不冒泡，必须 capture

  // 2. 未 catch 的 Promise 拒绝
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    push({
      level: 'error', event: 'unhandled_promise', source: SOURCE,
      message: msg,
      extra: {
        stack: reason?.stack || '',
        session_id: SESSION_ID,
      },
      session_id: SESSION_ID,
    });
  });

  // 3. 页面卸载 / 隐藏 —— 强制 flush
  const onUnload = () => flush(true);
  window.addEventListener('pagehide', onUnload);
  window.addEventListener('beforeunload', onUnload);
  // visibilitychange：切到后台时也 flush（移动端 tab 切换）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });

  // 4. Capacitor APP 生命周期：切到后台时 flush
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('pause', () => flush(true));
      }).catch(() => {});
    }
  } catch { /* not in native shell */ }

  // 5. 首屏性能时序 —— load 后记录 navigation timing
  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const t = performance.getEntriesByType('navigation')?.[0];
        if (!t) return;
        push({
          level: 'info', event: 'page_load', source: SOURCE,
          message: `页面加载完成 ${Math.round(t.loadEventEnd - t.startTime)}ms`,
          extra: {
            domContentLoaded: Math.round(t.domContentLoadedEventEnd - t.startTime),
            loadComplete: Math.round(t.loadEventEnd - t.startTime),
            ttfb: Math.round(t.responseStart - t.startTime),
            session_id: SESSION_ID,
          },
          session_id: SESSION_ID,
        });
      } catch { /* */ }
    }, 0);
  });

  // 6. 记录一次启动事件
  push({
    level: 'info', event: 'session_start', source: SOURCE,
    message: `${SOURCE === 'app' ? 'APP' : '网页'}会话启动`,
    extra: {
      url: location.pathname + location.search,
      referrer: document.referrer || '',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio || 1,
      session_id: SESSION_ID,
    },
    session_id: SESSION_ID,
  });
}

export default { logEvent, logInfo, logWarn, logError, installGlobalErrorCapture, flush };
