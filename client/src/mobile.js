// 移动端软键盘适配工具。
//
// 背景：沉浸式对话页的输入栏在移动端是 position:fixed。键盘弹起时要把它顶到
// 键盘正上方。早期实现用 window.innerHeight 做基准计算偏移，但 innerHeight 在
// 不同浏览器下含义并不一致 —— Edge / Chrome Android 在键盘弹起时 innerHeight 可能
// 跟随视觉视口收缩，也可能保持布局视口不变；iOS Safari 又是另一套。这种不一致正是
// 「点输入框后输入栏跳得太远、贴不上键盘」的根因。
//
// 稳健做法：始终用 document.documentElement.clientHeight 作为「布局视口高度」基准
// （它在各浏览器下都等于布局视口，不受 interactive-widget 模式影响），偏移量 =
// 布局视口底 − 视觉视口底。配合 index.html 里的 interactive-widget=resizes-content，
// 多数安卓浏览器会让布局视口随键盘收缩，此时算得的偏移≈0，fixed bottom:0 天然贴合；
// iOS 等仍缩放视觉视口的浏览器则由这里补偿。两条路径都收敛到「贴着键盘、不留缝」。

import { useEffect } from 'react';

// 把传入的 fixed 输入栏（barRef）始终顶在软键盘上方。
// deps 变化时重新绑定（如切换对话）。
export function useKeyboardInsetBar(barRef, deps = []) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let raf = 0;
    const apply = () => {
      const bar = barRef.current;
      if (bar) {
        const layoutH = document.documentElement.clientHeight;
        // 键盘遮挡高度 = 布局视口底 − 视觉视口底（offsetTop 为视觉视口相对布局视口的上移量）
        let inset = layoutH - vv.height - vv.offsetTop;
        if (!(inset > 8)) inset = 0; // 阈值内视为无键盘，避免地址栏伸缩等抖动
        // 用 transform 上移（合成层，不触发重排），比改 bottom 更顺、也不与 CSS bottom:0 冲突
        bar.style.transform = inset ? `translate3d(0, ${-inset}px, 0)` : '';
      }
      const open = (document.documentElement.clientHeight - vv.height - vv.offsetTop) > 8;
      document.documentElement.classList.toggle('kbd-open', open);
      // 键盘弹起后，把当前聚焦的输入框温和地带入可见区（仅在确有键盘时）
      if (open && !raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          const el = document.activeElement;
          if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && barRef.current?.contains(el)) {
            try { el.scrollIntoView({ block: 'nearest' }); } catch { /* noop */ }
          }
        });
      }
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      if (raf) cancelAnimationFrame(raf);
      const bar = barRef.current;
      if (bar) bar.style.transform = '';
      document.documentElement.classList.remove('kbd-open');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// 全局软键盘标记 —— 只负责在 <html> 上开关 `kbd-open`，不动任何元素的位置。
//
// 原生壳有 Capacitor 的 Keyboard 事件，native.js 会设 `data-keyboard="1"`，
// App 层 CSS 据此收起整条 Dock。但浏览器 / PWA 预览（?app=1）拿不到那个事件，
// 于是同一份界面在预览里键盘弹起时 Dock 不会收 —— 而预览恰恰是走查与
// appdiff/e2e 使用的形态，缺了它等于「看到的不是用户看到的」。
//
// 这里用 visualViewport 补上同一个信号（判定口径与 useKeyboardInsetBar 一致）。
// 与 useKeyboardInsetBar 并存无冲突：两者都是幂等地 toggle 同一个类名。
export function useGlobalKeyboardFlag() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const apply = () => {
      const open = (document.documentElement.clientHeight - vv.height - vv.offsetTop) > 8;
      document.documentElement.classList.toggle('kbd-open', open);
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.classList.remove('kbd-open');
    };
  }, []);
}
