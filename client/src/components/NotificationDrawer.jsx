// NotificationDrawer — APP 原生壳顶部下拉通知抽屉（包 C）。
// ----------------------------------------------------------------------------
// 替代「切走 tab 才能看通知」的旧路径：从屏幕顶部下拉即可预览最近通知，
// 三档吸附（收起 / 半展开 / 全展开）。抽屉内点击单条 → 跳目标 + 标记已读；
// 底部「全部已读」+「查看全部」→ /notifications 整页。
//
// 数据：复用 AppLayout 已订阅的 SSE notification 事件（角标秒级更新），
// 抽屉打开时全量拉一次 /social/notifications 渲染列表。
//
// 仅 APP 壳渲染（html[data-app="1"] 作用域 .noti-drawer 样式）。
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.jsx';
import { useNav } from '../nav.js';
import { useToast } from '../ui.jsx';
import { useTopPull } from '../useTopPull.js';
import { haptic } from '../haptics.js';
import { SkeletonRowAv } from './AppSkeleton.jsx';
import AppEmpty from './AppEmpty.jsx';
import { Bell, Heart, MessageCircle, Gift, Megaphone, Landmark, Sparkles, CheckCheck, ChevronRight, X, BellOff } from 'lucide-react';

// 三档吸附：0=收起 / 1=半展开（40dvh）/ 2=全展开（85dvh）
const SNAP_PX = [0, 0.40, 0.85];

// 文案 → 图标推断（与 Notifications.jsx 一致，保证整页/抽屉视觉统一）
function iconFor(text) {
  const t = text || '';
  if (/赞|喜欢|收藏/.test(t)) return Heart;
  if (/评论|议论|回复/.test(t)) return MessageCircle;
  if (/赠送|奖励|金币|钻石|领取/.test(t)) return Gift;
  if (/议会|议员|提案|决议|表决|休会/.test(t)) return Landmark;
  if (/广播|📢|公告|活动/.test(t)) return Megaphone;
  if (/欢迎|新手/.test(t)) return Sparkles;
  return Bell;
}

// 分组：@我的 / 互动 / 系统（按文案推断，无 schema 改动）
function groupOf(n) {
  const t = n.text || '';
  if (/@|提到|提及/.test(t)) return 'mention';
  if (/赞|喜欢|收藏|评论|议论|回复|赠送|奖励/.test(t)) return 'interact';
  return 'system';
}
const GROUP_LABEL = { mention: '@我的', interact: '互动', system: '系统' };
const GROUP_ORDER = ['mention', 'interact', 'system'];

function fmtRelative(s) {
  if (!s) return '';
  const t = new Date(String(s).replace(' ', 'T'));
  if (isNaN(t)) return '';
  const diff = Date.now() - t.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  if (diff < 7 * 86400_000) return Math.floor(diff / 86400_000) + ' 天前';
  return String(s).replace('T', ' ').slice(0, 10);
}

