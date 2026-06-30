// AppLayout — the dedicated *native app* shell (game-launcher flavour), used in
// place of the web Layout whenever isAppMode() is true (Capacitor app, or the
// `?app=1` browser preview). It is deliberately NOT the mobile-web chrome:
//   · no browser-style top bar / hamburger drawer
//   · a bottom tab bar with a raised center "create" FAB
//   · a full-screen 九宫格 launcher ("更多") replacing the drawer
//   · safe-area aware, phone-framed on wide screens for preview
// Content pages are reused as-is; only the chrome differs.
import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, api } from '../api.jsx';
import { Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import CommandPalette from './CommandPalette.jsx';
import WelcomePopup from './WelcomePopup.jsx';
import { useAppGestures, tick } from '../appgestures.js';
import {
  Home, Compass, MessageCircle, Plus, LayoutGrid, X, Bell, Search,
  Sparkles, Feather, Wand2, Drama, Users, Megaphone, Trophy, Landmark,
  ScrollText, PartyPopper, Dices, Library, BookOpen, TrendingUp, Medal,
  Heart, Wallet, Settings, Shield, Crown, LogOut, Download, UserRound,
  Tags as TagsIcon, Send, RefreshCw, WifiOff
} from 'lucide-react';

// Top-level tabs that horizontal swipe cycles through (visual left-to-right order).
// 发现 itself is a vertical scroll-snap feed and is excluded from horizontal
// tab-swipe (see appgestures NO_SWIPE), so in practice this connects 今日 ⇆ 对话.
const SWIPE_TABS = ['/', '/today', '/chats'];

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

// Bottom tab bar — 4 destinations split around the center FAB. 发现 (the immersive
// feed) is the home/first tab and the cold-start landing surface; 今日 is the
// personal hub (check-in / continue / tasks).
const TABS_L = [
  { to: '/', ic: Compass, label: '发现', end: true },
  { to: '/today', ic: Home, label: '今日', end: true, badge: 'checkin' }
];
const TABS_R = [
  { to: '/chats', ic: MessageCircle, label: '对话', badge: 'dm' },
  { kind: 'grid', ic: LayoutGrid, label: '更多' }
];

// FAB create-sheet actions.
const CREATE = [
  { to: '/character/new', ic: Sparkles, label: '创建角色', hint: '立绘 · 人设 · 世界书' },
  { to: '/atelier', ic: Feather, label: '写小说', hint: 'AI 协作长篇创作' },
  { to: '/draw', ic: Wand2, label: 'AI 绘图', hint: '文生图工作室' },
  { to: '/theater', ic: Drama, label: '开剧场', hint: '多人多 AI 即兴演出' },
  { to: '/publish', ic: Send, label: '发布作品', hint: '角色 / 剧本 / 动态' }
];

// 九宫格 launcher — every section, grouped (replaces the web hamburger drawer).
const GRID = [
  { title: '探索', items: [
    { to: '/', ic: Compass, label: '发现', end: true },
    { to: '/events', ic: PartyPopper, label: '活动' },
    { to: '/gacha', ic: Dices, label: '扭蛋机' },
    { to: '/scripts', ic: ScrollText, label: '剧本' },
    { to: '/community', ic: Users, label: '社区' },
    { to: '/leaderboard', ic: Trophy, label: '排行榜' },
    { to: '/parliament', ic: Landmark, label: '议会' },
    { to: '/announcements', ic: Megaphone, label: '公告' },
    { to: '/tags', ic: TagsIcon, label: '标签' }
  ] },
  { title: '互动', items: [
    { to: '/chats', ic: MessageCircle, label: '对话' },
    { to: '/atelier', ic: Feather, label: '小说' },
    { to: '/draw', ic: Wand2, label: 'AI 绘图' },
    { to: '/friends', ic: UserRound, label: '好友', badge: 'dm' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/theater', ic: Drama, label: '剧场' }
  ] },
  { title: '我的', items: [
    { to: '/library', ic: Library, label: '我的角色' },
    { to: '/worldbooks', ic: BookOpen, label: '世界书' },
    { to: '/studio', ic: TrendingUp, label: '创作中心' },
    { to: '/achievements', ic: Medal, label: '成就' },
    { to: '/favorites', ic: Heart, label: '收藏' },
    { to: '/wallet', ic: Wallet, label: '钱包' },
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ] }
];

export default function AppLayout({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  // Gentle nudge: a dot on the 今日 tab while today's check-in is still unclaimed
  // (cheap retention cue now that 今日 is no longer the cold-start surface).
  const needCheckin = !!user && user.last_checkin !== new Date().toISOString().slice(0, 10);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [sheet, setSheet] = useState(null); // 'create' | 'grid' | null
  const [installEvt, setInstallEvt] = useState(null);
  const [pull, setPull] = useState(0);        // pull-to-refresh distance (px)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump → remount route → refetch
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const mainRef = useRef(null);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('beforeinstallprompt', h);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Cold start lands on 发现 (the immersive feed = the default '/' route) for
  // instant immersion — no redirect needed; 今日 is now a deliberate tab tap.
  const nav = useNavigate();

  // Close any open sheet on navigation.
  useEffect(() => { setSheet(null); }, [loc.pathname]);

  // Notification / DM counts + online heartbeat (same cadence as the web shell).
  useEffect(() => {
    let alive = true;
    const load = () => {
      api('/social/notifications').then(d => alive && setUnread(d.unread)).catch(() => {});
      api('/dm').then(d => alive && setDmUnread(d.unread_total || 0)).catch(() => {});
      api('/social/heartbeat', { method: 'POST' }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Gestures: swipe between top tabs, left-edge swipe-back, pull-to-refresh.
  const swipeGo = (dir) => {
    const i = SWIPE_TABS.indexOf(loc.pathname);
    if (i < 0) return;                 // only the swipeable top-levels respond
    const n = i + dir;
    if (n < 0 || n >= SWIPE_TABS.length) return;
    tick(); nav(SWIPE_TABS[n], { viewTransition: true });
  };
  const doRefresh = () => {
    if (refreshing) return;
    tick(12); setRefreshing(true);
    setRefreshKey(k => k + 1);          // remount current route → its effects refetch
    setTimeout(() => { setRefreshing(false); setPull(0); }, 720);
  };
  useAppGestures(mainRef, {
    onNext: () => swipeGo(1),
    onPrev: () => swipeGo(-1),
    onBack: () => { if (window.history.length > 1) { tick(); window.history.back(); } },
    onPullMove: (px) => { if (!refreshing) setPull(px); },
    onPullEnd: (ok) => { if (ok) doRefresh(); else setPull(0); }
  });

  const ptr = refreshing ? 56 : pull;

  return (
    <div className="app-root">
      <AppHeader user={user} unread={unread} />
      {offline && <div className="app-offline" role="status"><WifiOff size={13} /> 网络已断开，正在使用离线内容</div>}
      <div className={'app-ptr' + (refreshing ? ' spin' : '')} style={{ height: ptr, opacity: ptr ? 1 : 0 }} aria-hidden="true">
        <RefreshCw size={20} style={{ transform: refreshing ? 'none' : `rotate(${ptr * 3}deg)` }} />
      </div>
      <main className="app-main" ref={mainRef}
        style={pull && !refreshing ? { transform: `translateY(${Math.min(pull, 90)}px)`, transition: 'none' } : undefined}>
        <div className="route-fade" key={loc.pathname + '#' + refreshKey}>{children}</div>
      </main>

      <nav className="app-tabbar">
        {TABS_L.map(t => <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} needCheckin={needCheckin} curPath={loc.pathname} />)}
        <button className="app-fab" onClick={() => setSheet(s => s === 'create' ? null : 'create')} aria-label="创建">
          <Plus size={26} />
        </button>
        {TABS_R.map(t => t.kind === 'grid'
          ? <button key="grid" className={'app-tab' + (sheet === 'grid' ? ' active' : '')} onClick={() => setSheet(s => s === 'grid' ? null : 'grid')}>
              <t.ic size={22} /><span>{t.label}</span>
            </button>
          : <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} needCheckin={needCheckin} curPath={loc.pathname} />)}
      </nav>

      {sheet === 'create' && <CreateSheet onClose={() => setSheet(null)} />}
      {sheet === 'grid' && (
        <LauncherGrid user={user} unread={unread} dmUnread={dmUnread}
          installEvt={installEvt} onInstall={() => { installEvt?.prompt(); installEvt?.userChoice?.finally(() => setInstallEvt(null)); }}
          onClose={() => setSheet(null)} />
      )}

      <CommandPalette />
      <WelcomePopup />
    </div>
  );
}

function Tab({ t, unread, dmUnread, needCheckin, curPath }) {
  // Tapping the already-active tab scrolls the page back to the top (native pattern).
  const onClick = (e) => {
    if (curPath === t.to) { e.preventDefault(); tick(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  return (
    <NavLink to={t.to} end={t.end} viewTransition onClick={onClick} className={({ isActive }) => 'app-tab' + (isActive ? ' active' : '')}>
      <span className="app-tab-ic">
        <t.ic size={22} />
        {t.badge === 'noti' && unread > 0 && <i className="app-dot" />}
        {t.badge === 'dm' && dmUnread > 0 && <i className="app-dot" />}
        {t.badge === 'checkin' && needCheckin && <i className="app-dot" />}
      </span>
      <span>{t.label}</span>
    </NavLink>
  );
}

function AppHeader({ user, unread }) {
  const nav = useNavigate();
  return (
    <header className="app-header">
      <button className="ahd-brand" onClick={() => nav('/')} aria-label="发现">
        <b>幻域</b>
      </button>
      <div className="ahd-actions">
        <button onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
        <button onClick={() => nav('/notifications')} aria-label="通知" className="ahd-bell">
          <Bell size={20} />
          {unread > 0 && <span className="ahd-nb">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="ahd-coin" onClick={() => nav('/wallet')}><CoinIcon size={14} /> {user?.gold ?? 0}</button>
      </div>
    </header>
  );
}

function CreateSheet({ onClose }) {
  const nav = useNavigate();
  const go = (to) => { nav(to, { viewTransition: true }); onClose(); };
  return (
    <div className="app-sheet-mask" onClick={onClose}>
      <div className="app-sheet" onClick={e => e.stopPropagation()}>
        <div className="app-sheet-grip" />
        <h3 className="app-sheet-title">想创作点什么？</h3>
        {CREATE.map(c => (
          <button key={c.to} className="app-create-row" onClick={() => go(c.to)}>
            <span className="ac-ic"><c.ic size={20} /></span>
            <span className="ac-tx"><b>{c.label}</b><small>{c.hint}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LauncherGrid({ user, unread, dmUnread, onClose, installEvt, onInstall }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const go = (to) => { nav(to, { viewTransition: true }); onClose(); };
  return (
    <div className="app-launcher">
      <div className="app-launcher-top">
        <button className="al-user" onClick={() => go('/profile')}>
          <Avatar src={user?.avatar} name={user?.display_name} size={48} />
          <div className="al-user-tx">
            <b>{user?.display_name}</b>
            <span>@{user?.username}</span>
          </div>
          {user?.svip ? <span className="ah-tier svip">SVIP</span> : user?.vip ? <span className="ah-tier vip"><Crown size={12} /> VIP</span> : null}
        </button>
        <button className="al-x" onClick={onClose} aria-label="关闭"><X size={22} /></button>
      </div>
      <div className="al-wallet">
        <button onClick={() => go('/wallet')}><CoinIcon size={15} /> {user?.gold ?? 0} 金币</button>
        <button onClick={() => go('/wallet')}><DiamondIcon size={15} /> {user?.diamond ?? 0} 钻石</button>
      </div>
      <div className="al-scroll">
        {GRID.map(g => (
          <section key={g.title} className="al-group">
            <h4>{g.title}</h4>
            <div className="al-grid">
              {g.items.map(n => (
                <button key={n.to} className="al-cell" onClick={() => go(n.to)}>
                  <span className="al-cell-ic">
                    <n.ic size={22} />
                    {n.badge === 'noti' && unread > 0 && <i className="app-dot" />}
                    {n.badge === 'dm' && dmUnread > 0 && <i className="app-dot" />}
                  </span>
                  <span>{n.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {user?.is_gm && (
          <section className="al-group">
            <h4>管理</h4>
            <div className="al-grid">
              <button className="al-cell" onClick={() => go('/admin')}><span className="al-cell-ic"><Shield size={22} /></span><span>管理后台</span></button>
            </div>
          </section>
        )}
        <div className="al-foot">
          {installEvt && <button className="al-foot-btn" onClick={() => { onInstall(); onClose(); }}><Download size={17} /> 安装到桌面</button>}
          <button className="al-foot-btn danger" onClick={() => { logout(); onClose(); }}><LogOut size={17} /> 退出登录</button>
        </div>
      </div>
    </div>
  );
}
