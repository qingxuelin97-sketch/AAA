import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, api } from '../api.jsx';
import { Avatar } from '../ui.jsx';
import { Logo } from '../assets.jsx';
import WelcomePopup from './WelcomePopup.jsx';
import {
  Compass, ScrollText, Users, MessageCircle, Drama, Library, Heart, Wallet,
  Bell, Settings, Sparkles, LogOut, Crown, Gem, Coins, User, Search, Megaphone, Trophy, Shield,
  BadgeCheck, PartyPopper, PanelLeftClose, PanelLeftOpen, ChevronsLeft, ChevronRight, Dices
} from 'lucide-react';

const GROUPS = [
  { title: '探索', items: [
    { to: '/', ic: Compass, label: '发现广场', end: true },
    { to: '/events', ic: PartyPopper, label: '活动' },
    { to: '/gacha', ic: Dices, label: '扭蛋机' },
    { to: '/scripts', ic: ScrollText, label: '剧本' },
    { to: '/community', ic: Users, label: '社区' },
    { to: '/leaderboard', ic: Trophy, label: '排行榜' },
    { to: '/announcements', ic: Megaphone, label: '公告' },
    { to: '/search', ic: Search, label: '搜索' }
  ] },
  { title: '互动', items: [
    { to: '/chats', ic: MessageCircle, label: '对话' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/theater', ic: Drama, label: '剧场 · 联机' }
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
  { to: '/events', ic: PartyPopper, label: '活动' },
  { to: '/community', ic: Users, label: '社区' },
  { to: '/theater', ic: Drama, label: '剧场' },
  { to: '/profile', ic: User, label: '我的' }
];

const MODE_KEY = 'huanyu_sidebar_mode';
// Sidebar has three widths: expanded (full) → collapsed (icon rail) → hidden (off-canvas).
const MODES = ['expanded', 'collapsed', 'hidden'];
function initialMode() {
  const m = localStorage.getItem(MODE_KEY);
  if (MODES.includes(m)) return m;
  return localStorage.getItem('huanyu_sidebar_collapsed') === '1' ? 'collapsed' : 'expanded'; // migrate old flag
}

export default function Layout({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [mode, setMode] = useState(initialMode);
  const [peek, setPeek] = useState('closed'); // closed | open | closing (left-edge hover reveal when hidden)
  const peekRef = useRef('closed');
  const closeTimer = useRef();
  useEffect(() => { peekRef.current = peek; }, [peek]);

  const cycle = () => setMode(m => {
    const n = m === 'expanded' ? 'collapsed' : m === 'collapsed' ? 'hidden' : 'expanded';
    localStorage.setItem(MODE_KEY, n); return n;
  });
  const openPeek = () => { clearTimeout(closeTimer.current); setPeek('open'); };
  const closePeek = () => {
    if (peekRef.current !== 'open') return;     // guard: never flash open when already closed
    clearTimeout(closeTimer.current);
    setPeek('closing');
    closeTimer.current = setTimeout(() => setPeek('closed'), 240);
  };
  // Reset when leaving hidden mode, and snap the drawer shut on navigation.
  useEffect(() => { if (mode !== 'hidden') { clearTimeout(closeTimer.current); setPeek('closed'); } }, [mode]);
  useEffect(() => { if (peekRef.current !== 'closed') { clearTimeout(closeTimer.current); setPeek('closed'); } }, [loc.pathname]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    let alive = true;
    const load = () => api('/social/notifications').then(d => alive && setUnread(d.unread)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className={'app-shell' + (mode !== 'expanded' ? ' sb-' + mode : '')}>
      <Sidebar user={user} unread={unread} mode={mode} peek={peek} cycle={cycle} onLeave={closePeek} />
      {mode === 'hidden' && peek === 'closed' && (
        <button className="sb-edge-trigger" onMouseEnter={openPeek} onClick={cycle}
          title="展开侧边栏（鼠标移入可快速预览）" aria-label="展开侧边栏">
          <ChevronRight size={16} />
        </button>
      )}
      {mode === 'hidden' && peek !== 'closed' && (
        <div className="sb-peek-backdrop" onMouseEnter={closePeek} onClick={closePeek} aria-hidden="true" />
      )}
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
      <WelcomePopup />
    </div>
  );
}

function Sidebar({ user, unread, mode, peek, cycle, onLeave }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const collapsed = mode === 'collapsed'; // icon-only rail (peek always shows full layout)
  const hidden = mode === 'hidden';
  const cls = 'sidebar'
    + (collapsed ? ' collapsed' : '')
    + (hidden ? ' hidden' : '')
    + (hidden && peek !== 'closed' ? ' peek' : '')
    + (peek === 'open' ? ' peek-open' : '')
    + (peek === 'closing' ? ' peek-closing' : '');
  const toggleTitle = mode === 'expanded' ? '收起为图标栏' : mode === 'collapsed' ? '完全隐藏（移到最左侧可唤出）' : '固定展开';
  const ToggleIcon = mode === 'expanded' ? PanelLeftClose : mode === 'collapsed' ? ChevronsLeft : PanelLeftOpen;
  return (
    <aside className={cls} onMouseLeave={hidden ? onLeave : undefined}>
      <div className="brand">
        <Logo size={36} />
        {!collapsed && <div className="brand-tx"><b>幻域</b><small>HUANYU AI</small></div>}
        <button className="sb-toggle" onClick={cycle} title={toggleTitle} aria-label="切换侧边栏宽度">
          <ToggleIcon size={18} />
        </button>
      </div>
      {!collapsed && (
        <div className="wallet-mini">
          <span className="coin gold"><Coins size={14} /> {user?.gold ?? 0}</span>
          <span className="coin diamond"><Gem size={14} /> {user?.diamond ?? 0}</span>
          {user?.svip ? <span className="svip-badge">SVIP</span> : user?.vip ? <span className="vip-badge"><Crown size={12} /> VIP</span> : null}
          {user?.verified && <span className="v-badge" title="官方认证"><BadgeCheck size={16} /></span>}
        </div>
      )}
      <div className="sb-scroll" style={{ overflowY: 'auto', flex: 1, margin: '0 -4px', padding: '0 4px' }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            {!collapsed && <div className="nav-section">{g.title}</div>}
            {collapsed && <div className="nav-divider" />}
            {g.items.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                <span className="ic"><n.ic size={18} /></span>
                {!collapsed && n.label}
                {n.badge === 'noti' && unread > 0 && <span className="nav-badge">{unread}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        {user?.is_gm && (
          <div>
            {!collapsed ? <div className="nav-section">管理</div> : <div className="nav-divider" />}
            <NavLink to="/admin" title={collapsed ? '管理后台' : undefined} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <span className="ic"><Shield size={18} /></span>{!collapsed && '管理后台'}
            </NavLink>
          </div>
        )}
      </div>
      <NavLink to="/publish" className="nav-item" title={collapsed ? '发布作品' : undefined} style={{ color: 'var(--accent)' }}>
        <span className="ic"><Sparkles size={18} /></span>{!collapsed && '发布作品'}
      </NavLink>
      <div className="sidebar-foot">
        <div className={'user-chip' + (collapsed ? ' compact' : '')} onClick={() => nav('/profile')} title={collapsed ? user?.display_name : undefined}>
          <Avatar src={user?.avatar} name={user?.display_name} size={collapsed ? 32 : 36} />
          {!collapsed && (
            <>
              <div style={{ minWidth: 0, flex: 1 }}>
                <b style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name}</b>
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>@{user?.username}</span>
              </div>
              <LogOut size={16} className="muted" onClick={(e) => { e.stopPropagation(); logout(); }} />
            </>
          )}
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
