// 头像框装扮层（修缮⑤脚手架）：包一层 .avf 在 Avatar 外，按 frame id 叠
// 装饰环（.avf-ring）。静态框走纯 CSS（conic 渐变环）；未来 mp4 → WebM
// alpha 动态框挂同一层 <video muted loop playsinline>，id 即插即用。
// 降级：lite 性能档与 prefers-reduced-motion 停掉旋转动画（见 base.css）。
import React from 'react';
import { Avatar } from '../ui.jsx';

// 客户端框目录（与服务端 wallet.js AVATAR_FRAMES 同步维护）
export const AVATAR_FRAMES = [
  { id: '', label: '无' },
  { id: 'aurora', label: '流光', svip: true },
];

export default function FramedAvatar({ frame = '', size = 40, className = '', style, ...rest }) {
  if (!frame) return <Avatar size={size} {...rest} />;
  return (
    <span className={('avf ' + className).trim()} data-frame={frame} style={{ width: size, height: size, ...style }}>
      <Avatar size={size} {...rest} />
      <span className="avf-ring" aria-hidden="true" />
    </span>
  );
}
