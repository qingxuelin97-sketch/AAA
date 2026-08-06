import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import FramedAvatar from './FramedAvatar.jsx';
import { Logo } from '../assets.jsx';
import { fmtNum, msgPreview } from '../util.js';
import { useCheckin } from '../pages/home/shared.js';
import WelcomePopup from './WelcomePopup.jsx';
import CommandPalette from './CommandPalette.jsx';
import ScrollChrome from './ScrollChrome.jsx';
import QuickCreate from './QuickCreate.jsx';
import {
  Compass, ScrollText, Users, MessageCircle, Drama, Library, Heart, Wallet,
  Bell, Settings, Sparkles, LogOut, Crown, User, Search, Megaphone, Trophy, Shield,
  BadgeCheck, PartyPopper, PanelLeftClose, PanelLeftOpen, ChevronsLeft, ChevronRight, Dices, Menu, X, TrendingUp, Download, Landmark, UserRound, Wand2, Medal, Tags as TagsIcon, BookOpen, Feather, Orbit, Telescope, MessagesSquare, WifiOff, Gift, Check
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

// ── 桌面双段式导航（D1）──────────────────────────────────────────────────
// NAV_PRIMARY：侧栏第一段常驻的 7 个高频入口；NAV_MORE：折入「更多」的三组
// 长尾。条目/图标/文案全部自旧三组 GROUPS 原样搬运，一条不丢。
const NAV_PRIMARY = [
  { to: '/', ic: Compass, label: '发现广场', end: true },
  { to: '/discover', ic: Telescope, label: '沉浸发现' },
  { to: '/messages', ic: MessagesSquare, label: '消息中心', badge: 'dm' },
  { to: '/scripts', ic: ScrollText, label: '剧本' },
  { to: '/theater', ic: Drama, label: '互动小说' },
  { to: '/community', ic: Users, label: '社区' },
  { to: '/library', ic: Library, label: '我的角色' }
];
const NAV_MORE = [
  { title: '探索', items: [
    { to: '/events', ic: PartyPopper, label: '活动' },
    { to: '/gacha', ic: Dices, label: '幸运转盘' },
    { to: '/leaderboard', ic: Trophy, label: '排行榜' },
    { to: '/parliament', ic: Landmark, label: '议会' },
    { to: '/announcements', ic: Megaphone, label: '公告' },
    { to: '/search', ic: Search, label: '搜索' },
    { to: '/tags', ic: TagsIcon, label: '标签广场' }
  ] },
  { title: '互动', items: [
    { to: '/chats', ic: MessageCircle, label: '对话' },
    { to: '/atelier', ic: Feather, label: '小说创作' },
    { to: '/draw', ic: Wand2, label: 'AI 绘图' },
    { to: '/friends', ic: UserRound, label: '好友', badge: 'dm' },
    { to: '/groups', ic: Users, label: '群聊' }
  ] },
  { title: '我的', items: [
    { to: '/worldbooks', ic: BookOpen, label: '世界书' },
    { to: '/studio', ic: TrendingUp, label: '创作中心' },
    { to: '/insights', ic: Orbit, label: '星轨' },
    { to: '/achievements', ic: Medal, label: '成就' },
    { to: '/favorites', ic: Heart, label: '收藏' },
    { to: '/wallet', ic: Wallet, label: '钱包 / 充值' },
    { to: '/vip', ic: Crown, label: '会员中心' },
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ] }
];
// GROUPS 仅供移动抽屉（MobileNav）消费——全量条目行为不变。
const GROUPS = [{ title: '导航', items: NAV_PRIMARY }, ...NAV_MORE];

const TABS = [
  { to: '/', ic: Compass, label: '发现', end: true },
  { to: '/events', ic: PartyPopper, label: '活动' },
  { to: '/community', ic: Users, label: '社区' },
  { to: '/theater', ic: Drama, label: '互动小说' },
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
  const [dmUnread, setDmUnread] = useState(0);
  const [mode, setMode] = useState(initialMode);
  const [peek, setPeek] = useState('closed'); // closed | open | closing (left-edge hover reveal when hidden)
  const [mobileNav, setMobileNav] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const [convs, setConvs] = useState([]); // 桌面侧栏「最近对话」（前 8 条）
  const peekRef = useRef('closed');
  const userRef = useRef(user);
  const prevPathRef = useRef(loc.pathname);
  const closeTimer = useRef();
  const bnRef = useRef(null);
  const bnInkRef = useRef(null);
  // Web 离线提示条（对偶 AppLayout 的 .app-offline）：online/offline 事件驱动，
  // 断网常驻、恢复自动消失。Layout 仅在 !isAppMode() 下渲染，App 壳零波及。
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // 底栏「墨迹」滑块：量出活跃 tab 位置，让指示 pill 弹性滑过去（与 App dock 同款）。
  useEffect(() => {
    const bar = bnRef.current, ink = bnInkRef.current;
    if (!bar || !ink) return;
    const place = () => {
      const act = bar.querySelector('a.active');
      if (!act) { ink.style.opacity = '0'; return; }
      ink.style.opacity = '1';
      ink.style.transform = `translateX(${act.offsetLeft}px)`;
      ink.style.width = act.offsetWidth + 'px';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [loc.pathname]);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const doInstall = () => { if (!installEvt) return; installEvt.prompt(); installEvt.userChoice.finally(() => setInstallEvt(null)); };
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
  useEffect(() => { if (peekRef.current !== 'closed') { clearTimeout(closeTimer.current); setPeek('closed'); } setMobileNav(false); }, [loc.pathname]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // 侧栏「最近对话」数据源：GET /chat/conversations 截前 8 条。
  // 注意：单聊没有 realtime 事件可订阅，消息到达的秒级刷新需要服务端广播，
  // 暂靠 20s 轮询 + 窗口 focus + 离开 /chats/* 路由三个时机兜住。
  const loadConvs = useCallback(() => {
    if (!userRef.current) return;                                  // 未登录不请求
    if (!window.matchMedia('(min-width:1024px)').matches) return;  // 移动端侧栏不显示，省一趟
    api('/chat/conversations').then(d => setConvs((d.conversations || []).slice(0, 8))).catch(() => {});
  }, []);
  // 登录态变化：登录后立即拉一次（不等下个轮询），登出即清空。
  useEffect(() => {
    const had = userRef.current;
    userRef.current = user;
    if (!had && user) loadConvs();
    if (had && !user) setConvs([]);
  }, [user, loadConvs]);
  useEffect(() => {
    window.addEventListener('focus', loadConvs);
    return () => window.removeEventListener('focus', loadConvs);
  }, [loadConvs]);
  // 从某个对话页离开（含切去别的对话）时立即刷新预览，让最后一句跟上。
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = loc.pathname;
    if (prev !== loc.pathname && prev.startsWith('/chats/')) loadConvs();
  }, [loc.pathname, loadConvs]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api('/social/notifications').then(d => alive && setUnread(d.unread)).catch(() => {});
      api('/dm').then(d => alive && setDmUnread(d.unread_total || 0)).catch(() => {});
      api('/social/heartbeat', { method: 'POST' }).catch(() => {}); // 在线心跳
      loadConvs(); // 最近对话并入同一节拍
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [loadConvs]);

  // 实时未读数：通知/私信到达时秒级更新角标，无需等 20s 轮询。
  useRealtimeEvent('notification', () => setUnread(u => u + 1));
  useRealtimeEvent('dm', () => { api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {}); });
  // 进入通知中心标记全读后，角标立即清零。
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener('huanyu-noti-read', clear);
    return () => window.removeEventListener('huanyu-noti-read', clear);
  }, []);

  // Scroll-reveal — section-level surfaces elegantly rise in as they enter the
  // viewport (not just on first paint). JS-only opt-in, so no-JS/reduced-motion
  // users see everything immediately. A MutationObserver re-scans on route change.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Skip the whole scroll-reveal machinery on the lite tier — the observers
    // and re-scans aren't worth the cost on weak devices (content just shows).
    if (document.documentElement.dataset.perf === 'lite') return;
    const SEL = '.section-title, .chart-card, .rev-hero, .rev-tiers, .daily-strip, .resume-rail, .adm-stat, .pkg, .ann-banner, .lb-podium';
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { e.target.classList.add('reveal-in'); io.unobserve(e.target); }
    }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });
    let i = 0;
    const scan = () => {
      i = 0;
      document.querySelectorAll(SEL).forEach(el => {
        if (el.dataset.rv) return;
        el.dataset.rv = '1';
        el.style.setProperty('--rv-i', (i++ % 6));
        el.classList.add('reveal');
        io.observe(el);
      });
    };
    scan();
    // Re-scan on DOM changes, but debounced — streaming chat / live feeds mutate
    // the tree dozens of times a second, and a full querySelectorAll per frame
    // is a real jank source. A trailing 200ms timer coalesces bursts into one
    // scan once the DOM settles.
    const root = document.querySelector('.main') || document.body;
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 200); };
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <div className={'app-shell' + (mode !== 'expanded' ? ' sb-' + mode : '')}>
      <Sidebar user={user} unread={unread} dmUnread={dmUnread} convs={convs} mode={mode} peek={peek} cycle={cycle} onLeave={closePeek} />
      {mode === 'hidden' && peek === 'closed' && (
        <button className="sb-edge-trigger" onMouseEnter={openPeek} onClick={cycle}
          title="展开侧边栏（鼠标移入可快速预览）" aria-label="展开侧边栏">
          <ChevronRight size={16} />
        </button>
      )}
      {mode === 'hidden' && peek !== 'closed' && (
        <div className="sb-peek-backdrop" onMouseEnter={closePeek} onClick={closePeek} aria-hidden="true" />
      )}
      <MobileTop user={user} unread={unread} onMenu={() => setMobileNav(true)} />
      {mobileNav && <MobileNav user={user} unread={unread} dmUnread={dmUnread} onClose={() => setMobileNav(false)} installEvt={installEvt} doInstall={doInstall} />}
      <main className="main">
        <ScrollChrome />
        {/* 离线细条：桌面贴 .main 顶（sticky），移动端在顶栏下随流；样式见 web-lumen-misc.css */}
        {offline && (
          <div className="lgw-offline" role="status">
            <WifiOff size={14} aria-hidden="true" />
            <span>网络已断开，操作会在恢复后重试</span>
          </div>
        )}
        <div className="route-fade" key={loc.pathname}>{children}</div>
      </main>
      <CommandPalette />
      <QuickCreate />
      <nav className="bottom-nav" ref={bnRef}>
        <span className="bn-ink" ref={bnInkRef} aria-hidden="true" />
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} viewTransition className={({ isActive }) => isActive ? 'active' : ''}>
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

