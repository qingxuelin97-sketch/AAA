// 酒馆助手（TavernHelper / JS-Slash-Runner）兼容桥 —— 让酒馆角色卡自带的 HTML 前端
// 在本平台的沙箱 iframe 里「原生」跑起来。
//
// 两侧组成：
//   1) 宿主侧 installTavernHost()：在父页挂 window.TavernHelper（卡片面板通过
//      window.parent.TavernHelper.generate({...}) 直接调用，凡人修仙传等主流卡的标准用法），
//      generate 走本平台「静默生成」SSE 端点（不落库、不污染对话流），流式 token 以
//      js_stream_token_received_incrementally 事件广播进各面板 iframe。
//   2) 面板侧 buildPanelDoc()：把 shim 脚本注入面板 HTML <head> 最前（先于卡片自身脚本执行），
//      提供 eventOn/eventEmit/removeEventOn、tavern_events/iframe_events 常量、
//      triggerSlash/getVariables 等最小 API 面，并保留高度自适应上报。
//
// 事件语义对齐酒馆助手：
//   js_generation_started                     —— 生成开始
//   js_stream_token_received_incrementally    —— 每次新 token 的【增量】文本（卡片用 += 拼接）
//   js_stream_token_received_fully            —— 每次事件给出【累计】全文
//   js_generation_ended                       —— 生成结束，参数为最终全文
import { getToken } from './api.jsx';

// ---------- 面板侧 shim（序列化注入 iframe，勿引用外部作用域） ----------
const PANEL_SHIM = `(function(){
  if (window.__hyTavernShim) return; window.__hyTavernShim = true;
  // —— 本地事件总线 + 父页事件转发 ——
  var handlers = {};
  function on(name, fn){ (handlers[name] = handlers[name] || []).push(fn); }
  function off(name, fn){ var a = handlers[name]; if (!a) return; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  function emit(name){ var args = Array.prototype.slice.call(arguments, 1); var a = (handlers[name] || []).slice();
    for (var i = 0; i < a.length; i++) { try { a[i].apply(null, args); } catch (e) { console.error('[tavern-shim] handler error', name, e); } } }
  window.eventOn = on; window.eventMakeLast = on; window.eventMakeFirst = function(n, f){ (handlers[n] = handlers[n] || []).unshift(f); };
  window.eventOnce = function(name, fn){ var w = function(){ off(name, w); fn.apply(null, arguments); }; on(name, w); };
  window.eventEmit = emit; window.eventRemoveListener = off; window.removeEventOn = off;
  window.eventClearEvent = function(name){ delete handlers[name]; };
  // 酒馆事件名常量（最常用子集；未列出的事件名直接用字符串亦可）
  var ev = {
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    GENERATION_ENDED: 'js_generation_ended',
    MESSAGE_RECEIVED: 'message_received', MESSAGE_SENT: 'message_sent',
    MESSAGE_UPDATED: 'message_updated', CHAT_CHANGED: 'chat_id_changed'
  };
  window.iframe_events = ev; window.tavern_events = ev;
  // 父页 postMessage → 本地事件
  window.addEventListener('message', function(e){
    var d = e && e.data && e.data.__hyTavern;
    if (!d || d.type !== 'event') return;
    emit.apply(null, [d.name].concat(d.args || []));
  });
  // —— TavernHelper 本地代理（卡片可用 window.TavernHelper 或 window.parent.TavernHelper）——
  function parentTH(){ try { return window.parent && window.parent.TavernHelper; } catch (e) { return null; } }
  window.TavernHelper = window.TavernHelper || {
    generate: function(opts){ var th = parentTH(); if (th && th.generate) return th.generate(opts);
      return Promise.reject(new Error('宿主 TavernHelper 不可用')); },
    generateRaw: function(opts){ return window.TavernHelper.generate(opts); },
    getVariables: function(){ var th = parentTH(); return (th && th.getVariables) ? th.getVariables.apply(null, arguments) : {}; },
    insertOrAssignVariables: function(){ var th = parentTH(); if (th && th.insertOrAssignVariables) return th.insertOrAssignVariables.apply(null, arguments); },
    substitudeMacros: function(s){ return String(s == null ? '' : s); },
    getLastMessageId: function(){ var th = parentTH(); return (th && th.getLastMessageId) ? th.getLastMessageId() : 0; },
    getChatMessages: function(){ var th = parentTH(); return (th && th.getChatMessages) ? th.getChatMessages.apply(null, arguments) : []; },
    triggerSlash: function(){ var th = parentTH(); if (th && th.triggerSlash) return th.triggerSlash.apply(null, arguments); return Promise.resolve(''); }
  };
  window.triggerSlash = window.TavernHelper.triggerSlash;
  window.getVariables = window.TavernHelper.getVariables;
  // SillyTavern.getContext() 最小面：部分卡用它探测运行环境/取角色名
  window.SillyTavern = window.SillyTavern || { getContext: function(){ return {
    name2: (window.__hyCtx && window.__hyCtx.characterName) || '',
    chatId: (window.__hyCtx && window.__hyCtx.conversationId) || 0,
    eventSource: { on: on, once: window.eventOnce, removeListener: off }, eventTypes: ev
  }; } };
  // —— 高度自适应上报（含滚动高度变化监听）——
  function report(){ try { parent.postMessage({ __hyH: document.documentElement.scrollHeight }, '*'); } catch (e) {} }
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
  window.addEventListener('load', report); setTimeout(report, 300); setTimeout(report, 1500);
})();`;

