// APP 壳导航过渡编排 —— 方向感知的 View Transitions（增强层）。
//
// 背景：本项目用声明式 <BrowserRouter/HashRouter>（main.jsx），react-router v7
// 的 `viewTransition` 参数只在 data 模式（RouterProvider）生效 —— 之前散落各处
// 的 viewTransition 传参从未起过作用。这里改为自己编排：
//   · useNav()：签名与 useNavigate() 返回值一致；满足条件时把导航包进
//     document.startViewTransition —— 旧页与新页同时做方向化滑动（浏览器
//     双缓冲快照，天然解决「退场动画」），否则原样透传（Web 壳零影响）。
//   · appBack()：同理包装 history.back()，供手势/硬件返回键使用。
//   · 方向由 <html data-nav-dir> 标记，CSS 按 push/pop/left/right 切换动画；
//     [data-vt] 在过渡期间存在，供 CSS 关掉 route-fade 入场避免双重动画。
//
// 兜底层在 AppLayout：不支持 VT / lite / reduced-motion / 未经 useNav 的裸
// navigate() 一律落到 keyed .route-fade 的方向化入场动画（见 styles.css）。
import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isAppMode } from './appmode.js';
import { isLite } from './perf.js';

// 一级 tab 序（横滑与底栏共用）；tab 间切换按索引方向左右滑。
export const SWIPE_TABS = ['/today', '/', '/messages', '/me'];

// 路由 commit 信号：AppLayout 在新路由 commit 的 useLayoutEffect 里 resolve，
// VT 的 update callback 等它 —— 兼容 React startTransition 异步提交与 lazy chunk。
let commitResolve = null;
export function routeCommitted() {
  if (commitResolve) { commitResolve(); commitResolve = null; }
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// VT 启用守卫：仅 APP 壳、非省电档、未减弱动效、API 存在、且没有浮层哨兵
// （useOverlayBack 压的 {overlay:true}——此时 back 是关浮层，不该做页面过渡）。
function vtEnabled() {
  return isAppMode()
    && !isLite()
    && !reducedMotion()
    && typeof document.startViewTransition === 'function'
    && !history.state?.overlay;
}

export function computeDir(from, to, navType) {
  if (navType === 'POP') return 'pop';
  const a = SWIPE_TABS.indexOf(from), b = SWIPE_TABS.indexOf(to);
  if (a >= 0 && b >= 0 && a !== b) return b > a ? 'left' : 'right';
  return 'push';
}

// 把一次导航包进 View Transition。update callback 里 race 一个 800ms 超时：
// lazy chunk 网络慢时宁可提前放行（轻微跳变）也绝不冻住整屏。
function runVT(dir, go) {
  const html = document.documentElement;
  html.dataset.navDir = dir;
  html.dataset.vt = '';
  routeCommitted(); // 冲掉上一次未消费的等待者（快速连点）
  const committed = new Promise(res => { commitResolve = res; });
  let vt;
  try {
    vt = document.startViewTransition(() => {
      go();
      return Promise.race([committed, new Promise(r => setTimeout(r, 800))]);
    });
  } catch {
    delete html.dataset.vt;
    go();
    return;
  }
  vt.finished.finally(() => { delete html.dataset.vt; });
}

function pathOf(to) {
  if (typeof to === 'string') return to.split('?')[0].split('#')[0];
  return to?.pathname || '';
}

// useNavigate 的过渡增强版。返回函数签名与 navigate 完全一致。
export function useNav() {
  const navigate = useNavigate();
  const loc = useLocation();
  const from = loc.pathname;
  return useCallback((to, opts) => {
    if (!vtEnabled()) { navigate(to, opts); return; }
    if (typeof to === 'number') {
      runVT(to < 0 ? 'pop' : 'push', () => navigate(to));
      return;
    }
    runVT(computeDir(from, pathOf(to), 'PUSH'), () => navigate(to, opts));
  }, [navigate, from]);
}

// 硬件/手势返回的过渡版（非 hook，可在 native.js 等纯模块里用）。
export function appBack() {
  if (vtEnabled()) runVT('pop', () => window.history.back());
  else window.history.back();
}