// 迷你签到钮：挂在 wallet-mini 行尾，吃 useCheckin 的三态（可签 / busy / 已签）。
function CheckinMini() {
  const { checked, streak, busy, checkin } = useCheckin();
  const label = checked ? `已连签 ${streak} 天` : '签到领金币';
  return (
    <button
      className={'sb-checkin' + (checked ? ' done' : '')}
      disabled={busy || checked}
      onClick={checkin}
      title={label}
      aria-label={label}
    >
      {checked ? <Check size={15} /> : <Gift size={15} />}
    </button>
  );
}

// 侧栏「最近对话」列表。数据由 Layout 注入（无单聊 realtime 事件，秒级刷新
// 需服务端广播支持，暂靠轮询/focus/路由回流三个时机，见 Layout.loadConvs）。
// 空列表时整段隐藏；collapsed 态只渲染前 5 个 32px 头像。
function SidebarChats({ convs, collapsed }) {
  if (!convs?.length) return null;
  if (collapsed) {
    return (
      <div className="sbc-rail">
        <div className="nav-divider" />
        {convs.slice(0, 5).map(cv => (
          <NavLink key={cv.id} to={'/chats/' + cv.id} viewTransition title={cv.character_name}
            className={({ isActive }) => 'sbc-mini' + (isActive ? ' active' : '')}>
            <Avatar src={cv.character_avatar} name={cv.character_name} size={32} />
          </NavLink>
        ))}
      </div>
    );
  }
  return (
    <div className="sbc-list">
      {convs.map(cv => (
        <NavLink key={cv.id} to={'/chats/' + cv.id} viewTransition
          className={({ isActive }) => 'sbc-item' + (isActive ? ' active' : '')}>
          <Avatar src={cv.character_avatar} name={cv.character_name} size={30} />
          <span className="sbc-tx">
            <b>{cv.character_name}</b>
            <span>{msgPreview(cv.last_message)}</span>
          </span>
        </NavLink>
      ))}
    </div>
  );
}

