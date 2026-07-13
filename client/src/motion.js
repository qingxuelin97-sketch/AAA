// 浮层退场编排原语 —— 「关闭即闪没」是全站动效僵硬感的最后一块大补丁。
//
// 背景：Modal / CreateSheet / Toast 等浮层全部是 `{open && <X/>}` 条件渲染，
// 关闭 = 立即 unmount，入场有弹性、退场是硬切。React 自身没有 unmount 动画
// 能力（不引 framer-motion 这类大件），这里用最小机制补齐：
//
//   const [closing, requestClose] = useExitClose(onClose, 200);
//
//   · requestClose()：给浮层根挂 .out（CSS 播退场动画），动画时长后才真正
//     调 onClose() 卸载。重复调用幂等（只走一次计时）。
//   · closing 为 true 期间由使用方给遮罩挂 .out —— 配套 CSS 必须同时设
//     pointer-events:none：退场中的浮层立即让路，绝不产生「动画播完才能
//     点下一下」的交互禁止期（全局铁律，见 app-motion.css 浮层退场段）。
//   · 挡位收敛：Web 壳 / lite 档 / prefers-reduced-motion 一律 0ms —— 行为
//     与旧版逐帧一致（立即卸载），本机制是 APP 壳的纯增强层。
//   · host 常驻场景安全（如 AppLayout）：onClose 触发后 closing 自动复位，
//     同一个 hook 实例可反复 开→关→开。
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAppMode } from './appmode.js';
import { isLite } from './perf.js';

// 退场动画的实际时长：非 APP 壳 / 省电 / 减弱动效 → 0（瞬时，保持旧行为）。
export function exitMs(ms) {
  try {
    if (!isAppMode() || isLite()) return 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch { return 0; }
  return ms;
}

export function useExitClose(onClose, ms = 200) {
  const [closing, setClosing] = useState(false);
  const busy = useRef(false);
  const timer = useRef(0);
  const cb = useRef(onClose);
  cb.current = onClose;

  const requestClose = useCallback(() => {
    if (busy.current) return;
    const d = exitMs(ms);
    if (!d) { cb.current?.(); return; }
    busy.current = true;
    setClosing(true);
    timer.current = setTimeout(() => {
      busy.current = false;
      setClosing(false); // host 常驻（AppLayout）时为下一次打开复位
      cb.current?.();
    }, d);
  }, [ms]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return [closing, requestClose];
}