// 把 shim + 运行时上下文注入面板 HTML。shim 必须先于卡片自身脚本执行，
// 所以插到 <head> 起始（无 head 则文档最前）。
export function buildPanelDoc(html, ctx) {
  const boot = `<script>window.__hyCtx=${JSON.stringify({
    characterName: ctx?.characterName || '',
    conversationId: ctx?.conversationId || 0
  })};</scr` + `ipt><script>${PANEL_SHIM}</scr` + `ipt>`;
  const s = String(html || '');
  if (/<head[^>]*>/i.test(s)) return s.replace(/<head[^>]*>/i, (m) => m + boot);
  if (/<html[^>]*>/i.test(s)) return s.replace(/<html[^>]*>/i, (m) => m + boot);
  return boot + s;
}

// ---------- 宿主侧 ----------
// 广播酒馆事件到页面上所有面板 iframe。
export function broadcastTavernEvent(name, ...args) {
  const frames = document.querySelectorAll('iframe.html-panel');
  for (const f of frames) {
    try { f.contentWindow?.postMessage({ __hyTavern: { type: 'event', name, args } }, '*'); } catch { /* */ }
  }
}

// 在父页安装 window.TavernHelper。convRef: { current: conversationId }（跟随路由变化）。
// 返回卸载函数。多次安装以最后一次为准（Chat 页卸载时恢复）。
export function installTavernHost(convRef, opts = {}) {
  const prev = window.TavernHelper;
  let aborter = null;

  // 变量区：面板可读写的会话级变量（内存 + localStorage 持久化，按会话隔离）
  const varKey = () => 'huanyu_tavern_vars_' + (convRef.current || 0);
  const getVariables = () => { try { return JSON.parse(localStorage.getItem(varKey()) || '{}'); } catch { return {}; } };
  const setVariables = (v) => { try { localStorage.setItem(varKey(), JSON.stringify(v || {})); } catch { /* */ } };

  // generate：走「静默生成」端点 —— 不落库、不动对话流；流式增量以酒馆事件广播进面板。
  const generate = async (params = {}) => {
    const convId = convRef.current;
    if (!convId) throw new Error('当前无会话');
    const userInput = String(params.user_input ?? params.injects?.map?.(j => j.content).join('\n') ?? '');
    aborter = new AbortController();
    broadcastTavernEvent('js_generation_started');
    const res = await fetch(`/api/chat/conversations/${convId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({
        user_input: userInput,
        include_history: params.include_history === true,   // 默认静默：卡片面板自带完整上下文
        overrides: params.overrides || null
      }),
      signal: aborter.signal
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `生成失败（${res.status}）`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          if (j.error) throw new Error(j.error);
          if (j.delta) {
            full += j.delta;
            broadcastTavernEvent('js_stream_token_received_incrementally', j.delta);
            broadcastTavernEvent('js_stream_token_received_fully', full);
          }
          if (j.fee) opts.onFee?.(j.fee, j.balance);
        } catch (err) { if (err.message && !err.message.includes('JSON')) throw err; }
      }
    }
    broadcastTavernEvent('js_generation_ended', full);
    return full;
  };

  window.TavernHelper = {
    generate,
    generateRaw: generate,
    stop: () => { try { aborter?.abort(); } catch { /* */ } },
    getVariables,
    insertOrAssignVariables: (delta) => { const v = getVariables(); Object.assign(v, delta || {}); setVariables(v); },
    replaceVariables: (v) => setVariables(v),
    getLastMessageId: () => opts.getLastMessageId?.() ?? 0,
    getChatMessages: () => opts.getChatMessages?.() ?? [],
    // 斜杠命令兜底：本平台无 slash 引擎，静默成功避免卡片崩溃（/echo 转 toast）
    triggerSlash: async (cmd) => {
      const m = /^\/echo\s+(.+)$/i.exec(String(cmd || '').trim());
      if (m) opts.onToast?.(m[1]);
      return '';
    }
  };
  return () => { window.TavernHelper = prev; };
}