const MORE_KEY = 'huanyu_sidebar_more';

function Sidebar({ user, unread, dmUnread, convs, mode, peek, cycle, onLeave }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const collapsed = mode === 'collapsed'; // icon-only rail (peek always shows full layout)
  const hidden = mode === 'hidden';
  // 「更多」折叠组：默认收起，展开偏好落 localStorage。
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; } });
  const toggleMore = () => setMoreOpen(o => { try { localStorage.setItem(MORE_KEY, o ? '0' : '1'); } catch { /* */ } return !o; });
  const cls = 'sidebar'
    + (collapsed ? ' collapsed' : '')
    + (hidden ? ' hidden' : '')
    + (hidden && peek !== 'closed' ? ' peek' : '')
    + (peek === 'open' ? ' peek-open' : '')
    + (peek === 'closing' ? ' peek-closing' : '');
  const toggleTitle = mode === 'expanded' ? '收起为图标栏' : mode === 'collapsed' ? '完全隐藏（移到最左侧可唤出）' : '固定展开';
  const ToggleIcon = mode === 'expanded' ? PanelLeftClose : mode === 'collapsed' ? ChevronsLeft : PanelLeftOpen;
  // 导航行渲染：桌面侧栏的 .nav-item + badge 接线（NAV_PRIMARY / NAV_MORE 共用）。
  const item = (n) => (
    <NavLink key={n.to} to={n.to} end={n.end} viewTransition title={collapsed ? n.label : undefined}
      className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
      <span className="ic"><n.ic size={18} /></span>
      {!collapsed && n.label}
      {n.badge === 'noti' && unread > 0 && <span className="nav-badge">{unread}</span>}
      {n.badge === 'dm' && dmUnread > 0 && <span className="nav-badge">{dmUnread}</span>}
    </NavLink>
  );
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
          <span className="coin gold"><CoinIcon size={14} /> {fmtNum(user?.gold)}</span>
          <span className="coin diamond"><DiamondIcon size={14} /> {fmtNum(user?.diamond)}</span>
          {user?.svip ? <span className="svip-badge">SVIP</span> : user?.vip ? <span className="vip-badge"><Crown size={12} /> VIP</span> : null}
          {user?.verified && <span className="v-badge" title="官方认证"><BadgeCheck size={16} /></span>}
          {user && <CheckinMini />}
        </div>
      )}
      {/* 创建主 CTA（替代原底部「发布作品」行） */}
      <NavLink to="/publish" viewTransition className="sb-create" title={collapsed ? '创建' : undefined} aria-label="创建">
        <Sparkles size={18} />
        {!collapsed && <span>创建</span>}
      </NavLink>
      {collapsed
        ? <button className="nav-item sb-search-ic" onClick={openCmdk} title="搜索 (⌘K)" aria-label="搜索"><span className="ic"><Search size={18} /></span></button>
        : <button className="sb-search" onClick={openCmdk}><Search size={15} /><span>搜索角色、页面…</span><kbd>⌘K</kbd></button>}
      <div className="sb-scroll" style={{ overflowY: 'auto', flex: 1, margin: '0 -4px', padding: '0 4px' }}>
        {collapsed ? (
          <>
            {/* collapsed：不走双段式，全量图标平铺（与旧版视觉一致） */}
            <div className="nav-divider" />
            {NAV_PRIMARY.map(item)}
            <SidebarChats convs={convs} collapsed />
            {NAV_MORE.map(g => (
              <div key={g.title}>
                <div className="nav-divider" />
                {g.items.map(item)}
              </div>
            ))}
            {user?.is_gm && (
              <div>
                <div className="nav-divider" />
                <NavLink to="/admin" viewTransition title="管理后台" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                  <span className="ic"><Shield size={18} /></span>
                </NavLink>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 第一段：7 个高频入口 */}
            <div className="sb-primary">{NAV_PRIMARY.map(item)}</div>
            {/* 第二段：最近对话（空列表时整段含标题行隐藏） */}
            {convs.length > 0 && (
              <div className="sb-recent">
                <div className="sb-recent-head">
                  <span>最近对话</span>
                  <NavLink to="/chats" viewTransition>全部</NavLink>
                </div>
                <SidebarChats convs={convs} />
              </div>
            )}
            {/* 长尾：「更多」折叠组（含 is_gm 管理后台） */}
            <div className="sb-more-wrap">
              <button className={'nav-item sb-more-toggle' + (moreOpen ? ' open' : '')} onClick={toggleMore} aria-expanded={moreOpen}>
                <span className="ic"><ChevronRight size={18} className="sb-more-chev" /></span>
                更多
                {!moreOpen && unread > 0 && <span className="nav-badge sb-more-dot" aria-hidden="true" />}
              </button>
              {/* grid 0fr→1fr 过渡需要内容常驻 DOM；收起时 inert 摘出 tab 序 */}
              <div className={'sb-more' + (moreOpen ? ' open' : '')} inert={moreOpen ? undefined : true}>
                <div className="sb-more-inner">
                  {NAV_MORE.map(g => (
                    <div key={g.title}>
                      <div className="nav-section">{g.title}</div>
                      {g.items.map(item)}
                    </div>
                  ))}
                  {user?.is_gm && (
                    <div>
                      <div className="nav-section">管理</div>
                      <NavLink to="/admin" viewTransition className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                        <span className="ic"><Shield size={18} /></span>管理后台
                      </NavLink>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <div className={'user-chip' + (collapsed ? ' compact' : '')} onClick={() => nav('/profile')} title={collapsed ? user?.display_name : undefined}>
          <FramedAvatar frame={user?.avatar_frame} src={user?.avatar} name={user?.display_name} size={collapsed ? 32 : 36} />
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

function MobileTop({ user, unread, onMenu }) {
  const nav = useNavigate();
  return (
    <div className="mobile-topbar mobile-only">
      <button className="mt-menu" onClick={onMenu} aria-label="菜单"><Menu size={22} /></button>
      <b style={{ fontSize: 17, flex: 1 }}>幻域</b>
      <span className="coin gold" onClick={() => nav('/wallet')}><CoinIcon size={13} /> {fmtNum(user?.gold)}</span>
      {/* 图标动作用真按钮承载 ≥40px 触控区（裸 svg 只有 20px，指头很难点中） */}
      <button className="mt-act" onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
      <button className="mt-act mt-bell" onClick={() => nav('/notifications')} aria-label="通知">
        <Bell size={20} />
        {unread > 0 && <span className="nb">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
}

// Full navigation drawer for mobile — surfaces every desktop sidebar entry.
function MobileNav({ user, unread, dmUnread, onClose, installEvt, doInstall }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const go = (to) => { nav(to, { viewTransition: true }); onClose(); };
  return (
    <div className="mnav-mask mobile-only" onClick={onClose}>
      <aside className="mnav" onClick={e => e.stopPropagation()}>
        <div className="mnav-head">
          <div className="user-chip" onClick={() => go('/profile')} style={{ flex: 1 }}>
            <FramedAvatar frame={user?.avatar_frame} src={user?.avatar} name={user?.display_name} size={40} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 14, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name}</b>
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>@{user?.username}</span>
            </div>
          </div>
          <button className="mnav-x" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="wallet-mini" style={{ margin: '0 16px 8px' }}>
          <span className="coin gold" onClick={() => go('/wallet')}><CoinIcon size={14} /> {fmtNum(user?.gold)}</span>
          <span className="coin diamond" onClick={() => go('/wallet')}><DiamondIcon size={14} /> {fmtNum(user?.diamond)}</span>
          {user?.svip ? <span className="svip-badge">SVIP</span> : user?.vip ? <span className="vip-badge"><Crown size={12} /> VIP</span> : null}
        </div>
        <div className="mnav-scroll">
          {GROUPS.map(g => (
            <div key={g.title}>
              <div className="nav-section">{g.title}</div>
              {g.items.map(n => (
                <button key={n.to} className="nav-item" onClick={() => go(n.to)}>
                  <span className="ic"><n.ic size={18} /></span>{n.label}
                  {n.badge === 'noti' && unread > 0 && <span className="nav-badge">{unread}</span>}
                {n.badge === 'dm' && dmUnread > 0 && <span className="nav-badge">{dmUnread}</span>}
                </button>
              ))}
            </div>
          ))}
          {user?.is_gm && (<div><div className="nav-section">管理</div>
            <button className="nav-item" onClick={() => go('/admin')}><span className="ic"><Shield size={18} /></span>管理后台</button></div>)}
          <button className="nav-item" style={{ color: 'var(--accent)' }} onClick={() => go('/publish')}><span className="ic"><Sparkles size={18} /></span>发布作品</button>
          {installEvt && <button className="nav-item mnav-install" onClick={() => { doInstall(); onClose(); }}><span className="ic"><Download size={18} /></span>安装到桌面</button>}
          <button className="nav-item" onClick={() => { logout(); onClose(); }}><span className="ic"><LogOut size={18} /></span>退出登录</button>
        </div>
      </aside>
    </div>
  );
}
