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
import { useRealtimeEvent } from '../realtime.jsx';
import { Avatar, CoinIcon, DiamondIcon, CountUp } from '../ui.jsx';
import { Logo } from '../assets.jsx';
import CommandPalette from './CommandPalette.jsx';
import WelcomePopup from './WelcomePopup.jsx';
import { useAppGestures, tick } from '../appgestures.js';
import { fmtNum } from '../util.js';
import {
  Home, Compass, MessageCircle, Plus, X, Bell, Search,
  Sparkles, Feather, Wand2, Drama, Users, Megaphone, Trophy, Landmark,
  ScrollText, PartyPopper, Dices, Library, BookOpen, TrendingUp, Medal,
  Heart, Wallet, Settings, Shield, Crown, LogOut, Download, UserRound,
  Tags as TagsIcon, Send, RefreshCw, WifiOff, Orbit
} from 'lucide-react';

// Top-level tabs that horizontal swipe cycles through.
const SWIPE_TABS = ['/today', '/', '/messages'];

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

// Bottom tab bar — 4 destinations split around the center FAB.
const TABS_L = [
  { to: '/today', ic: Home, label: '今日', end: true },
  { to: '/', ic: Compass, label: '发现', end: true }
];
const TABS_R = [
  { to: '/messages', ic: MessageCircle, label: '消息', badge: 'msg' },
  { kind: 'grid', ic: UserRound, label: '我的' }
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
    { to: '/messages', ic: MessageCircle, label: '消息', badge: 'msg' },
    { to: '/atelier', ic: Feather, label: '小说' },
    { to: '/draw', ic: Wand2, label: 'AI 绘图' },
    { to: '/friends', ic: UserRound, label: '好友', badge: 'dm' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/theater', ic: Drama, label: '剧场' }
  ] },
  { title: '我的', items: [
    { to: '/vip', ic: Crown, label: '会员中心' },
    { to: '/library', ic: Library, label: '我的角色' },
    { to: '/worldbooks', ic: BookOpen, label: '世界书' },
    { to: '/studio', ic: TrendingUp, label: '创作中心' },
    { to: '/insights', ic: Orbit, label: '星轨' },
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
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [sheet, setSheet] = useState(null); // 'create' | 'grid' | null
  const [installEvt, setInstallEvt] = useState(null);
  const [pull, setPull] = useState(0);        // pull-to-refresh distance (px)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump → remount route → refetch
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const mainRef = useRef(null);
  const tabbarRef = useRef(null);
  const inkRef = useRef(null);
  // 启动品牌闪屏：每会话一次，尊重减弱动效 / 低端机档
  const [boot, setBoot] = useState(() => {
    try {
      return !sessionStorage.getItem('huanyu_boot_fx')
        && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        && document.documentElement.dataset.perf !== 'lite';
    } catch { return false; }
  });
  useEffect(() => {
    if (!boot) return;
    try { sessionStorage.setItem('huanyu_boot_fx', '1'); } catch { /* */ }
    const t = setTimeout(() => setBoot(false), 1250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dock「墨迹」滑块：量出活跃 tab 的位置，让指示 pill 弹性滑过去（原生质感）。
  useEffect(() => {
    const bar = tabbarRef.current, ink = inkRef.current;
    if (!bar || !ink) return;
    const place = () => {
      const act = bar.querySelector('.app-tab.active');
      if (!act) { ink.style.opacity = '0'; return; }
      ink.style.opacity = '1';
      ink.style.transform = `translateX(${act.offsetLeft}px)`;
      ink.style.width = act.offsetWidth + 'px';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [loc.pathname, sheet]);

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

  // Cold start lands on the 今日 launcher home (not the discover grid). Only the
  // very first navigation of the session is redirected, so the 发现 tab (also '/')
  // keeps working afterwards.
  const nav = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem('huanyu_app_booted')) return;
    sessionStorage.setItem('huanyu_app_booted', '1');
    if (loc.pathname === '/') nav('/today', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close any open sheet on navigation.
  useEffect(() => { setSheet(null); }, [loc.pathname]);

  // Notification / DM counts + online heartbeat。
  // SSE 已秒级推送 dm/notification 事件（见下方 useRealtimeEvent），轮询只作兜底：
  // 间隔放宽到 45s 减少电耗/流量；app 切后台时暂停，回前台立即刷新一次再恢复。
  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = () => {
      api('/social/notifications').then(d => alive && setUnread(d.unread)).catch(() => {});
      api('/dm').then(d => alive && setDmUnread(d.unread_total || 0)).catch(() => {});
      api('/social/heartbeat', { method: 'POST' }).catch(() => {});
    };
    const start = () => { if (!timer) { load(); timer = setInterval(load, 45000); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => { if (document.visibilityState === 'visible') start(); else stop(); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // 实时未读数：通知/私信到达时秒级更新角标。
  useRealtimeEvent('notification', () => setUnread(u => u + 1));
  useRealtimeEvent('dm', () => { api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {}); });
  // 进入通知中心标记全读后，角标立即清零（不等下一轮 45s 轮询）。
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener('huanyu-noti-read', clear);
    return () => window.removeEventListener('huanyu-noti-read', clear);
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

      <nav className="app-tabbar" ref={tabbarRef}>
        <span className="dock-ink" ref={inkRef} aria-hidden="true" />
        {TABS_L.map(t => <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} curPath={loc.pathname} />)}
        <button className={'app-fab' + (sheet === 'create' ? ' open' : '')} onClick={() => setSheet(s => s === 'create' ? null : 'create')} aria-label={sheet === 'create' ? '关闭' : '创建'}>
          <Plus size={24} />
          <i className="app-fab-ai" aria-hidden="true">AI</i>
        </button>
        {TABS_R.map(t => t.kind === 'grid'
          ? <button key="grid" className={'app-tab' + (sheet === 'grid' ? ' active' : '')} onClick={() => setSheet(s => s === 'grid' ? null : 'grid')}>
              <t.ic size={22} /><span>{t.label}</span>
            </button>
          : <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} curPath={loc.pathname} />)}
      </nav>

      {sheet === 'create' && <CreateSheet onClose={() => setSheet(null)} />}
      {sheet === 'grid' && (
        <LauncherGrid user={user} unread={unread} dmUnread={dmUnread}
          installEvt={installEvt} onInstall={() => { installEvt?.prompt(); installEvt?.userChoice?.finally(() => setInstallEvt(null)); }}
          onClose={() => setSheet(null)} />
      )}

      <CommandPalette />
      <WelcomePopup />
      {boot && (
        <div className="app-boot" aria-hidden="true">
          <div className="app-boot-inner">
            <span className="app-boot-logo"><Logo size={76} /></span>
            <b className="app-boot-name">幻域</b>
            <span className="app-boot-sub">与你创造的角色一同呼吸</span>
          </div>
          <span className="app-boot-star s1" /><span className="app-boot-star s2" /><span className="app-boot-star s3" />
        </div>
      )}
    </div>
  );
}

function Tab({ t, unread, dmUnread, curPath }) {
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
        {t.badge === 'msg' && unread + dmUnread > 0 && <i className="app-dot" />}
      </span>
      <span>{t.label}</span>
    </NavLink>
  );
}

function AppHeader({ user, unread }) {
  const nav = useNavigate();
  return (
    <header className="app-header">
      <button className="ahd-brand" onClick={() => nav('/today')} aria-label="今日">
        <b>幻域</b>
      </button>
      <div className="ahd-actions">
        <button onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
        <button onClick={() => nav('/notifications')} aria-label="通知" className="ahd-bell">
          <Bell size={20} />
          {unread > 0 && <span className="ahd-nb">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="ahd-coin" onClick={() => nav('/wallet')}><CoinIcon size={14} /> <CountUp value={user?.gold ?? 0} dur={700} /></button>
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
        {CREATE.map((c, i) => (
          <button key={c.to} className="app-create-row" style={{ '--i': i }} onClick={() => go(c.to)}>
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
        <button onClick={() => go('/wallet')}><CoinIcon size={15} /> {fmtNum(user?.gold)} 金币</button>
        <button onClick={() => go('/wallet')}><DiamondIcon size={15} /> {fmtNum(user?.diamond)} 钻石</button>
      </div>
      <div className="al-scroll">
        {GRID.map(g => (
          <section key={g.title} className="al-group">
            <h4>{g.title}</h4>
            <div className="al-grid">
              {g.items.map((n, i) => (
                <button key={n.to} className="al-cell" style={{ '--i': i }} onClick={() => go(n.to)}>
                  <span className="al-cell-ic">
                    <n.ic size={22} />
                    {n.badge === 'noti' && unread > 0 && <i className="app-dot" />}
                    {n.badge === 'dm' && dmUnread > 0 && <i className="app-dot" />}
                    {n.badge === 'msg' && unread + dmUnread > 0 && <i className="app-dot" />}
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
