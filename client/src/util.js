// 跨页面小工具集。
//
// shareUrl —— 分享链接必须按路由模式拼接：Web 部署（BrowserRouter）用干净路径，
// 静态构建（GitHub Pages / 离线包，HashRouter）用 #/ 前缀。此前各页面硬编码
// hash 形式，Web 端复制出的链接打开后会 404 到首页。
//
// cnToday —— 「今天」的业务口径统一为北京时间（UTC+8），与服务端 server/daily.js
// 同口径。此前签到用 UTC 日期，中国用户早上 8 点前签到会被记到「昨天」，
// 连签判断也随之漂移。
//
// useAutoGrow —— 聊天输入框随内容自动增高（到上限后转为内部滚动），
// 清空（发送后）自动回落到单行。移动端多行输入不再挤在一行里滚动。
import { useEffect } from 'react';

const STATIC = import.meta.env.VITE_STATIC === '1';

export function shareUrl(path) {
  return STATIC
    ? location.origin + location.pathname + '#' + path
    : location.origin + path;
}

// fmtNum —— 金币/钻石等数额统一千分位显示（人类习惯：18,600 比 18600 好读）。
// 此前各处显示不一：App 顶栏有千分位、侧边栏/今日页没有。
export function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

export function cnToday(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}

export function useAutoGrow(ref, value, max = 150) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [ref, value, max]);
}
