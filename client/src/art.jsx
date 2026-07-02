// 幻域 · 自制矢量数字资产库（移动端包装）
//
// 为什么自制而非引外部素材：CSP 限制 script/style 同源、App 离线版要求资产全
// 本地可用、且外部插画的授权与风格都难以统一。这里的所有插画都围绕品牌
// 「月门 / 星尘」母题手绘为 SVG，颜色全部走 CSS 变量，浅色 / 深色主题自动适配。
//
//  - <EmptyArt kind />   空态场景插画：chat / favorites / notifications /
//                        friends / search / library / generic
//  - <CoverArt name />   无头像角色的占位封面：按名字确定性生成
//                        双色渐变 + 图案（星尘 / 波纹 / 山月）+ 首字大字
import React from 'react';

/* ---------------- 确定性哈希：同名永远得到同一套配色与图案 ---------------- */
const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};

/* ---------------- 占位封面：双色渐变 + 三款图案轮换 ---------------- */
// 暮色流光家族色：黏土橙 / 湖蓝 / 鎏金 / 暮紫 / 松绿 / 绯陶
const COVER_PALETTES = [
  ['#e0885f', '#7d4468'], ['#4f93a8', '#25445c'], ['#c9a04a', '#7a4a22'],
  ['#9a6ab0', '#3c2a55'], ['#6f9a76', '#2f4a3a'], ['#d0704e', '#6e2f3c'],
];

function CoverPattern({ variant, uid }) {
  if (variant === 0) {
    // 星尘：四芒星 + 光点
    const spark = 'M0 -7C0.9 -2.6 2.6 -0.9 7 0C2.6 0.9 0.9 2.6 0 7C-0.9 2.6 -2.6 0.9 -7 0C-2.6 -0.9 -0.9 -2.6 0 -7Z';
    return (
      <g fill="#fff">
        <path d={spark} transform="translate(96 26)" opacity="0.5" />
        <path d={spark} transform="translate(22 40) scale(0.6)" opacity="0.35" />
        <path d={spark} transform="translate(104 118) scale(0.8)" opacity="0.3" />
        <circle cx="38" cy="18" r="1.6" opacity="0.45" />
        <circle cx="76" cy="132" r="1.3" opacity="0.35" />
        <circle cx="14" cy="112" r="1.8" opacity="0.3" />
      </g>
    );
  }
  if (variant === 1) {
    // 波纹：右下同心圆涟漪
    return (
      <g fill="none" stroke="#fff" strokeWidth="1.4">
        <circle cx="102" cy="128" r="16" opacity="0.4" />
        <circle cx="102" cy="128" r="30" opacity="0.26" />
        <circle cx="102" cy="128" r="46" opacity="0.16" />
        <circle cx="102" cy="128" r="64" opacity="0.09" />
        <circle cx="24" cy="24" r="10" opacity="0.22" />
      </g>
    );
  }
  // 山月：底部山峦剪影 + 上弦月
  return (
    <g>
      <path d="M-4 132 L28 96 L52 122 L76 88 L112 128 L124 118 L124 164 L-4 164 Z" fill="#000" opacity="0.18" />
      <path d="M-4 144 L20 118 L48 140 L82 108 L124 142 L124 164 L-4 164 Z" fill="#000" opacity="0.22" />
      <mask id={`cvMoon${uid}`}>
        <rect width="120" height="160" fill="#000" />
        <circle cx="92" cy="30" r="13" fill="#fff" />
        <circle cx="98" cy="25" r="11" fill="#000" />
      </mask>
      <rect width="120" height="160" fill="#fff" opacity="0.75" mask={`url(#cvMoon${uid})`} />
      <circle cx="30" cy="44" r="1.6" fill="#fff" opacity="0.5" />
    </g>
  );
}

// 占位封面。铺满父容器（object-fit: cover 语义），name 决定配色 / 图案 / 首字。
export function CoverArt({ name = '', className, glyph = true }) {
  const raw = React.useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '');
  const h = hash(name);
  const [c1, c2] = COVER_PALETTES[h % COVER_PALETTES.length];
  const variant = (h >>> 3) % 3;
  const initial = (String(name).trim().charAt(0) || '幻');
  return (
    <svg className={'cover-art' + (className ? ' ' + className : '')} viewBox="0 0 120 160"
      preserveAspectRatio="xMidYMid slice" role="img" aria-label={name || '角色封面'}>
      <defs>
        <linearGradient id={`cvG${uid}`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
        <radialGradient id={`cvHi${uid}`} cx="28%" cy="16%" r="90%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="160" fill={`url(#cvG${uid})`} />
      <rect width="120" height="160" fill={`url(#cvHi${uid})`} />
      <CoverPattern variant={variant} uid={uid} />
      {glyph && (
        <text x="60" y="92" textAnchor="middle" dominantBaseline="middle"
          fontFamily="'Fraunces Variable', 'Songti SC', Georgia, serif" fontWeight="600" fontSize="58"
          fill="#fff" opacity="0.34">{initial}</text>
      )}
    </svg>
  );
}

/* ---------------- 空态场景插画 ---------------- */
// 共用舞台：柔和地台 + 月门残弧 + 星尘，前景按 kind 变化。
// 颜色全走 CSS 变量（--accent / --accent-soft / --border-2 / --faint），主题自适应。
const SPARK = 'M0 -8C1 -3 3 -1 8 0C3 1 1 3 0 8C-1 3 -3 1 -8 0C-3 -1 -1 -3 0 -8Z';

