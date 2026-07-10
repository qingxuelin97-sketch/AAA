import { useEffect, useState } from 'react';

// 浮层后退键拦截：任一浮层（抽屉/菜单/搜索/反应面板/编辑/+面板）打开时向 history 压一个
// 哨兵状态，浏览器/系统后退优先关闭浮层而非跳路由；ESC 同义。关闭时回退掉哨兵。
// 从 Chat.jsx 原样抽出（逻辑不变），供对话页复用；不发明新的浮层栈状态机。
export function useOverlayBack(anyOverlayOpen, closeAllOverlays) {
  useEffect(() => {
    if (!anyOverlayOpen) return;
    history.pushState({ overlay: true }, '');
    const onPop = closeAllOverlays;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAllOverlays(); history.state?.overlay && history.back(); } };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey); if (history.state?.overlay) history.back(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyOverlayOpen]);
}

// 消息书签：收藏重要段落随时跳回。纯本地存储（三端通用、不依赖服务端），按会话隔离。
// 返回 { marks, toggleMark, jumpToMark }；jumpToMark 需一个 onMissing(msg) 回调用于提示。
export function useBookmarks(id, onMissing) {
  const [marks, setMarks] = useState(new Set());
  useEffect(() => {
    try { setMarks(new Set(JSON.parse(localStorage.getItem('huanyu_chat_marks_' + id) || '[]'))); }
    catch { setMarks(new Set()); }
  }, [id]);
  const toggleMark = (m) => {
    if (!m.id) return;
    setMarks(prev => {
      const n = new Set(prev);
      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
      try { localStorage.setItem('huanyu_chat_marks_' + id, JSON.stringify([...n])); } catch { /* */ }
      return n;
    });
  };
  const jumpToMark = (mid) => {
    const el = document.getElementById('msg-' + mid);
    if (!el) { onMissing?.(); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mark-flash');
    setTimeout(() => el.classList.remove('mark-flash'), 1800);
  };
  return { marks, toggleMark, jumpToMark };
}
