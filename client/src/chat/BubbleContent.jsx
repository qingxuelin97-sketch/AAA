import React, { useEffect, useMemo, useRef, useState } from 'react';
import { assetUrl } from '../api.jsx';
import { applyFrontRegex, looksLikeHtml } from '../frontregex.js';
import { buildPanelDoc } from '../tavernbridge.js';
import { Image as ImageIcon } from 'lucide-react';

// —— 消息气泡内容渲染管线 —— 从 Chat.jsx 抽出（纯展示，无对话状态耦合）。
// 顺序：前端显示正则(酒馆 regex_scripts) → HTML 面板(iframe) → 专家档世界书内嵌图 → RP 排版。

// 专家档世界书：[[wbimg:<entryId>]] 标记协议 —— 模型在专家世界书触发时嵌入此标记，
// 前端按 wb_image_map[id] 直接展示创建者预注入的图片（不调用 AI 生图）。
const WBIMG_RE = /\[\[wbimg:(\d+)\]\]/g;

// 把一段助手文本拆成 [text | { marker, id, meta }] 交替片段，供气泡按片段渲染。
function splitWbMarkers(text, imageMap) {
  if (!text || !imageMap) return [{ text }];
  const out = [];
  let last = 0, m;
  WBIMG_RE.lastIndex = 0;
  while ((m = WBIMG_RE.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const id = m[1];
    out.push({ marker: true, id, meta: imageMap[id] || null });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// —— 角色扮演排版：*动作/神态* 渲染为柔和的斜体强调，与台词在视觉上分层。
// RP 对话的行文约定是「*叹了口气* 你来了。」，纯文本渲染时动作和台词糊成一团；
// 这里把星号段落变成带色斜体，读起来像剧本舞台指示，沉浸感立增。
export function renderRp(text, keyBase = 0) {
  if (!text || (text.indexOf('*') === -1 && text.indexOf('（') === -1)) return text;
  const out = [];
  const re = /\*([^*\n]{1,120})\*|（([^）\n]{1,120})）/g;
  let last = 0, m2, k = 0;
  while ((m2 = re.exec(text))) {
    if (m2.index > last) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last, m2.index)}</span>);
    out.push(<em key={`${keyBase}-a${k++}`} className="rp-act">{m2[1] != null ? m2[1] : m2[0]}</em>);
    last = m2.index + m2[0].length;
  }
  if (last < text.length) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last)}</span>);
  return out;
}

// PANEL_CTX 由 Chat 组件维护（角色名/会话 id），供面板 shim 里 getContext() 使用。
let PANEL_CTX = { characterName: '', conversationId: 0 };
export function setPanelCtx(ctx) { PANEL_CTX = ctx; }

// 专家前端面板：把角色卡里的 HTML 面板渲染进 iframe（blob: 文档，CSP 已在 index.html 放行）。
// 酒馆兼容关键点：sandbox 含 allow-same-origin（卡片前端普遍依赖 localStorage 存档，
// 且通过 window.parent.TavernHelper.generate 直接调宿主 AI）；buildPanelDoc 注入 shim。
function HtmlPanel({ html }) {
  // 完整 HTML 文档（游戏面板/说明书页）多为 position:fixed 的整页布局，高度按「一屏
  // 游戏视口」处理（下限 72vh、上限 ~86vh，内部自滚动）；片段面板才走高度上报完全自适应。
  const fullDoc = /<!doctype html|<html[\s>]/i.test(String(html || '').slice(0, 400));
  const vh = window.innerHeight || 800;
  const baseH = fullDoc ? Math.max(480, Math.round(vh * 0.72)) : 360;
  const maxH = fullDoc ? Math.max(560, Math.round(vh * 0.86)) : 4000;
  const [h, setH] = useState(baseH);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef(null);
  const src = useMemo(() => {
    const doc = buildPanelDoc(html, PANEL_CTX);
    return URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  }, [html]);
  useEffect(() => () => { try { URL.revokeObjectURL(src); } catch { /* */ } }, [src]);
  useEffect(() => {
    // 撤加载蒙层的时机不能只依赖 iframe load：卡片外链 CDN 在弱网下会挂起、load 迟迟不
    // 触发，而面板 DOM 其实早已渲染。shim 的高度上报（ResizeObserver 立即触发）是可靠信号；再兜超时。
    const onMsg = e => {
      const v = e.data && e.data.__hyH;
      if (typeof v !== 'number') return;
      if (frameRef.current && e.source === frameRef.current.contentWindow) setLoaded(true);
      setH(prev => Math.min(maxH, Math.max(fullDoc ? Math.max(baseH, prev) : 160, v + 8)));
    };
    window.addEventListener('message', onMsg);
    const t = setTimeout(() => setLoaded(true), 3500);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={'html-panel-wrap' + (loaded ? ' ready' : '')}>
      {!loaded && (
        <div className="html-panel-loading" aria-hidden="true">
          <span className="hp-spin" /><b>角色前端加载中…</b><i>大型面板首次加载可能需要几秒</i>
        </div>
      )}
      <iframe className="html-panel" ref={frameRef} src={src} onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
        allow="clipboard-write; clipboard-read; fullscreen"
        style={{ height: h }} title="角色前端面板" />
    </div>
  );
}

// 把含 ```html 面板 / 整段 HTML 的文本拆开：面板走 iframe，其余走 RP 排版。
// 围栏收尾不能用非贪婪 ```：酒馆卡的面板动辄数十万字符，正文里常夹杂反引号序列。
// 策略：完整 HTML 文档（含 </html>）取其后最近的 ```；否则退回最近 ```；找不到则吃到结尾。
function splitHtmlFences(text) {
  const out = []; const open = /```html\s*\n?/gi; let m, last = 0;
  while ((m = open.exec(text))) {
    const start = m.index, cs = open.lastIndex;
    let close = -1;
    const endHtml = text.toLowerCase().indexOf('</html>', cs);
    if (endHtml >= 0) close = text.indexOf('```', endHtml);
    if (close < 0) close = text.indexOf('```', cs);
    const html = close < 0 ? text.slice(cs) : text.slice(cs, close);
    const end = close < 0 ? text.length : close + 3;
    out.push({ pre: text.slice(last, start), html });
    last = end; open.lastIndex = end;
  }
  return { blocks: out, tail: text.slice(last) };
}
function renderWithPanels(text) {
  const parts = []; let k = 0;
  const { blocks, tail } = splitHtmlFences(text);
  for (const b of blocks) {
    if (b.pre.trim()) parts.push(<span key={'t' + (k++)}>{renderRp(b.pre, k)}</span>);
    parts.push(<HtmlPanel key={'h' + (k++)} html={b.html} />);
  }
  if (blocks.length === 0 && looksLikeHtml(tail)) return [<HtmlPanel key="h0" html={tail} />];
  if (tail.trim()) parts.push(looksLikeHtml(tail) ? <HtmlPanel key={'h' + k} html={tail} /> : <span key={'t' + k}>{renderRp(tail, k)}</span>);
  return parts;
}

