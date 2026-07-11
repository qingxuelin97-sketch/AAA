// AppLayout — the dedicated *native app* shell, used in place of the web Layout
// whenever isAppMode() is true (Capacitor app, or the `?app=1` browser preview).
// 对标一线内容 App 的形态：
//   · 无持久顶栏 —— 每个一级页自带头部（今日=问候区 / 发现=分类浮层 /
//     消息=双 tab / 我的=个人卡），内容直通状态栏下沿
//   · 扁平全宽底栏：今日 / 发现 / [+AI] / 消息 / 我的，中央为描边「+AI」创建钮
//   · 白+青清透浅色优先（theme.js 在 app 壳把 system 解析为 light）
//   · safe-area aware, phone-framed on wide screens for preview
// Content pages are reused as-is; only the chrome differs.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { Logo } from '../assets.jsx';
import CommandPalette from './CommandPalette.jsx';
import WelcomePopup from './WelcomePopup.jsx';
import { useAppGestures, tick } from '../appgestures.js';
import { useNav, appBack, routeCommitted, computeDir, SWIPE_TABS } from '../nav.js';
import {
  Home, Compass, MessageCircle, Plus, UserRound,
  Sparkles, Feather, Wand2, Drama, Send, RefreshCw, WifiOff, BatteryLow, X
} from 'lucide-react';

// Bottom tab bar — 4 destinations split around the center create button.
const TABS_L = [
  { to: '/today', ic: Home, label: '今日', end: true },
  { to: '/', ic: Compass, label: '发现', end: true }
];
const TABS_R = [
  { to: '/messages', ic: MessageCircle, label: '消息', badge: 'msg' },
  { to: '/me', ic: UserRound, label: '我的' }
];

// FAB create-sheet actions.
const CREATE = [
  { to: '/character/new', ic: Sparkles, label: '创建角色', hint: '立绘 · 人设 · 世界书' },
  { to: '/atelier', ic: Feather, label: '写小说', hint: 'AI 协作长篇创作' },
  { to: '/draw', ic: Wand2, label: 'AI 绘图', hint: '文生图工作室' },
  { to: '/theater', ic: Drama, label: '开剧场', hint: '多人多 AI 即兴演出' },
  { to: '/publish', ic: Send, label: '发布作品', hint: '角色 / 剧本 / 动态' }
];

