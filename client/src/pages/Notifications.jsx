import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { Bell, Heart, MessageCircle, Gift, Megaphone, Landmark, CheckCheck, Sparkles } from 'lucide-react';

// Infer an icon + accent from the notification text (no schema change needed).
function iconFor(text) {
  const t = text || '';
  if (/赞|喜欢|收藏/.test(t)) return ['like', Heart];
  if (/评论|议论|回复/.test(t)) return ['cmt', MessageCircle];
  if (/赠送|奖励|金币|钻石|领取/.test(t)) return ['gift', Gift];
  if (/议会|议员|提案|决议|表决|休会/.test(t)) return ['gov', Landmark];
  if (/广播|📢|公告|活动/.test(t)) return ['sys', Megaphone];
  if (/欢迎|新手/.test(t)) return ['welcome', Sparkles];
  return ['default', Bell];
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    api('/social/notifications')
      .then(d => { if (alive) setItems(d.notifications || []); }) // snapshot keeps original read flags this session
      .catch(e => toast(e.message, 'err'))
      .finally(() => { if (alive) setLoading(false); });
    api('/social/notifications/read', { method: 'POST' })
      // 通知壳层（Layout / AppLayout）立即清零角标，不用等下一轮轮询
      .then(() => { try { window.dispatchEvent(new Event('huanyu-noti-read')); } catch { /* */ } })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, []);

  const unreadCount = useMemo(() => items.filter(n => !n.read).length, [items]);
  const shown = useMemo(() => tab === 'unread' ? items.filter(n => !n.read) : items, [items, tab]);
  const fmtDate = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>通知中心</h1>
          <div className="sub">点赞、评论、议会与系统消息都在这里</div>
        </div>
        {unreadCount > 0 && <span className="noti-allread"><CheckCheck size={15} /> 已全部标记为已读</span>}
      </div>

      <div className="page" style={{ maxWidth: 760 }}>
        <div className="seg seg-3" style={{ marginBottom: 16, maxWidth: 280 }}>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部 {items.length > 0 && `(${items.length})`}</button>
          <button className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>未读 {unreadCount > 0 && `(${unreadCount})`}</button>
        </div>

        {loading ? (
          <div className="empty">载入中…</div>
        ) : shown.length === 0 ? (
          <div className="empty"><EmptyArt kind="notifications" />{tab === 'unread' ? '没有未读通知' : '暂时没有新通知'}</div>
        ) : (
          <div className="noti-list">
            {shown.map(n => {
              const [kind, Ic] = iconFor(n.text);
              return (
                <div key={n.id} className={'noti-item ' + kind + (n.read ? '' : ' unread')}
                  onClick={() => n.link && nav(n.link)} style={{ cursor: n.link ? 'pointer' : 'default' }}>
                  <span className="noti-ic"><Ic size={17} /></span>
                  <div className="noti-tx">
                    <div className="noti-body">{n.text}</div>
                    <div className="noti-time">{fmtDate(n.created_at)}</div>
                  </div>
                  {!n.read && <span className="noti-dot" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
