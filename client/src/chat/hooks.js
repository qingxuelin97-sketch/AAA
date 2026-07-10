import { useEffect, useRef, useState } from 'react';

// 长按识别：触屏上取代不可用的 hover 操作行。用一组共享 ref 管理计时，onLongPress(target)
// 在按住 ms 毫秒且未移动超阈值时触发。返回 bind(target) → 事件处理器（可展开到任意元素，
// 因此能在消息列表里逐条绑定而不违反 hook 规则）。桌面/鼠标端不触发，仍走 hover 行为。
export function useLongPress(onLongPress, { ms = 450, moveTol = 10 } = {}) {
  const timer = useRef(null);
  const startPt = useRef(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  return (target) => ({
    onTouchStart: (e) => {
      if (e.touches && e.touches.length > 1) return;
      const t = e.touches ? e.touches[0] : e;
      startPt.current = { x: t.clientX, y: t.clientY };
      fired.current = false;
      clear();
      timer.current = setTimeout(() => { fired.current = true; onLongPress(target); }, ms);
    },
    onTouchMove: (e) => {
      if (!startPt.current) return;
      const t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientX - startPt.current.x) > moveTol || Math.abs(t.clientY - startPt.current.y) > moveTol) clear();
    },
    onTouchEnd: () => { clear(); startPt.current = null; },
    onTouchCancel: () => { clear(); startPt.current = null; },
  });
}

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