export default function AppLayout({ children }) {
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [sheet, setSheet] = useState(false); // create sheet open?
  const [pull, setPull] = useState(0);        // pull-to-refresh distance (px)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump → remount route → refetch
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  // 自适应降级提示（perf.js 检出持续掉帧、本会话临时切省电时弹出，可关闭）
  const [perfNote, setPerfNote] = useState(false);
  useEffect(() => {
    const on = () => setPerfNote(true);
    window.addEventListener('huanyu-perf-degraded', on);
    return () => window.removeEventListener('huanyu-perf-degraded', on);
  }, []);
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
  // 量测（offsetLeft 等 4 次强制 reflow）放进 rAF：路由 commit / VT 快照的
  // 同一帧里不再插同步布局，晚一帧就位在 0.42s 弹性过渡下不可见。
  useEffect(() => {
    const bar = tabbarRef.current, ink = inkRef.current;
    if (!bar || !ink) return;
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const act = bar.querySelector('.app-tab.active');
        if (!act) { ink.style.opacity = '0'; return; }
        ink.style.opacity = '1';
        ink.style.transform = `translateX(${act.offsetLeft}px)`;
        ink.style.width = act.offsetWidth + 'px';
        // 垂直也按活跃 tab 实测定位：CSS 写死 top 会随 tabbar padding 变化而偏移
        //（实机反馈光罩偏下 —— tabbar padding-top 4px 而旧 CSS top:6px）
        ink.style.top = act.offsetTop + 'px';
        ink.style.height = act.offsetHeight + 'px';
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); };
  }, [loc.pathname, sheet]);

  // PWA 安装事件：存到全局，「我的」页里提供「安装到桌面」入口。
  useEffect(() => {
    const h = (e) => { e.preventDefault(); window.__hyInstallEvt = e; try { window.dispatchEvent(new Event('huanyu-install-ready')); } catch { /* */ } };
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

  // Cold start lands on the 今日 launcher home (not the discover feed). Only the
  // very first navigation of the session is redirected, so the 发现 tab (also '/')
  // keeps working afterwards.
  const nav = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem('huanyu_app_booted')) return;
    sessionStorage.setItem('huanyu_app_booted', '1');
    if (loc.pathname === '/') nav('/today', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the create sheet on navigation.
  useEffect(() => { setSheet(false); }, [loc.pathname]);

  // —— 四路一级 tab KeepAlive ——
  // 切 tab 不再卸载整页重建（旧行为让 DOM 重建 + 接口重拉正好压在过渡动画帧
  // 上，是真机掉帧放大器）。仅缓存 SWIPE_TABS 四路：render 期把当前 children
  // 存入缓存（幂等，StrictMode 安全），全部缓存 pane 并列渲染，非活跃者以
  // content-visibility:hidden 跳过渲染但保留 DOM/状态/内部滚动位置。
  // React 对同引用元素直接 bailout，同 type+key+位置绝不重挂载。
  // 语义变化：tab 回访不再自动重拉数据 —— 由 SSE 实时事件 + 下拉刷新（驱逐
  // 当前 pane 缓存）覆盖。非 tab 路由维持原 keyed 重挂载。
  const isTab = SWIPE_TABS.includes(loc.pathname);
  const paneCache = useRef({});   // { path: ReactElement }
  const paneVer = useRef({});     // { path: n } —— 下拉刷新的驱逐版本号
  const paneScroll = useRef({});  // { path: window.scrollY }（window 是 tab 页主滚动容器）
  if (isTab) paneCache.current[loc.pathname] = children;

  // 过渡方向兜底 + VT commit 信号。commit 后、paint 前把方向写到 <html
  // data-nav-dir>：keyed .route-fade 的入场动画按它切 variant，让未经 useNav
  // 的裸 navigate() / 系统返回也有方向正确的过渡；同时 resolve nav.js 里
  // View Transition 正在等待的 commit promise。
  const navType = useNavigationType();
  const prevPath = useRef(loc.pathname);
  const prevRefresh = useRef(refreshKey);
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (refreshKey !== prevRefresh.current) {
      html.dataset.navDir = 'refresh';
      prevRefresh.current = refreshKey;
    } else if (loc.pathname !== prevPath.current) {
      html.dataset.navDir = computeDir(prevPath.current, loc.pathname, navType);
    }
    prevPath.current = loc.pathname;
    routeCommitted();
    // VT 接管期间给非 tab 入场页钉内联 animation:none：否则 VT 结束摘除
    // [data-vt] 时 animation-name 从 none 翻回 → 按规范重新起播（二次滑动）。
    // 内联样式随元素卸载自然消失；tab pane 走 .pane-enter 机制，天然无此问题。
    if ('vt' in html.dataset) {
      const el = mainRef.current?.querySelector(':scope > .route-fade:not(.tab-pane)');
      if (el) el.style.animation = 'none';
    }
  }, [loc.key, refreshKey, loc.pathname, navType]);

  // tab pane 切换编排：离开 → 存滚动位置 / 暂停 pane 内视频 / 收焦点；
  // 进入 → 恢复视频 / 还原滚动（paint 前，VT 新快照拍到的即是还原后状态）/
  // 重放方向入场动画（VT 接管、lite、reduced-motion 时被 CSS 门控为 no-op）。
  const prevTab = useRef(null);
  useLayoutEffect(() => {
    const cur = SWIPE_TABS.includes(loc.pathname) ? loc.pathname : null;
    const prev = prevTab.current;
    if (prev === cur) return;
    const root = mainRef.current;
    if (prev && root) {
      const pane = root.querySelector(`[data-pane="${prev}"]`);
      if (pane) {
        paneScroll.current[prev] = window.scrollY;
        pane.querySelectorAll('video').forEach(v => {
          if (!v.paused) { v.dataset.hyKaPaused = '1'; try { v.pause(); } catch { /* */ } }
        });
        if (pane.contains(document.activeElement)) document.activeElement.blur?.();
      }
    }
    if (cur && root) {
      const pane = root.querySelector(`[data-pane="${cur}"]`);
      if (pane) {
        pane.querySelectorAll('video[data-hy-ka-paused]').forEach(v => {
          delete v.dataset.hyKaPaused;
          v.play?.().catch?.(() => {});
        });
        window.scrollTo(0, paneScroll.current[cur] || 0);
        if (!('vt' in document.documentElement.dataset)) {
          pane.classList.remove('pane-enter');
          void pane.offsetWidth; // 重启动画
          pane.classList.add('pane-enter');
          const done = () => pane.classList.remove('pane-enter');
          pane.addEventListener('animationend', done, { once: true });
          setTimeout(done, 450); // 动画被门控为 none 时 animationend 不触发，兜底摘类
        }
      }
    }
    prevTab.current = cur;
  }, [loc.pathname]);

  // 空闲预热高频路由 chunk（与 App.jsx 的 lazy() 同模块，Vite 自动去重）：
  // 消除首跳的 chunk 拉取等待 —— 过渡动画不再被网络卡成「先冻后跳」。
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      import('../pages/AppHome.jsx'); import('../pages/DiscoverFeed.jsx');
      import('../pages/Messages.jsx'); import('../pages/AppProfile.jsx');
      import('../pages/CharacterView.jsx'); import('../pages/Chat.jsx');
    });
    return () => cancel(id);
  }, []);

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
  const go = useNav();
  const swipeGo = (dir) => {
    const i = SWIPE_TABS.indexOf(loc.pathname);
    if (i < 0) return;                 // only the swipeable top-levels respond
    const n = i + dir;
    if (n < 0 || n >= SWIPE_TABS.length) return;
    tick(); go(SWIPE_TABS[n]);
  };
  const doRefresh = () => {
    if (refreshing) return;
    tick(12); setRefreshing(true);
    // tab 页：驱逐当前 pane 缓存（key 变 → 仅该 pane 重挂载重拉），其余 pane 保活
    if (SWIPE_TABS.includes(loc.pathname)) {
      paneVer.current[loc.pathname] = (paneVer.current[loc.pathname] || 0) + 1;
    }
    setRefreshKey(k => k + 1);          // remount current route → its effects refetch
    setTimeout(() => { setRefreshing(false); setPull(0); }, 720);
  };
  useAppGestures(mainRef, {
    onNext: () => swipeGo(1),
    onPrev: () => swipeGo(-1),
    onBack: () => { if (window.history.length > 1) { tick(); appBack(); } },
    onPullMove: (px) => { if (!refreshing) setPull(px); },
    onPullEnd: (ok) => { if (ok) doRefresh(); else setPull(0); }
  });

  const ptr = refreshing ? 56 : pull;

  return (
    <div className="app-root">
      {offline && <div className="app-offline" role="status"><WifiOff size={13} /> 网络已断开，正在使用离线内容</div>}
      {perfNote && (
        <div className="app-perfnote" role="status">
          <BatteryLow size={13} /> 检测到持续掉帧，本次已临时开启省电模式（设置中可改）
          <button onClick={() => setPerfNote(false)} aria-label="关闭提示"><X size={13} /></button>
        </div>
      )}
      <div className={'app-ptr' + (refreshing ? ' spin' : '')} style={{ height: ptr, opacity: ptr ? 1 : 0 }} aria-hidden="true">
        <RefreshCw size={20} style={{ transform: refreshing ? 'none' : `rotate(${ptr * 3}deg)` }} />
      </div>
      <main className="app-main" ref={mainRef}
        style={pull && !refreshing ? { transform: `translateY(${Math.min(pull, 90)}px)`, transition: 'none' } : undefined}>
        {SWIPE_TABS.map(p => paneCache.current[p] && (
          <div key={p + '#' + (paneVer.current[p] || 0)}
            className={'route-fade tab-pane' + (isTab && p === loc.pathname ? '' : ' off')}
            data-pane={p}>
            {paneCache.current[p]}
          </div>
        ))}
        {!isTab && <div className="route-fade" key={loc.pathname + '#' + refreshKey}>{children}</div>}
      </main>

      <nav className="app-tabbar" ref={tabbarRef}>
        <span className="dock-ink" ref={inkRef} aria-hidden="true" />
        {TABS_L.map(t => <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} curPath={loc.pathname} />)}
        <button className={'app-fab' + (sheet ? ' open' : '')} onClick={() => setSheet(s => !s)} aria-label={sheet ? '关闭' : '创建'}>
          <Plus size={20} strokeWidth={2.8} />
          <i className="app-fab-ai" aria-hidden="true">AI</i>
        </button>
        {TABS_R.map(t => <Tab key={t.to} t={t} unread={unread} dmUnread={dmUnread} curPath={loc.pathname} />)}
      </nav>

      {sheet && <CreateSheet onClose={() => setSheet(false)} />}

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
  const go = useNav();
  // Tapping the already-active tab scrolls the page back to the top (native pattern).
  // 也覆盖内部滚动容器（发现流 .feed-root、聊天列表等），否则再点无反应。
  // 非活跃 tab：拦掉 NavLink 默认导航，走 useNav 拿方向化过渡（active 样式仍由
  // NavLink 按路由位置计算，不受影响）。
  const onClick = (e) => {
    e.preventDefault();
    if (curPath !== t.to) { go(t.to); return; }
    tick();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      // KeepAlive 后其它 tab 的 pane 也在 DOM 里，滚动容器必须在活跃 pane 内找
      const scope = document.querySelector('.tab-pane:not(.off)') || document;
      const inner = scope.querySelector('.feed-root, .msgs, .apphome, .pf, .cvx-scroll, .vm-scroll');
      inner?.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch { /* */ }
  };
  return (
    <NavLink to={t.to} end={t.end} onClick={onClick} className={({ isActive }) => 'app-tab' + (isActive ? ' active' : '')}>
      <span className="app-tab-ic">
        <t.ic size={23} />
        {t.badge === 'noti' && unread > 0 && <i className="app-dot" />}
        {t.badge === 'dm' && dmUnread > 0 && <i className="app-dot" />}
        {t.badge === 'msg' && unread + dmUnread > 0 && <i className="app-dot" />}
      </span>
      <span>{t.label}</span>
    </NavLink>
  );
}

function CreateSheet({ onClose }) {
  const navTo = useNav();
  const go = (to) => { navTo(to); onClose(); };
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