// 气泡内容：专家档助手消息可含 [[wbimg:id]] 标记，标记位置直接展示预注入图片；无标记时退化为 RP 排版。
// React.memo 是性能关键：流式生成期间每帧 setMessages 一次，除最后一条外其余消息 content 引用不变，
// memo 让老消息跳过整段正则解析与片段重建 —— 否则解析成本随对话长度线性增长，长对话打字会掉帧。
// 引用回复：内容以 markdown 引用块（连续 `> ` 行 + 空行 + 正文）开头时，抽出引用卡。
// 约定格式 `> 谁：被引用的话`。返回 { quote:{who,text}|null, body }。
function extractQuote(text) {
  if (!text || !text.startsWith('> ')) return { quote: null, body: text };
  const lines = text.split('\n');
  const quoted = [];
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('> ')) quoted.push(lines[i].slice(2));
    else break;
  }
  if (!quoted.length) return { quote: null, body: text };
  while (i < lines.length && lines[i].trim() === '') i++;   // 跳过引用与正文间的空行
  const raw = quoted.join(' ');
  const sep = raw.indexOf('：');
  const quote = sep > 0 && sep <= 12 ? { who: raw.slice(0, sep), text: raw.slice(sep + 1) } : { who: '', text: raw };
  return { quote, body: lines.slice(i).join('\n') };
}

export const BubbleContent = React.memo(function BubbleContent({ content, role, imageMap, onPreview, frontRegex }) {
  if (!content) return null;
  // 引用卡：先抽出（仅纯文本消息；HTML 面板/前端正则消息不处理，避免误伤）。
  if (content.startsWith('> ') && !(frontRegex && frontRegex.length)) {
    const { quote, body } = extractQuote(content);
    if (quote) {
      return (
        <>
          <span className="quote-embed">{quote.who && <b>{quote.who}</b>}{quote.text}</span>
          {renderRp(body)}
        </>
      );
    }
  }
  // 先应用前端显示正则（酒馆 regex_scripts）：可把标记替换成 HTML 面板等（仅显示层）。
  const text = (frontRegex && frontRegex.length) ? applyFrontRegex(content, frontRegex, role) : content;
  // 助手消息可含面板；用户消息仅当角色带前端正则时才放行（酒馆 placement=1），避免普通聊天里
  // 用户偶然输入的 HTML 被当成面板渲染。
  if ((role === 'assistant' || (frontRegex && frontRegex.length)) && (/```html/i.test(text) || looksLikeHtml(text))) return renderWithPanels(text);
  if (role !== 'assistant' || !imageMap || !WBIMG_RE.test(text)) {
    WBIMG_RE.lastIndex = 0;
    return renderRp(text);
  }
  WBIMG_RE.lastIndex = 0;
  const parts = splitWbMarkers(text, imageMap);
  return parts.map((seg, i) => {
    if (!seg.marker) return <span key={i}>{renderRp(seg.text, i)}</span>;
    const meta = seg.meta;
    if (!meta || !meta.urls || meta.urls.length === 0) {
      return <span key={i} className="wb-img-missing" title="该标记未预注入图片"><ImageIcon size={12} /> 〔未注入图片〕</span>;
    }
    // 多张时堆叠展示，点击任一张进入全屏预览（支持 pinch-zoom 与双指缩放）。
    return (
      <span key={i} className="wb-inline-imgs">
        {meta.urls.map((u, j) => (
          <img key={j} className="wb-inline-img" src={assetUrl(u)} alt={`场景插图 ${j + 1}（点击放大）`} loading="lazy"
            onClick={() => onPreview(u)} />
        ))}
      </span>
    );
  });
});
