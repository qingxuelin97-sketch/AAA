// 对话内搜索 · APP 壳专属悬浮玻璃胶囊。
// 与 Web 壳的过滤式搜索（Chat.jsx 内联 .chat-search）不同：不隐藏消息，
// 而是「高亮 + 上/下条跳转定位」—— 过滤会抽掉上下文，翻找长对话时更迷惑。
// 关键词高亮走 CSS Custom Highlight API（Capacitor WebView / Safari 17.2+），
// 完全不碰 BubbleContent 的 markdown/regex 渲染管线；API 不存在时降级为
// 仅跳转 + 气泡闪烁（mark-flash，与消息书签同一视觉语言）。
import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

const HL = 'chat-search';
const HL_CUR = 'chat-search-cur';

// 在一条消息的气泡 DOM 里收集所有命中 Range（大小写不敏感的子串匹配）。
function collectRanges(msgEl, q) {
  const out = [];
  const bubbles = msgEl.querySelectorAll('.bubble');
  for (const b of bubbles) {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.data.toLowerCase();
      let at = 0, i;
      while ((i = text.indexOf(q, at)) !== -1) {
        const r = new Range();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        out.push(r);
        at = i + q.length;
      }
    }
  }
  return out;
}

export default function ChatSearchBar({ messages, onClose }) {
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);

  const query = q.trim().toLowerCase();
  // 命中消息 id 列表（时间序）。流式中的消息不参与 —— 其 DOM 每帧在变，
  // Range 会失效；流式结束 messages 引用更新，自动重算补上。
  const hits = useMemo(() => {
    if (!query) return [];
    return messages
      .filter(m => m.id && !m._streaming && (m.content || '').toLowerCase().includes(query))
      .map(m => m.id);
  }, [messages, query]);

  // q 变化后命中集合变了，回到最近一条（微信等 IM 惯例：从最新往回翻）。
  useEffect(() => { setCur(hits.length ? hits.length - 1 : 0); }, [query, hits.length]);

  // 高亮：对全部命中气泡建 Range 挂到 highlight registry；当前条单独一层加重。
  useEffect(() => {
    if (!('highlights' in CSS)) return;
    CSS.highlights.delete(HL);
    CSS.highlights.delete(HL_CUR);
    if (!query || !hits.length) return;
    const all = [];
    let curRanges = [];
    hits.forEach((id, i) => {
      const el = document.getElementById('msg-' + id);
      if (!el) return;
      const ranges = collectRanges(el, query);
      all.push(...ranges);
      if (i === cur) curRanges = ranges;
    });
    if (all.length) CSS.highlights.set(HL, new Highlight(...all));
    if (curRanges.length) CSS.highlights.set(HL_CUR, new Highlight(...curRanges));
    return () => { CSS.highlights.delete(HL); CSS.highlights.delete(HL_CUR); };
  }, [hits, cur, query]);

  // 跳转定位：滚到当前命中并闪烁（复用书签的 mark-flash 视觉）。
  useEffect(() => {
    const id = hits[cur];
    if (!id) return;
    const el = document.getElementById('msg-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mark-flash');
    const t = setTimeout(() => el.classList.remove('mark-flash'), 1600);
    return () => { clearTimeout(t); el.classList.remove('mark-flash'); };
  }, [hits, cur]);

  const step = (d) => {
    if (!hits.length) return;
    setCur(c => (c + d + hits.length) % hits.length);
  };

  return (
    <div className="hy-search" role="search">
      <Search size={15} className="hy-search-ic" />
      <input
        autoFocus value={q} enterKeyHint="search"
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder="在本对话中搜索…"
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') onClose();
        }}
      />
      {query && (
        <span className={'hy-search-count' + (hits.length ? '' : ' none')}>
          {hits.length ? `${cur + 1}/${hits.length}` : '无结果'}
        </span>
      )}
      <div className="hy-search-nav">
        <button onClick={() => step(-1)} disabled={!hits.length} aria-label="上一条"><ChevronUp size={16} /></button>
        <button onClick={() => step(1)} disabled={!hits.length} aria-label="下一条"><ChevronDown size={16} /></button>
      </div>
      <button className="hy-search-x" onClick={onClose} aria-label="关闭搜索"><X size={15} /></button>
    </div>
  );
}