function Stage({ children }) {
  return (
    <>
      {/* 地台 */}
      <ellipse cx="80" cy="118" rx="56" ry="10" fill="var(--bg-2)" />
      {/* 月门残弧 */}
      <path d="M34 116 A46 46 0 1 1 126 116" fill="none" stroke="var(--border-2)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 7" opacity="0.9" />
      {/* 星尘 */}
      <path d={SPARK} transform="translate(128 30) scale(0.55)" fill="var(--accent)" opacity="0.75" />
      <path d={SPARK} transform="translate(30 42) scale(0.38)" fill="var(--gold)" opacity="0.6" />
      <circle cx="120" cy="58" r="1.8" fill="var(--faint)" opacity="0.7" />
      <circle cx="42" cy="24" r="1.4" fill="var(--faint)" opacity="0.6" />
      {children}
    </>
  );
}

const SCENES = {
  // 对话：两只错落的气泡，一大一小，正冒星
  chat: (
    <g>
      <rect x="46" y="52" width="52" height="34" rx="13" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2" />
      <path d="M60 84 L58 96 L72 85" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="62" cy="69" r="2.6" fill="var(--faint)" />
      <circle cx="72" cy="69" r="2.6" fill="var(--faint)" />
      <circle cx="82" cy="69" r="2.6" fill="var(--faint)" />
      <rect x="92" y="34" width="34" height="24" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.8" opacity="0.95" />
      <path d="M112 57 L116 66 L102 58" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={SPARK} transform="translate(109 46) scale(0.5)" fill="var(--accent)" />
    </g>
  ),
  // 收藏：托起的心 + 环绕星
  favorites: (
    <g>
      <path d="M80 96 C58 82 50 68 54 56 C57 47 68 44 76 51 L80 55 L84 51 C92 44 103 47 106 56 C110 68 102 82 80 96Z"
        fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d={SPARK} transform="translate(104 40) scale(0.6)" fill="var(--gold)" />
      <path d="M56 100 A30 14 0 0 0 104 100" fill="none" stroke="var(--border-2)" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </g>
  ),
  // 通知：安睡的铃铛 + 月牙
  notifications: (
    <g>
      <path d="M80 44 C64 44 58 56 58 68 L58 82 L52 92 L108 92 L102 82 L102 68 C102 56 96 44 80 44Z"
        fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M73 98 A7 7 0 0 0 87 98" fill="none" stroke="var(--border-2)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="80" cy="41" r="3.4" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2" />
      <path d="M116 34 A11 11 0 1 1 104 22 A9 9 0 0 0 116 34Z" fill="var(--gold)" opacity="0.75" />
      <path d="M70 62 Q80 56 90 62" fill="none" stroke="var(--faint)" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
    </g>
  ),
  // 好友：两枚依偎的头像剪影
  friends: (
    <g>
      <circle cx="66" cy="60" r="12" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M46 100 C46 84 54 76 66 76 C78 76 86 84 86 100Z" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="96" cy="56" r="10" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2" />
      <path d="M80 96 C80 82 87 72 96 72 C107 72 114 82 114 96Z" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2" strokeLinejoin="round" />
      <path d={SPARK} transform="translate(118 40) scale(0.45)" fill="var(--accent)" opacity="0.9" />
    </g>
  ),
  // 搜索：放大镜里盛着一颗星
  search: (
    <g>
      <circle cx="74" cy="62" r="24" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2.6" />
      <line x1="92" y1="80" x2="108" y2="96" stroke="var(--border-2)" strokeWidth="5" strokeLinecap="round" />
      <path d={SPARK} transform="translate(74 62) scale(0.9)" fill="var(--accent)" opacity="0.9" />
    </g>
  ),
  // 角色库：一张待书写的角色卡
  library: (
    <g>
      <rect x="56" y="38" width="48" height="62" rx="8" fill="var(--panel)" stroke="var(--border-2)" strokeWidth="2.2" transform="rotate(-4 80 69)" />
      <circle cx="78" cy="58" r="9" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.8" transform="rotate(-4 80 69)" />
      <line x1="66" y1="78" x2="94" y2="76" stroke="var(--border-2)" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="67" y1="87" x2="88" y2="85.4" stroke="var(--border-2)" strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />
      <path d={SPARK} transform="translate(108 44) scale(0.55)" fill="var(--gold)" />
    </g>
  ),
};

// 通用场景需要实例内唯一的 mask id（同页多个空态时 fixed id 会互相覆盖）
function GenericScene() {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <g>
      <mask id={`hyEM${uid}`}>
        <rect width="160" height="132" fill="#000" />
        <circle cx="78" cy="68" r="17" fill="#fff" />
        <circle cx="86" cy="61" r="14" fill="#000" />
      </mask>
      <rect width="160" height="132" fill="var(--gold)" opacity="0.85" mask={`url(#hyEM${uid})`} />
      <path d={SPARK} transform="translate(96 46) scale(0.75)" fill="var(--accent)" />
    </g>
  );
}

// 空态插画。kind 见 SCENES；宽高比 160:132。
export function EmptyArt({ kind = 'generic', size = 132, className }) {
  const scene = SCENES[kind] || <GenericScene />;
  return (
    <svg className={'empty-art' + (className ? ' ' + className : '')} width={size} height={Math.round(size * 0.825)}
      viewBox="0 0 160 132" fill="none" aria-hidden="true">
      <Stage>{scene}</Stage>
    </svg>
  );
}