export default function NotificationDrawer({ open, onClose, onOpen, unreadCount = 0 }) {
  const [items, setItems] = useState(null); // null=未加载 / []=空 / array=有数据
  const [loading, setLoading] = useState(false);
  const [snap, setSnap] = useState(0);      // 0/1/2
  const [dy, setDy] = useState(0);          // 拖动中的实时偏移（px）
  const [dragging, setDragging] = useState(false);
  const nav = useNav();
  const toast = useToast();
  const vhRef = useRef(typeof window !== 'undefined' ? window.innerHeight : 800);

  useEffect(() => {
    const onResize = () => { vhRef.current = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 抽屉打开 → 全量拉一次 + 自动吸到半展开档。
  useEffect(() => {
    if (!open) { setSnap(0); setDy(0); return; }
    setSnap(1);
    setLoading(true);
    api('/social/notifications')
      .then(d => setItems(d.notifications || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  // SSE 角标变化时（新通知到达）→ 若抽屉已开，刷新列表。
  useEffect(() => {
    if (!open) return;
    const onNew = () => {
      api('/social/notifications').then(d => setItems(d.notifications || [])).catch(() => {});
    };
    window.addEventListener('huanyu-noti-new', onNew);
    return () => window.removeEventListener('huanyu-noti-new', onNew);
  }, [open]);

  const snapPx = (s) => SNAP_PX[s] * vhRef.current;

  // —— 顶部下拉手势：仅在抽屉关闭时启用，下拉过阈值 → 唤起抽屉 ——
  const handlePull = useCallback((d) => {
    if (open) return;
    setDragging(true);
    // 阻尼：前 200px 跟手，之后衰减
    const damped = d <= 200 ? d : 200 + (d - 200) * 0.4;
    setDy(damped);
  }, [open]);
  const handleEnd = useCallback((d, vel) => {
    if (open) return;
    setDragging(false);
    const threshold = snapPx(1) * 0.4;
    if (d > threshold || vel > 0.6) {
      haptic.confirm();
      onOpen?.();
    } else {
      setDy(0);
    }
  }, [open, onOpen]);
  useTopPull({ enabled: !open, onPull: handlePull, onEnd: handleEnd });

  // —— 抽屉内拖拽关闭：从抽屉顶部向下拖 ——
  const trackRef = useRef({ sy: 0, prevY: 0, prevT: 0 });
  const onSheetTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    trackRef.current = { sy: e.touches[0].clientY, prevY: e.touches[0].clientY, prevT: Date.now() };
    setDragging(true);
  };
  const onSheetTouchMove = (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const raw = t.clientY - trackRef.current.sy;
    if (raw <= 0) { setDy(0); return; }
    const damped = raw <= 120 ? raw : 120 + (raw - 120) * 0.4;
    setDy(damped);
    trackRef.current.prevY = t.clientY;
    trackRef.current.prevT = Date.now();
    if (e.cancelable && raw > 4) e.preventDefault();
  };
  const onSheetTouchEnd = () => {
    if (!dragging) return;
    setDragging(false);
    const d = dy;
    const baseSnap = snapPx(snap);
    const newOffset = baseSnap + d;
    // 找最近的吸附档
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < SNAP_PX.length; i++) {
      const dist = Math.abs(newOffset - snapPx(i));
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setDy(0);
    if (best === 0) {
      haptic.tap();
      onClose?.();
    } else {
      haptic.select();
      setSnap(best);
    }
  };

  if (!open && dy === 0 && snap === 0) return null;

  // 当前应渲染的高度（拖动中 = 基准吸附 + dy；静止 = 吸附档高度）
  const baseH = snapPx(snap);
  const height = dragging ? Math.max(0, baseH + dy) : (open ? baseH : dy);
  const visible = height > 4;

  const groups = (() => {
    if (!items) return [];
    const g = { mention: [], interact: [], system: [] };
    for (const n of items) g[groupOf(n)].push(n);
    return GROUP_ORDER.map(k => [GROUP_LABEL[k], g[k]]).filter(([, arr]) => arr.length);
  })();

  const markRead = async (n) => {
    setItems(arr => arr ? arr.map(x => x.id === n.id ? { ...x, read: true } : x) : arr);
    try { await api('/social/notifications/' + n.id + '/read', { method: 'POST' }); } catch { /* */ }
    try { window.dispatchEvent(new Event('huanyu-noti-read-dec')); } catch { /* */ }
  };

  const openItem = (n) => {
    haptic.tap();
    markRead(n);
    if (n.link) { onClose?.(); nav(n.link); }
  };

  const markAllRead = async () => {
    haptic.confirm();
    setItems(arr => arr ? arr.map(x => ({ ...x, read: true })) : arr);
    try {
      await api('/social/notifications/read', { method: 'POST' });
      try { window.dispatchEvent(new Event('huanyu-noti-read')); } catch { /* */ }
      toast('已全部标记为已读');
    } catch (e) { toast(e.message, 'err'); }
  };

  const goAll = () => { haptic.tap(); onClose?.(); nav('/notifications'); };

  const transition = dragging ? 'none' : 'height 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)';

  return createPortal(
    <div className={'noti-drawer-mask' + (visible ? ' show' : '')}
      onClick={() => { if (visible && !dragging) { haptic.tap(); onClose?.(); } }}>
      <div className="noti-drawer" style={{ height, transition }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onSheetTouchStart} onTouchMove={onSheetTouchMove} onTouchEnd={onSheetTouchEnd}>
        <div className="noti-drawer-grip" />
        <div className="noti-drawer-head">
          <b><Bell size={15} /> 通知{unreadCount > 0 ? ` · ${unreadCount > 99 ? '99+' : unreadCount} 条未读` : ''}</b>
          <button className="noti-drawer-x" onClick={() => { haptic.tap(); onClose?.(); }} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="noti-drawer-body">
          {loading ? (
            <div className="noti-drawer-loading">
              <SkeletonRowAv /> <SkeletonRowAv /> <SkeletonRowAv />
            </div>
          ) : !items || items.length === 0 ? (
            <AppEmpty variant="msgs" title="暂无通知" hint="新的点赞、评论、系统消息会出现在这里" />
          ) : (
            groups.map(([label, arr]) => (
              <div key={label} className="noti-drawer-group">
                <div className="noti-drawer-glabel">{label} · {arr.length}</div>
                {arr.map(n => {
                  const Ic = iconFor(n.text);
                  return (
                    <button key={n.id} className={'noti-drawer-item' + (n.read ? '' : ' unread')}
                      onClick={() => openItem(n)}>
                      <span className="noti-drawer-ic"><Ic size={15} /></span>
                      <span className="noti-drawer-tx">
                        <span className="noti-drawer-text">{n.text}</span>
                        <span className="noti-drawer-time">{fmtRelative(n.created_at)}</span>
                      </span>
                      {!n.read && <span className="noti-drawer-dot" />}
                      {n.link && <ChevronRight size={14} className="noti-drawer-chev" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {items && items.length > 0 && (
            <div className="noti-drawer-foot">
              <button onClick={markAllRead} disabled={!(items || []).some(n => !n.read)}>
                <CheckCheck size={14} /> 全部已读
              </button>
              <button onClick={goAll}><BellOff size={14} /> 查看全部</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
