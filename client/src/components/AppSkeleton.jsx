// AppSkeleton — APP 原生壳统一骨架屏。
// 复用 app-motion.css 的 .skel shimmer 动画，提供变体（hero/card/row/avatar/
// grid）+ 列表/网格组合态，替代各页各自手写的 .ah-hero-skel / .pf-cc-skel /
// .msgs-skel-row 等命名混乱的局部实现。
//
// 仅 APP 壳使用（.skel 已在 html[data-app="1"] 作用域）。
import React from 'react';

// 单个骨架块。height/width 由 variant 推断，也可内联覆盖。
export function Skeleton({ variant = 'row', style, className = '' }) {
  const s = STYLES[variant] || STYLES.row;
  return <div className={'skel app-skel app-skel-' + variant + (className ? ' ' + className : '')} style={{ ...s, ...style }} />;
}

const STYLES = {
  hero:   { height: 120, borderRadius: 18 },
  card:   { height: 160, borderRadius: 18 },
  row:    { height: 56, borderRadius: 14 },
  avatar: { width: 44, height: 44, borderRadius: '50%' },
  line:   { height: 12, borderRadius: 6 },
  grid:   { height: 180, borderRadius: 18 },
};

// 列表骨架：N 个 row，可指定 gap。
export function SkeletonList({ count = 5, variant = 'row', gap = 10, style }) {
  return (
    <div className="app-skel-list" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant={variant} style={style} />
      ))}
    </div>
  );
}

// 网格骨架：cols 列 × rows 行。
export function SkeletonGrid({ cols = 2, rows = 3, gap = 12, variant = 'grid' }) {
  return (
    <div className="app-skel-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  );
}

// 头像 + 双行文本的行骨架（消息/会话/好友列表常用）。
export function SkeletonRowAv({ lines = 2 }) {
  return (
    <div className="app-skel-rowav" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Skeleton variant="avatar" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} variant="line" style={{ width: i === lines - 1 ? '60%' : '90%' }} />
        ))}
      </div>
    </div>
  );
}

export default Skeleton;
