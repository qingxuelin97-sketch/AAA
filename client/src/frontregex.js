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

// 已编译正则缓存：脚本对象通常在整个会话内稳定引用，避免每帧对几十条脚本重复编译。
const reCache = new WeakMap();
function compiledRe(sc) {
  if (sc && typeof sc === 'object') {
    if (reCache.has(sc)) return reCache.get(sc);
    const re = toRegExp(sc.find);
    reCache.set(sc, re);
    return re;
  }
  return toRegExp(sc && sc.find);
}

// 把酒馆 replaceString 里的占位符按「本次匹配」插值：
//   {{match}} → 整段匹配；$&/$1..$99 → 整段/第 n 个捕获组；$$ → 字面 $。
// 用函数式 replacer + 手动插值：既能正确回填捕获组，又不会被替换串里 HTML/CSS/JS
// 中散落的 $（如 CSS 的 $、JS 模板）误当成组引用——只识别 $ 后紧跟 数字/&/$ 的形式。
function substitute(replaceTpl, match, groups) {
  let r = String(replaceTpl);
  if (/\{\{\s*match\s*\}\}/i.test(r)) r = r.replace(/\{\{\s*match\s*\}\}/gi, match);
  return r.replace(/\$(\$|&|\d{1,2})/g, (whole, k) => {
    if (k === '$') return '$';
    if (k === '&') return match;
    const idx = parseInt(k, 10);
    if (idx === 0) return match;              // $0 视作整段（宽容处理）
    return idx <= groups.length ? (groups[idx - 1] ?? '') : whole; // 越界则保持字面
  });
}

// 若替换结果「看起来是 HTML」且尚未被 ```html 围栏包裹，则自动包一层，
// 让下游 renderWithPanels 无论前后是否夹叙述文本，都能稳定切出 iframe 面板。
function wrapPanelIfHtml(s) {
  if (!s) return s;
  if (/```html/i.test(s)) return s;          // 卡片替换串自带围栏（如凡人卡）→ 不重复包裹
  return looksLikeHtml(s) ? ('\n```html\n' + s.trim() + '\n```\n') : s;
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
    const re = compiledRe(sc);
    if (!re) continue;
    const replaceTpl = String(sc.replace ?? '');
    try {
      out = out.replace(re, (...args) => {
        // args = [match, p1, p2, ..., offset, string, (namedGroups?)]
        let rest = args.slice(1);
        if (rest.length && typeof rest[rest.length - 1] === 'object') rest = rest.slice(0, -1); // 命名组对象
        const groups = rest.slice(0, -2);   // 去掉 offset 与 string，余为捕获组
        return wrapPanelIfHtml(substitute(replaceTpl, args[0], groups));
      });
    } catch { /* 单条失败跳过 */ }
    if (Array.isArray(sc.trim)) for (const t of sc.trim) { if (t) out = out.split(t).join(''); }
  }
  return out;
}

// 粗略判定一段文本是否「就是 HTML 面板」（应当以 iframe 渲染而非纯文本）。
export function looksLikeHtml(s) {
  if (!s) return false;
  const t = s.trim();
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t) ||
    (/^<(div|section|style|table|main|body|article|figure|ul|ol)[\s>]/i.test(t) &&
      /<\/(div|section|style|table|main|body|article|figure|ul|ol)>/i.test(t));
}
