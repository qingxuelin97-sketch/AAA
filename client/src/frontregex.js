// 前端显示正则引擎（对齐酒馆 regex_scripts 的「仅显示」用法）。
// 在消息「渲染」时对文本做 find→replace，可把 AI 输出里的标记替换成 HTML 面板等。
// 仅作用于显示层，不改动落库内容 / 提示词。

function toRegExp(find) {
  const s = String(find || '');
  // 支持 /pattern/flags 写法；否则按纯正则源处理，默认全局。
  const m = s.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  try {
    if (m) { let f = m[2] || ''; if (!f.includes('g')) f += 'g'; return new RegExp(m[1], f); }
    return new RegExp(s, 'g');
  } catch { return null; }
}

// role: 'user' | 'assistant'；酒馆 placement 1=用户消息 2=AI消息。
export function applyFrontRegex(text, scripts, role) {
  if (!text || !Array.isArray(scripts) || !scripts.length) return text;
  const want = role === 'user' ? 1 : 2;
  let out = String(text);
  for (const sc of scripts) {
    if (!sc || sc.find == null) continue;
    const placement = Array.isArray(sc.placement) ? sc.placement : [1, 2];
    if (!placement.includes(want)) continue;
    const re = toRegExp(sc.find);
    if (!re) continue;
    const replace = String(sc.replace ?? '');   // 保留 ```html 围栏，交给渲染层识别为面板
    try { out = out.replace(re, () => replace); } catch { /* 单条失败跳过 */ }
    if (Array.isArray(sc.trim)) for (const t of sc.trim) { if (t) out = out.split(t).join(''); }
  }
  return out;
}

// 粗略判定一段文本是否「就是 HTML 面板」（应当以 iframe 渲染而非纯文本）。
export function looksLikeHtml(s) {
  if (!s) return false;
  const t = s.trim();
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t) ||
    (/^<(div|section|style|table|main|body)[\s>]/i.test(t) && /<\/(div|section|style|table|main|body)>/i.test(t));
}
