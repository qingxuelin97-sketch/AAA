// Touch gestures for the native app shell (AppLayout) — swipe between top tabs,
// pull-to-refresh, and left-edge swipe-back. Attached to the scrolling content
// element. No-ops gracefully on desktop/no-touch. Kept framework-light: a single
// pointer-tracking effect, callbacks read from a ref so listeners bind once.
import { useEffect, useRef } from 'react';

// Light haptic tick where supported (Android web / native vibrate); silent on iOS.
// 触感反馈：设置页可整体关闭（huanyu_haptics='0'，仅本机生效，默认开）
export function tick(ms = 8) {
  try {
    if (localStorage.getItem('huanyu_haptics') === '0') return;
    navigator.vibrate?.(ms);
  } catch { /* */ }
}

// Elements that own horizontal scrolling / their own touch semantics — swiping
// inside them must NOT trigger tab navigation.
const NO_TAB_SWIPE = '.ah-rail, .ah-shortcuts, .ah-picks, .pf-quick, .pf-content-grid, .cvx-rail, .vm-plans, .chat-scroll, .chat-input-bar, input, textarea, [data-noswipe], [data-no-tab-swipe], [data-horizontal-scroll], .app-launcher, .app-sheet, .sp-stage, .feed-root, .qa-onboard, .qa-cal, .qa-share-sheet, .qa-press-menu, .qa-ach-wall';
const NO_PULL = '.ah-rail, .ah-shortcuts, .ah-picks, .pf-quick, .pf-content-grid, .cvx-rail, .vm-plans, .chat-scroll, .chat-input-bar, input, textarea, select, [contenteditable="true"], [data-no-pull], [data-horizontal-scroll], .app-launcher, .app-sheet, .sp-stage, .feed-root, .qa-onboard, .qa-cal, .qa-share-sheet, .qa-press-menu, .qa-ach-wall';

