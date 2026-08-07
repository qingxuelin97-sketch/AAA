import { useEffect, useRef, useState } from 'react';
import { useAppOverlay } from '../overlay.jsx';
import { api } from '../api.jsx';

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

// 对话页的多个轻浮层注册进统一 OverlayProvider。它不再伪造浏览器历史，
// 因而关闭菜单不会意外触发路由 POP，也不会污染 Android 返回栈。
export function useOverlayBack(anyOverlayOpen, closeAllOverlays) {
  useAppOverlay(anyOverlayOpen, closeAllOverlays);
}

// 消息书签（修缮⑪回流服务端）：收藏重要段落随时跳回，按会话隔离。
// 服务端 messages.bookmarked 是真相（换设备不丢）；本机旧 huanyu_chat_marks_*
// 首次加载一次性上迁后清键；离线 toggle 退回本机 key 兜底（下次加载再迁）。
// 返回 { marks, toggleMark, jumpToMark }；jumpToMark 需一个 onMissing(msg) 回调用于提示。
export function useBookmarks(id, onMissing, messages) {
  const [marks, setMarks] = useState(new Set());
  const hydratedRef = useRef('');
  useEffect(() => {
    if (!id || !Array.isArray(messages) || messages.length === 0) return;
    if (hydratedRef.current === String(id)) return;
    hydratedRef.current = String(id);
    const server = new Set(messages.filter(m => m.id && m.bookmarked).map(m => m.id));
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem('huanyu_chat_marks_' + id) || '[]'); } catch { /* */ }
    const present = new Set(messages.filter(m => m.id).map(m => m.id));
    const toUp = legacy.filter(mid => present.has(mid) && !server.has(mid));
    if (legacy.length) {
      (async () => {
        for (const mid of toUp) {
          try { const r = await api(`/chat/conversations/${id}/messages/${mid}/bookmark`, { method: 'POST' }); if (r.bookmarked) server.add(mid); } catch { /* 离线/已删：跳过 */ }
        }
        try { localStorage.removeItem('huanyu_chat_marks_' + id); } catch { /* */ }
        setMarks(new Set(server));
      })();
    } else {
      setMarks(server);
    }
  }, [id, messages]);
  const toggleMark = (m) => {
    if (!m.id) return;
    setMarks(prev => {
      const n = new Set(prev);
      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
      return n;
    });
    api(`/chat/conversations/${id}/messages/${m.id}/bookmark`, { method: 'POST' }).catch(() => {
      // 离线兜底：镜像 toggle 到本机 key，下次加载走一次性迁移
      try {
        const key = 'huanyu_chat_marks_' + id;
        const cur = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
        if (cur.has(m.id)) cur.delete(m.id); else cur.add(m.id);
        localStorage.setItem(key, JSON.stringify([...cur]));
      } catch { /* */ }
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
