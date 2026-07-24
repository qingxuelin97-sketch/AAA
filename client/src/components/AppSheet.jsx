// AppSheet — APP 原生壳通用底部抽屉。
// 复用 app-shell.css 已有的 .app-sheet-mask / .app-sheet / .app-sheet-grip /
// .app-sheet-title 视觉语言，在其之上补齐「拖拽关闭 + snap points + 挂 body
// portal + Escape 关闭」四项可复用能力，替代各页各自手写 mask/sheet 的轮子。
//
// 仅在 APP 壳使用（调用方都在 AppLayout 子树），web 端不会渲染到本组件。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_SNAP = 0.92;          // 默认贴到屏高 92%（避让底栏 + 安全区）
const CLOSE_THRESH = 96;            // 下拖超过此距离 → 关闭
const CLOSE_VEL = 0.8;              // 或瞬时速度 >0.8 px/ms → 关闭

export default function AppSheet({ open, onClose, title, children, snapPoints, dismissOnMask = true, className = '', sheetStyle }) {
  const sheetRef = useRef(null);
  const [dy, setDy] = useState(0);          // 实时下拖距离（px，正值向下）
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false); // 关闭动画进行中

  // open 变化时复位拖拽态。
  useEffect(() => { if (open) { setDy(0); setDragging(false); setClosing(false); } }, [open]);

  // Escape 关闭。
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !closing) { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    // 等关闭动画收尾再卸载（让外层 open=false 与动画同步）。
    const t = setTimeout(() => { onClose?.(); setClosing(false); setDy(0); }, 220);
    // 兜底：若 onClose 没翻 open，220ms 后强制清态。
    return () => clearTimeout(t);
  };

  // —— 拖拽关闭：touch 跟踪 ——
  // 仅在 grip / sheet 顶部区域起手才算（避免内容长滚动被误判）。
  const track = useRef({ sy: 0, st: 0, t0: 0 });
  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    track.current = { sy: t.clientY, st: Date.now(), t0: Date.now() };
    setDragging(true);
  };
  const onTouchMove = (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const raw = t.clientY - track.current.sy;
    if (raw <= 0) { setDy(0); return; }
    // 阻尼：超过 80px 后衰减，模拟原生橡皮筋。
    const damped = raw <= 80 ? raw : 80 + (raw - 80) * 0.5;
    setDy(damped);
    if (e.cancelable && raw > 4) e.preventDefault();
  };
  const onTouchEnd = () => {
    if (!dragging) return;
    const dt = Date.now() - track.current.t0;
    const vel = dt > 0 ? dy / dt : 0;
    setDragging(false);
    if (dy > CLOSE_THRESH || vel > CLOSE_VEL) {
      // 触发关闭动画：让 sheet 滑到底再卸载。
      setClosing(true);
      setTimeout(() => { onClose?.(); setClosing(false); setDy(0); }, 200);
    } else {
      setDy(0); // 回弹（CSS transition 接管）
    }
  };

  if (!open && !closing) return null;

  const maxSnap = snapPoints?.length ? Math.max(...snapPoints) : DEFAULT_SNAP;
  const sheetCls = 'app-sheet' + (className ? ' ' + className : '') + (closing ? ' app-sheet-closing' : '');
  // 拖拽中无 transition（跟手），其余态用 transition 平滑（回弹 / 关闭滑出）。
  const transform = `translateY(${dy}px)`;
  const transition = dragging ? 'none' : 'transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1)';
  const mergedStyle = {
    transform,
    transition,
    maxHeight: `calc(${maxSnap * 100}dvh - env(safe-area-inset-bottom))`,
    ...(sheetStyle || {}),
  };

  return createPortal(
    <div className={'app-sheet-mask' + (closing ? ' app-sheet-mask-closing' : '')}
      onClick={dismissOnMask && !dragging ? close : undefined}>
      <div className={sheetCls} ref={sheetRef} style={mergedStyle}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="app-sheet-grip" />
        {title && <h3 className="app-sheet-title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}
