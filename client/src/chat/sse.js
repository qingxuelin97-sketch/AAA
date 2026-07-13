import { getApiBase, getToken } from '../api.jsx';

// 统一的 SSE 流式读取器 —— 收敛此前散落在 Chat.streamInto / CallScreen.say /
// tavernbridge.generate / NovelWorkspace.stream 四处几乎逐字重复的解析循环。
//
// 关键点：
//  · 内置 getApiBase() 前缀 —— Capacitor 原生壳使用构建期 HTTPS 后端时，相对
//    路径会命中 WebView 自身的 localhost 静态服务器导致流式请求失败（BUG1 根因）。
//  · onDelta(text)：每个 { delta } 增量的便捷回调（消费方自行做 rAF 节流）。
//  · onJson(obj)：每个解析出的 JSON 对象（{delta}/{fee}/{beat_id}/{seq}… 等），
//    供需要读取非 delta 字段（如平台计费 fee）的消费方使用。
//  · 上游用 { error } 事件报错时抛出 Error(error)；HTTP 非 2xx 抛出后端 error 文案。
//  · 返回累计的 delta 全文。
export async function streamSSE(path, { body, signal, headers, onDelta, onJson } = {}) {
  const res = await fetch(getApiBase() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(headers || {}) },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `请求失败 (${res.status})`); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch { continue; /* 半包 / 非 JSON 行：忽略 */ }
      if (j.error) throw new Error(j.error);
      if (j.delta) { full += j.delta; onDelta?.(j.delta); }
      onJson?.(j);
    }
  }
  return full;
}
