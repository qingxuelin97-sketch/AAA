// S7 · 通用长按上下文菜单。触发端复用 chat/hooks 的 useLongPress
// （450ms / 10px 容差，单一长按语义来源）；菜单本体走 overlay 隔离契约，
// 锚定在按点附近并钳制在视口内，Escape / 点遮罩关闭并回焦。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';

const MENU_W = 232;
const ITEM_H = 48;

export default function AppPressMenu({ at, items, onClose, returnFocusRef }) {
  const appPortal = isAppMode();
  const menuRef = useRef(null);
  const mountedAt = useRef(0);
  const [pos, setPos] = useState(() => clamp(at, items.length));
  useAppOverlay(true, onClose, { rootRef: menuRef, isolate: appPortal, returnFocusRef });
  useEffect(() => { setPos(clamp(at, items.length)); }, [at, items.length]);
  useEffect(() => { mountedAt.current = performance.now(); }, []);

  // 触屏长按后的合成事件可能吞掉 overlay 的一次性聚焦：短时重试直到
  // 焦点真正落入菜单（自终止状态循环）。
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      const root = menuRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) { clearInterval(id); return; }
      const first = root.querySelector('.qa-press-item');
      (first || root).focus?.({ preventScroll: true });
      if (++tries >= 12) clearInterval(id);
    }, 120);
    return () => clearInterval(id);
  }, []);

  // 长按抬指后浏览器会补发一次 click，正好落在刚展开的遮罩上——
  // 忽略挂载 350ms 内的遮罩点击，防止菜单开即被关。
  const maskClose = () => {
    if (performance.now() - mountedAt.current < 350) return;
    onClose();
  };

  const menu = (
    <div className="qa-press-mask" onClick={maskClose}>
      <div
        ref={menuRef}
        className="qa-press-menu"
        role="menu"
        aria-label="快捷操作"
        tabIndex={-1}
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={'qa-press-item' + (item.danger ? ' is-danger' : '')}
            onClick={() => { onClose(); item.onSelect(); }}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>
    </div>
  );

  return appPortal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu;
}

function clamp(at, count) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  const h = count * ITEM_H + 12;
  return {
    x: Math.max(10, Math.min((at?.x ?? vw / 2) - MENU_W / 2, vw - MENU_W - 10)),
    y: Math.max(10, Math.min((at?.y ?? vh / 2) + 8, vh - h - 10)),
  };
}