export function useAppGestures(scrollRef, handlers) {
  const cb = useRef(handlers);
  cb.current = handlers;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return undefined;

    let sx = 0, sy = 0, tracking = false, mode = '', fromEdge = false, pull = 0;
    let allowHorizontal = false, allowPull = false, gestureScrollRoot = null;
    const scrollTopOf = (root) => {
      if (!root || root === document.scrollingElement || root === document.documentElement || root === document.body) {
        return window.scrollY || document.documentElement.scrollTop || 0;
      }
      return root.scrollTop || 0;
    };
    // 找出这次触摸真正会滚动的那个容器。
    //
    // 原来只认 [data-scroll-root]，而全仓只有 DiscoverFeed 一个元素带这个属性。
    // 于是所有「页面本身不滚、内部容器滚」的页面（VIP 的 .vm-scroll、角色详情的
    // .cvx-scroll、好友/私信的 .fr-scroll / .fr-dm-scroll、创作中心收益明细的
    // .inc-detail-body）都回落到 document.scrollingElement —— 而 .app-main 自己
    // 从不滚动，scrollTop 恒为 0 → 恒判「已在页顶」→ onMovePull 对 touchmove
    // preventDefault，把内层滚动整个吃掉，列表拖不动。
    //
    // 改为按 CSS 计算值向上找第一个真正可滚的祖先。这样新增内滚容器不必再记得
    // 去加属性 —— 分散标注必然再漏（顶栏安全区那一轮已经证明过一次）。
    // [data-scroll-root] 保留为显式覆盖，优先级最高。
    const findScrollRoot = (target) => {
      const explicit = target?.closest?.('[data-scroll-root]');
      if (explicit) return explicit;
      let node = target instanceof Element ? target : null;
      while (node && node !== document.body && node !== document.documentElement) {
        // 只有内容确实溢出时才算 —— 否则 overflow:auto 但没内容的容器会把
        // 下拉刷新永久关掉。
        if (node.scrollHeight - node.clientHeight > 1) {
          const oy = getComputedStyle(node).overflowY;
          if (oy === 'auto' || oy === 'scroll') return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement;
    };
    // 非 passive 的 touchmove 只在「本次手势可能变成下拉刷新」（起手时已在页顶）
    // 时临时挂上、touchend 即摘。曾经常驻 { passive: false } —— 全 APP 每一次
    // 滚动的每一帧合成器都要停下来等主线程跑完监听器才敢滚，主线程一忙
    // （玻璃模糊 + React 提交）滚动就整段掉帧。摘掉后日常滚动全程 passive，
    // 合成器自由滚，只有页顶下拉这一种手势付阻塞成本。
    let pullBound = false;
    // 下拉距离回调按 rAF 节流：touchmove 触发频率可高于刷新率（120Hz 屏 /
    // 多次采样），每次都 setState 会放大 React 提交压力。
    let raf = 0;
    const emitPull = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; cb.current.onPullMove?.(pull); });
    };

    // 方向判定（h=横滑 / pull=页顶下拉 / v=普通纵滑），两个 move 监听共用。
    const detect = (dx, dy) => {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (allowHorizontal && Math.abs(dx) > Math.abs(dy) * 1.4) mode = 'h';
      else if (allowPull && dy > Math.abs(dx) * 1.2 && scrollTopOf(gestureScrollRoot) <= 0) mode = 'pull';
      else mode = 'v';
    };
    // 横滑动作：越过阈值立即触发，不等抬手 —— 「滑动切页要等手指离开才有
    // 反应」正是延迟反馈体感的大头；fired 保证每次手势只触发一次。
    const H_TRIG = 56;
    let fired = false;
    const fireH = (dx) => {
      fired = true;
      if (dx < 0) cb.current.onNext?.();
      else if (fromEdge) cb.current.onBack?.();
      else cb.current.onPrev?.();
    };
    const trackH = (dx, dy) => {
      if (!mode) detect(dx, dy);
      if (mode === 'h' && !fired && Math.abs(dx) > H_TRIG && Math.abs(dx) > Math.abs(dy) * 1.4) fireH(dx);
    };
    const onMovePassive = (e) => {
      if (!tracking || pullBound) return;
      const t = e.touches[0];
      trackH(t.clientX - sx, t.clientY - sy);
    };
    const onMovePull = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      trackH(dx, dy);
      if (mode === 'pull') {
        pull = Math.min(120, dy * 0.55);
        if (pull > 0) { if (e.cancelable) e.preventDefault(); emitPull(); }
      }
    };
    const unbindPull = () => {
      if (!pullBound) return;
      pullBound = false;
      el.removeEventListener('touchmove', onMovePull);
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; unbindPull(); return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; mode = ''; pull = 0; fired = false;
      fromEdge = sx <= 24;
      gestureScrollRoot = findScrollRoot(e.target);
      allowHorizontal = !e.target.closest?.(NO_TAB_SWIPE);
      allowPull = !e.target.closest?.(NO_PULL);
      tracking = allowHorizontal || allowPull;
      const atTop = scrollTopOf(gestureScrollRoot) <= 0;
      if (tracking && allowPull && atTop && !pullBound) {
        pullBound = true;
        el.addEventListener('touchmove', onMovePull, { passive: false });
      } else if (pullBound && (!tracking || !atTop)) {
        unbindPull();
      }
    };
    const onEnd = (e) => {
      unbindPull();
      if (!tracking) return; tracking = false;
      const t = (e.changedTouches && e.changedTouches[0]) || {};
      const dx = (t.clientX || 0) - sx, dy = (t.clientY || 0) - sy;
      if (mode === 'pull') { cancelAnimationFrame(raf); raf = 0; cb.current.onPullEnd?.(pull > 66); return; }
      // 兜底：move 事件采样稀疏、抬手才越过阈值时仍在此触发（fired 防重复）
      if (mode === 'h' && !fired && Math.abs(dx) > H_TRIG && Math.abs(dx) > Math.abs(dy) * 1.4) fireH(dx);
    };
    const onCancel = () => {
      unbindPull();
      cancelAnimationFrame(raf);
      raf = 0;
      if (mode === 'pull') cb.current.onPullEnd?.(false);
      tracking = false;
      mode = '';
      pull = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMovePassive, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      unbindPull();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMovePassive);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [scrollRef]);
}
