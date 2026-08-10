import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { ArrowLeft, Bell, Heart, MessageCircle, Gift, Megaphone, Landmark, CheckCheck, Sparkles, RefreshCw } from 'lucide-react';
import AppErrorState from '../components/AppErrorState.jsx';

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
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('all');
  const toast = useToast();
  const nav = useNavigate();
  const appMode = isAppMode();
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const load = () => {
    setLoading(true);
    setLoadError('');
    api('/social/notifications')
      .then(d => { if (aliveRef.current) setItems(d.notifications || []); }) // snapshot keeps original read flags this session
      .catch(e => { if (aliveRef.current) setLoadError(e.message || '通知载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
  };

  useEffect(() => {
    load();
    api('/social/notifications/read', { method: 'POST' })
      // 通知壳层（Layout / AppLayout）立即清零角标，不用等下一轮轮询
      .then(() => { try { window.dispatchEvent(new Event('huanyu-noti-read')); } catch { /* */ } })
      .catch(() => { /* ignore */ });
    /* eslint-disable-next-line */
  }, []);

  const unreadCount = useMemo(() => items.filter(n => !n.read).length, [items]);
  const shown = useMemo(() => tab === 'unread' ? items.filter(n => !n.read) : items, [items, tab]);
  const fmtDate = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');
  // 按「今天 / 本周 / 更早」分组（一线消息中心范式）：时间语义一眼可辨。
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = new Date(today.getTime() - 6 * 86400e3);
    const g = { today: [], week: [], earlier: [] };
    for (const n of shown) {
      const t = n.created_at ? new Date(String(n.created_at).replace(' ', 'T')) : null;
      if (t && t >= today) g.today.push(n);
      else if (t && t >= week) g.week.push(n);
      else g.earlier.push(n);
    }
    return [['今天', g.today], ['本周', g.week], ['更早', g.earlier]].filter(([, arr]) => arr.length);
  }, [shown]);

  const Root = appMode ? 'main' : React.Fragment;
  const rootProps = appMode ? { className: 'qa-notifications' } : {};

  return (
    <Root {...rootProps}>
      {appMode ? (
        <header className="qa-notifications-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-notifications-title">
            <h1>通知中心</h1>
            <span>{unreadCount > 0 ? `${unreadCount} 条未读` : '已经全部读完'}</span>
          </div>
          <span className="qa-notifications-read" aria-label="通知已自动标为已读"><CheckCheck size={19} /></span>
        </header>
      ) : (
        <div className="topbar">
          <div style={{ flex: 1 }}>
            <h1>通知中心</h1>
            <div className="sub">点赞、评论、议会与系统消息都在这里</div>
          </div>
          {unreadCount > 0 && <span className="noti-allread"><CheckCheck size={15} /> 已全部标记为已读</span>}
        </div>
      )}

      <div className="page" style={{ maxWidth: 760 }}>
        <div className="seg seg-3" role={appMode ? 'tablist' : undefined} aria-label={appMode ? '通知筛选' : undefined} style={{ marginBottom: 16, maxWidth: 280 }}>
          <AppButton className={tab === 'all' ? 'active' : ''} selected={tab === 'all'} role={appMode ? 'tab' : undefined} aria-selected={appMode ? tab === 'all' : undefined} onClick={() => setTab('all')}>全部 {items.length > 0 && `(${items.length})`}</AppButton>
          <AppButton className={tab === 'unread' ? 'active' : ''} selected={tab === 'unread'} role={appMode ? 'tab' : undefined} aria-selected={appMode ? tab === 'unread' : undefined} onClick={() => setTab('unread')}>未读 {unreadCount > 0 && `(${unreadCount})`}</AppButton>
        </div>

        {loading ? (
          /* 骨架屏：三行占位微光，避免「载入中…」文本闪一下的毛坯感 */
          <div className="noti-list" aria-hidden="true">
            {[64, 64, 64].map((h, i) => <div key={i} className="skel" style={{ height: h, marginBottom: 10 }} />)}
          </div>
        ) : loadError && items.length === 0 ? (
          app ? (
            <AppErrorState kind="notifications" title="通知暂时无法载入" message={loadError} onRetry={() => load()} />
          ) : (
            <div className="empty lgw-error" role="alert">
              <span className="lgw-error-ic"><RefreshCw size={22} /></span>
              <h2 className="lgw-error-title">通知暂时无法载入</h2>
              <p className="lgw-error-msg">{loadError}</p>
              <button className="btn primary lgw-error-retry" onClick={() => load()}><RefreshCw size={15} /> 重新载入</button>
            </div>
          )
        ) : shown.length === 0 ? (
          appMode
            ? <div className="empty"><EmptyArt kind="notifications" />{tab === 'unread' ? '没有未读通知' : '暂时没有新通知'}</div>
            : (
              <div className="empty lgw-empty">
                <EmptyArt kind="notifications" />
                <h2 className="lgw-empty-title">{tab === 'unread' ? '没有未读通知' : '暂时没有新通知'}</h2>
                <p className="lgw-empty-sub">有人点赞、评论或系统发放奖励时，会第一时间出现在这里。</p>
                <div className="lgw-empty-cta">
                  <button className="btn primary" onClick={() => nav('/')}>去发现广场逛逛</button>
                </div>
              </div>
            )
        ) : (
          /* stagger-in：通知行依次浮现（app-motion 层，lite/reduced-motion 自动退化） */
          <div className="noti-list stagger-in">
            {groups.map(([label, arr]) => (
              <React.Fragment key={label}>
                <div className="noti-group">{label}</div>
                {arr.map(n => {
                  const [kind, Ic] = iconFor(n.text);
                  const Row = appMode && n.link ? 'button' : 'div';
                  return (
                    <Row key={n.id} type={Row === 'button' ? 'button' : undefined} className={'noti-item pressable ' + kind + (n.read ? '' : ' unread')}
                      onClick={() => n.link && nav(n.link)} style={{ cursor: n.link ? 'pointer' : 'default' }}>
                      <span className="noti-ic"><Ic size={17} /></span>
                      <div className="noti-tx">
                        <div className="noti-body">{n.text}</div>
                        <div className="noti-time">{fmtDate(n.created_at)}</div>
                      </div>
                      {!n.read && <span className="noti-dot pulse-dot" />}
                    </Row>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </Root>
  );
}
