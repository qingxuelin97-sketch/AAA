import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth, api } from '../api.jsx';
import { Avatar } from '../ui.jsx';
import { Logo } from '../assets.jsx';
import {
  Compass, ScrollText, Users, MessageCircle, Drama, Library, Heart, Wallet,
  Bell, Settings, Sparkles, LogOut, Crown, Gem, Coins, User, Search
} from 'lucide-react';

const GROUPS = [
  { title: '探索', items: [
    { to: '/', ic: Compass, label: '发现广场', end: true },
    { to: '/scripts', ic: ScrollText, label: '剧本' },
    { to: '/community', ic: Users, label: '社区' },
    { to: '/search', ic: Search, label: '搜索' }
  ] },
  { title: '互动', items: [
    { to: '/chats', ic: MessageCircle, label: '对话' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/theater', ic: Drama, label: '剧场' }
  ] },
  { title: '我的', items: [
    { to: '/library', ic: Library, label: '我的角色' },
    { to: '/favorites', ic: Heart, label: '收藏' },
    { to: '/wallet', ic: Wallet, label: '钱包 / 充值' },
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ] }
];

const TABS = [
  { to: '/', ic: Compass, label: '发现', end: true },
  { to: '/scripts', ic: ScrollText, label: '剧本' },
  { to: '/community', ic: Users, label: '社区' },
  { to: '/theater', ic: Drama, label: '剧场' },
  { to: '/profile', ic: User, label: '我的' }
];

export default function Layout({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api('/social/notifications').then(d => alive && setUnread(d.unread)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar user={user} unread={unread} />
      <MobileTop user={user} unread={unread} />
      <main className="main">{children}</main>
      <nav className="bottom-nav">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => isActive ? 'active' : ''}>
            <t.ic size={21} />
            <span>{t.label}</span>
            {t.to === '/profile' && unread > 0 && <span className="nb">{unread}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Sidebar({ user, unread }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={38} />
        <div><b>幻域</b><small>HUANYU AI</small></div>
      </div>
      <div className="wallet-mini">
        <span className="coin gold"><Coins size={14} /> {user?.gold ?? 0}</span>
        <span className="coin diamond"><Gem size={14} /> {user?.diamond ?? 0}</span>
        {user?.vip && <span className="vip-badge"><Crown size={12} /> VIP</span>}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, margin: '0 -4px', padding: '0 4px' }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            <div className="nav-section">{g.title}</div>
            {g.items.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                <span className="ic"><n.ic size={18} /></span>{n.label}
                {n.badge === 'noti' && unread > 0 && <span className="nav-badge">{unread}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <NavLink to="/publish" className="nav-item" style={{ color: 'var(--accent)' }}>
        <span className="ic"><Sparkles size={18} /></span>发布作品
      </NavLink>
      <div className="sidebar-foot">
        <div className="user-chip" onClick={() => nav('/profile')}>
          <Avatar src={user?.avatar} name={user?.display_name} size={36} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name}</b>
            <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>@{user?.username}</span>
          </div>
          <LogOut size={16} className="muted" onClick={(e) => { e.stopPropagation(); logout(); }} />
        </div>
      </div>
    </aside>
  );
}

function MobileTop({ user, unread }) {
  const nav = useNavigate();
  return (
    <div className="mobile-topbar mobile-only">
      <Logo size={30} radius={9} />
      <b style={{ fontSize: 17, flex: 1 }}>幻域</b>
      <span className="coin gold" onClick={() => nav('/wallet')}><Coins size={13} /> {user?.gold ?? 0}</span>
      <Search size={20} onClick={() => nav('/search')} />
      <div style={{ position: 'relative' }} onClick={() => nav('/notifications')}>
        <Bell size={20} />
        {unread > 0 && <span className="nb" style={{ position: 'absolute', top: -4, right: -6 }}>{unread}</span>}
      </div>
    </div>
  );
}
