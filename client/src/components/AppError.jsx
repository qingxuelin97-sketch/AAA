// AppError — APP 原生壳统一错误态。
// 替代各页 `api(...).catch(() => {})` 静默吞错的现状：网络错/服务器错/空数据
// 三种语义，配插画（复用 AppEmpty 体系）+ 文案 + 「重试」CTA。
//
// 重试按钮的触感（haptic.warn）由包 B 在接入时补；本组件只负责渲染与回调。
// 仅 APP 壳使用。
import React from 'react';
import AppEmpty from './AppEmpty.jsx';
import { haptic } from '../haptics.js';

const COPY = {
  network: { variant: 'offline', title: '网络连接失败', hint: '请检查网络后重试' },
  server:  { variant: 'offline', title: '服务器开小差了', hint: '稍后再试，或刷新页面' },
  empty:   { variant: 'chars',   title: '暂无内容',     hint: '下拉刷新试试' },
};

export default function AppError({ kind = 'network', title, hint, onRetry, retryLabel = '重试', actions }) {
  const c = COPY[kind] || COPY.network;
  const acts = actions ? [...actions] : [];
  if (onRetry && !acts.some(a => a.label === retryLabel)) {
    // 重试前给一个 warn 触觉，让用户感知「这是补救动作」。
    acts.unshift({ label: retryLabel, onClick: () => { haptic.warn(); onRetry(); }, primary: true });
  }
  return <AppEmpty variant={c.variant} title={title || c.title} hint={hint || c.hint} actions={acts} />;
}
