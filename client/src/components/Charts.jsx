import React, { useId } from 'react';

// Lightweight, dependency-free charts that match the warm editorial design language.
// Colors come from CSS vars so they adapt to light/dark automatically.

export function BarChart({ data = [], height = 170, color = 'var(--accent)', unit = '' }) {
  const max = Math.max(1, ...data.map(d => d.value));
  if (!data.length) return <div className="chart-empty">暂无数据</div>;
  return (
    <div className="bar-chart" style={{ height }}>
      {data.map((d, i) => (
        <div className="bar-col" key={i} title={`${d.label}：${d.value}${unit}`}>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(d.value / max) * 100}%`, background: color, animationDelay: `${i * 0.05}s` }}>
              <span className="bar-val">{d.value}</span>
            </div>
          </div>
          <div className="bar-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ data = [], height = 180, color = 'var(--accent)', unit = '' }) {
  const uid = useId().replace(/:/g, '');
  if (!data.length) return <div className="chart-empty">暂无数据</div>;
  const W = 600, H = height, padX = 8, padY = 16;
  const max = Math.max(1, ...data.map(d => d.y));
  const n = data.length;
  const x = (i) => padX + (i * (W - padX * 2)) / Math.max(1, n - 1);
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const pts = data.map((d, i) => [x(i), y(d.y)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - padY} L ${padX} ${H - padY} Z`;
  const total = data.reduce((s, d) => s + d.y, 0);
  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#g${uid})`} className="lc-area" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="lc-line" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill={color} className="lc-dot"><title>{data[i].x}：{data[i].y}{unit}</title></circle>)}
      </svg>
      <div className="lc-axis">{data.map((d, i) => (i % Math.ceil(n / 7) === 0 || i === n - 1) ? <span key={i}>{d.x}</span> : <span key={i} />)}</div>
      <div className="lc-total muted">合计 {total}{unit}</div>
    </div>
  );
}
