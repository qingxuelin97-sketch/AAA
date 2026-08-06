// 头像框装扮层（修缮⑤脚手架 → 动态框上线）：包一层 .avf 在 Avatar 外，
// 按 frame id 叠装饰层。动态框 = WebM alpha 循环视频（用户 AI 素材转制，
// 256px ≤300KB）；降级 = lite 性能档与 prefers-reduced-motion 显示同帧
// 静态 poster（WebP alpha）。scale 按各素材实测内孔直径定（孔≈头像 96%）。
import React from 'react';
import { Avatar } from '../ui.jsx';
import auroraWebm from '../assets/app/frame-aurora.webm?url';
import auroraPoster from '../assets/app/frame-aurora-poster.webp?url';
import giltWebm from '../assets/app/frame-gilt.webm?url';
import giltPoster from '../assets/app/frame-gilt-poster.webp?url';
import aquaWebm from '../assets/app/frame-aqua.webm?url';
import aquaPoster from '../assets/app/frame-aqua-poster.webp?url';

// 客户端框目录（与服务端 wallet.js AVATAR_FRAMES 同步维护）
export const AVATAR_FRAMES = [
  { id: '', label: '无' },
  { id: 'aurora', label: '流光', svip: true },
  { id: 'gilt', label: '鎏金', svip: true },
  { id: 'aqua', label: '碧波' },
];

// 动态框素材表：内孔直径实测占比 aurora 65% / gilt 55% / aqua 46%，
// scale = 0.96 / 占比，让孔恰好咬住头像边缘。
const FRAME_ART = {
  aurora: { webm: auroraWebm, poster: auroraPoster, scale: 1.48 },
  gilt: { webm: giltWebm, poster: giltPoster, scale: 1.75 },
  aqua: { webm: aquaWebm, poster: aquaPoster, scale: 2.05 },
};

const preferStill = () => {
  try {
    return document.documentElement.dataset.perf === 'lite'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch { return false; }
};

export default function FramedAvatar({ frame = '', size = 40, className = '', style, ...rest }) {
  if (!frame) return <Avatar size={size} {...rest} />;
  const art = FRAME_ART[frame];
  const artStyle = art ? { width: Math.round(size * art.scale), height: Math.round(size * art.scale) } : undefined;
  return (
    <span className={('avf ' + className).trim()} data-frame={frame} style={{ width: size, height: size, ...style }}>
      <Avatar size={size} {...rest} />
      {art
        ? (preferStill()
          ? <img className="avf-art" style={artStyle} src={art.poster} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          : <video className="avf-art" style={artStyle} src={art.webm} poster={art.poster}
              muted loop autoPlay playsInline aria-hidden="true" />)
        : <span className="avf-ring" aria-hidden="true" />}
    </span>
  );
}
