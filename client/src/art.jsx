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
import { isAppMode } from './appmode.js';
import quietAquaCharacterUrl from './assets/quiet-aqua-character-v3.png?url';
// 仪与匣内容插画：每个场景都交付浅/深双线色 SVG，运行时不再把
// Lumen/QA 位图当作 UI 皮肤。两张图同时挂载，由 IX CSS 按 data-theme 选版，
// 因而主题切换无需重挂载页面。
import ixChatLight from './assets/illos/ix-illo-chat-light.svg?url';
import ixChatDark from './assets/illos/ix-illo-chat-dark.svg?url';
import ixFavoritesLight from './assets/illos/ix-illo-favorites-light.svg?url';
import ixFavoritesDark from './assets/illos/ix-illo-favorites-dark.svg?url';
import ixSearchLight from './assets/illos/ix-illo-search-light.svg?url';
import ixSearchDark from './assets/illos/ix-illo-search-dark.svg?url';
import ixAchievementsLight from './assets/illos/ix-illo-achievements-light.svg?url';
import ixAchievementsDark from './assets/illos/ix-illo-achievements-dark.svg?url';
import ixTheaterLight from './assets/illos/ix-illo-theater-light.svg?url';
import ixTheaterDark from './assets/illos/ix-illo-theater-dark.svg?url';
import ixLeaderboardLight from './assets/illos/ix-illo-leaderboard-light.svg?url';
import ixLeaderboardDark from './assets/illos/ix-illo-leaderboard-dark.svg?url';
import ixNotificationsLight from './assets/illos/ix-illo-notifications-light.svg?url';
import ixNotificationsDark from './assets/illos/ix-illo-notifications-dark.svg?url';
import ixFriendsLight from './assets/illos/ix-illo-friends-light.svg?url';
import ixFriendsDark from './assets/illos/ix-illo-friends-dark.svg?url';
import ixDraftsLight from './assets/illos/ix-illo-drafts-light.svg?url';
import ixDraftsDark from './assets/illos/ix-illo-drafts-dark.svg?url';
import ixWorksLight from './assets/illos/ix-illo-works-light.svg?url';
import ixWorksDark from './assets/illos/ix-illo-works-dark.svg?url';
import ixWorldbookLight from './assets/illos/ix-illo-worldbook-light.svg?url';
import ixWorldbookDark from './assets/illos/ix-illo-worldbook-dark.svg?url';
import ixWalletLight from './assets/illos/ix-illo-wallet-light.svg?url';
import ixWalletDark from './assets/illos/ix-illo-wallet-dark.svg?url';
import ixScriptsLight from './assets/illos/ix-illo-scripts-light.svg?url';
import ixScriptsDark from './assets/illos/ix-illo-scripts-dark.svg?url';
import ixGalleryLight from './assets/illos/ix-illo-gallery-light.svg?url';
import ixGalleryDark from './assets/illos/ix-illo-gallery-dark.svg?url';
import ixOfflineLight from './assets/illos/ix-illo-offline-light.svg?url';
import ixOfflineDark from './assets/illos/ix-illo-offline-dark.svg?url';
import ixMaintenanceLight from './assets/illos/ix-illo-maintenance-light.svg?url';
import ixMaintenanceDark from './assets/illos/ix-illo-maintenance-dark.svg?url';
import ixOnb001Light from './assets/illos/ix-illo-onb-001-light.svg?url';
import ixOnb001Dark from './assets/illos/ix-illo-onb-001-dark.svg?url';
import ixOnb002Light from './assets/illos/ix-illo-onb-002-light.svg?url';
import ixOnb002Dark from './assets/illos/ix-illo-onb-002-dark.svg?url';
import ixOnb003Light from './assets/illos/ix-illo-onb-003-light.svg?url';
import ixOnb003Dark from './assets/illos/ix-illo-onb-003-dark.svg?url';
// 仪与匣（IX-5）：纪念印章三档换设计交付 SVG（铜单环/银双环短芒/金三环长芒；
// 透明底零文字，数字由 UI 活文本叠加）。
import ixStampBronzeUrl from './assets/illos/ix-stamp-bronze.svg?url';
import ixStampSilverUrl from './assets/illos/ix-stamp-silver.svg?url';
import ixStampGoldUrl from './assets/illos/ix-stamp-gold.svg?url';

const IX_ILLUSTRATIONS = {
  chat: { light: ixChatLight, dark: ixChatDark },
  favorites: { light: ixFavoritesLight, dark: ixFavoritesDark },
  search: { light: ixSearchLight, dark: ixSearchDark },
  achievements: { light: ixAchievementsLight, dark: ixAchievementsDark },
  theater: { light: ixTheaterLight, dark: ixTheaterDark },
  leaderboard: { light: ixLeaderboardLight, dark: ixLeaderboardDark },
  notifications: { light: ixNotificationsLight, dark: ixNotificationsDark },
  friends: { light: ixFriendsLight, dark: ixFriendsDark },
  drafts: { light: ixDraftsLight, dark: ixDraftsDark },
  works: { light: ixWorksLight, dark: ixWorksDark },
  worldbook: { light: ixWorldbookLight, dark: ixWorldbookDark },
  wallet: { light: ixWalletLight, dark: ixWalletDark },
  scripts: { light: ixScriptsLight, dark: ixScriptsDark },
  gallery: { light: ixGalleryLight, dark: ixGalleryDark },
  offline: { light: ixOfflineLight, dark: ixOfflineDark },
  maintenance: { light: ixMaintenanceLight, dark: ixMaintenanceDark },
};

// 旧调用方的 kind 名保持可用，但统一落到设计交付包中的 16 个场景。
const IX_KIND_ALIASES = {
  library: 'works',
  atelier: 'works',
  worldbooks: 'worldbook',
  group: 'chat',
  noresult: 'search',
  events: 'maintenance',
  insights: 'gallery',
  generic: 'offline',
};

const IX_ONBOARD = {
  world: { light: ixOnb001Light, dark: ixOnb001Dark },
  craft: { light: ixOnb002Light, dark: ixOnb002Dark },
  tune: { light: ixOnb003Light, dark: ixOnb003Dark },
};

// App 内容媒体出口：引导三屏与连签印章（消费方保持原有命名）。
export const onboardArtUrls = IX_ONBOARD;
export const streakSealUrl = ixStampBronzeUrl;
// 里程碑印章分档（仪与匣三档）：≥100 金三环长芒，≥30 银双环短芒，其余铜单环。
export const streakSealForTier = (streak) => (streak >= 100 ? ixStampGoldUrl : streak >= 30 ? ixStampSilverUrl : ixStampBronzeUrl);

// App 空态：透明底 SVG，说明与 CTA 保持活 DOM；浅深两版同时存在，
// CSS 只显示当前主题，保证系统主题切换时不丢失图片尺寸。
export function AppEmptyArt({ kind = 'generic', size = 132, className }) {
  const scene = IX_ILLUSTRATIONS[IX_KIND_ALIASES[kind] || kind] || IX_ILLUSTRATIONS.offline;
  const classes = ['ix-illustration', className].filter(Boolean).join(' ');
  return (
    <span className={classes} data-ix-scene={IX_KIND_ALIASES[kind] || kind}
      style={{ width: size, height: Math.round(size * 0.825) }} aria-hidden="true">
      <img className="qa5-empty-art ix-illustration__light" src={scene.light}
        width={size} height={Math.round(size * 0.825)} alt="" loading="lazy"
        decoding="async" draggable="false" />
      <img className="qa5-empty-art ix-illustration__dark" src={scene.dark}
        width={size} height={Math.round(size * 0.825)} alt="" loading="lazy"
        decoding="async" draggable="false" />
    </span>
  );
}

// 首启插画使用同一主题选择器，但不暴露内部资源结构给页面。
export function IxOnboardingArt({ step, size = 290, className }) {
  const key = step === 1 ? 'craft' : step === 2 ? 'tune' : 'world';
  const scene = IX_ONBOARD[key];
  const classes = ['ix-illustration', 'ix-onboard-art', className].filter(Boolean).join(' ');
  return (
    <span className={classes} data-ix-scene={`onb-00${step + 1}`}
      style={{ width: size, height: Math.round(size * 0.666) }} aria-hidden="true">
      <img className="ix-illustration__light" src={scene.light} width={size}
        height={Math.round(size * 0.666)} alt="" draggable="false" />
      <img className="ix-illustration__dark" src={scene.dark} width={size}
        height={Math.round(size * 0.666)} alt="" draggable="false" />
    </span>
  );
}

/**
 * High-detail App oracle art for large seed/demo media planes. The imported
 * reviewed raster artwork is intentionally used here: the portrait contains
 * fine hair and fabric detail that a path-only trace visibly degraded. Product
 * UI remains live DOM above it and genuine user media still wins whenever it
 * exists.
 */
export function QuietAquaCharacterArt({ className, alt = '', loading = 'eager', ...imgProps }) {
  return (
    <img
      {...imgProps}
      className={className}
      src={quietAquaCharacterUrl}
      alt={alt}
      loading={loading}
      decoding="async"
      draggable="false"
    />
  );
}

/* ---------------- 确定性哈希：同名永远得到同一套配色与图案 ---------------- */
const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};

// The original static/demo seed generated 400px SVG avatars whose only focal
// content was a 180px monogram. Detect that exact legacy shape so the App can
// substitute the richer vector portrait without hiding genuine user SVG art.
export function isLegacyMonogramCover(src) {
  if (typeof src !== 'string' || !src.toLowerCase().startsWith('data:image/svg+xml')) return false;
  const value = src.toLowerCase();
  return value.includes('%3ctext')
    && (value.includes('font-size%3d%22180%22') || value.includes('font-size="180"'));
}

export function isGeneratedAmbientBackdrop(src) {
  if (typeof src !== 'string' || !src.toLowerCase().startsWith('data:image/svg+xml')) return false;
  let value = src;
  try {
    const comma = src.indexOf(',');
    if (comma >= 0) value = decodeURIComponent(src.slice(comma + 1));
  } catch { /* inspect the encoded source as a safe fallback */ }
  return /width=(?:["']|%22)1280(?:["']|%22)[\s\S]*height=(?:["']|%22)720(?:["']|%22)/i.test(value);
}

/**
 * One media policy for Today, Discover and Character detail. The returned
 * values are raw API media references; callers still pass them through
 * assetUrl. Abstract demo backdrops stay ambient instead of replacing the
 * character focal image.
 */
export function resolveCharacterMedia(character) {
  const background = character?.background || '';
  const avatar = character?.avatar || '';
  const video = character?.background_type === 'video' && Boolean(background);
  const ambient = !video && isGeneratedAmbientBackdrop(background);
  const usableAvatar = avatar && !isLegacyMonogramCover(avatar) ? avatar : '';
  const image = video
    ? usableAvatar
    : (!ambient && background) || usableAvatar || '';
  return {
    kind: video ? 'video' : 'image',
    src: video ? background : image,
    poster: video ? usableAvatar : '',
    ambient: ambient ? background : '',
    useFallback: !image && !video,
  };
}

/* ---------------- 占位封面：双色渐变 + 三款图案轮换 ---------------- */
// 暮色流光家族色：黏土橙 / 湖蓝 / 鎏金 / 暮紫 / 松绿 / 绯陶
const COVER_PALETTES = [
  ['#e0885f', '#7d4468'], ['#4f93a8', '#25445c'], ['#c9a04a', '#7a4a22'],
  ['#9a6ab0', '#3c2a55'], ['#6f9a76', '#2f4a3a'], ['#d0704e', '#6e2f3c'],
];

// App-only fallback portraits. These are code-native vector illustrations
// traced from the Quiet Aqua visual oracle: no bitmap, remote request or text
// baked into the media plane. Web keeps the original monogram covers below.
const APP_COVER_PALETTES = [
  ['#e9f4f2', '#9cc8c1', '#183f3c', '#f1cfc3', '#5e8f89'],
  ['#edf0f4', '#a6b3c3', '#263b48', '#eed0c5', '#718899'],
  ['#f3eee5', '#c4ad89', '#493b32', '#efd0bd', '#8a7561'],
  ['#f0eaf1', '#bba4bc', '#403344', '#efd0c6', '#8f7892'],
];

function AppCoverPortrait({ name, className, uid, h, glyph }) {
  const [sky, haze, hair, skin, cloth] = APP_COVER_PALETTES[h % APP_COVER_PALETTES.length];
  const flipped = Boolean(h & 1);
  const initial = String(name).trim().charAt(0) || '幻';
  return (
    <svg className={'cover-art cover-art--portrait' + (className ? ' ' + className : '')}
      viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label={name || '角色封面'}>
      <defs>
        <linearGradient id={`qaCvBg${uid}`} x1="0" y1="0" x2="0.88" y2="1">
          <stop offset="0" stopColor={sky} />
          <stop offset="0.58" stopColor={haze} />
          <stop offset="1" stopColor={hair} />
        </linearGradient>
        <linearGradient id={`qaCvCloth${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8fbfa" />
          <stop offset="1" stopColor={cloth} />
        </linearGradient>
        <radialGradient id={`qaCvLight${uid}`} cx="30%" cy="18%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.72" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`qaCvSoft${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <rect width="120" height="160" fill={`url(#qaCvBg${uid})`} />
      <circle cx="24" cy="28" r="30" fill="#fff" opacity="0.22" filter={`url(#qaCvSoft${uid})`} />
      <circle cx="104" cy="78" r="38" fill={sky} opacity="0.28" filter={`url(#qaCvSoft${uid})`} />
      <path d="M-8 130 C20 109 42 116 64 105 C84 95 105 96 132 82 L132 168 L-8 168Z" fill={hair} opacity="0.17" />
      <path d="M-8 142 C26 120 50 134 74 119 C92 108 110 112 130 102 L130 168 L-8 168Z" fill="#071f1d" opacity="0.13" />

      <g transform={flipped ? 'translate(120 0) scale(-1 1)' : undefined}>
        {/* Rear hair and shoulders form one calm silhouette at every crop. */}
        <path d="M29 118 C24 86 29 48 56 38 C83 28 100 51 96 83 C94 101 101 117 111 139 L15 139 C24 131 30 124 29 118Z" fill={hair} />
        <path d="M46 102 C45 114 41 119 34 124 C21 133 16 145 14 166 L111 166 C109 145 102 132 87 124 C80 120 77 113 77 102Z" fill={`url(#qaCvCloth${uid})`} />
        <path d="M53 91 C54 103 52 112 47 118 C54 124 70 125 79 116 C73 108 70 100 71 91Z" fill={skin} />
        {/* Face */}
        <path d="M43 58 C46 43 61 37 75 42 C88 47 90 63 86 79 C82 95 73 105 62 104 C49 103 40 86 41 71 C41 66 42 62 43 58Z" fill={skin} />
        <path d="M43 60 C46 45 57 38 71 40 C83 41 91 50 91 63 C84 59 79 53 76 47 C67 57 55 61 43 62Z" fill={hair} />
        <path d="M44 59 C38 74 39 96 50 111 C39 106 32 95 31 79 C31 64 36 51 47 44Z" fill={hair} />
        <path d="M82 48 C94 61 91 86 82 103 C93 98 99 86 98 69 C97 56 91 45 80 41Z" fill={hair} />
        {/* Hair ribbons keep the portrait authored rather than a generic bust. */}
        <path d="M43 61 C56 58 69 51 76 43" fill="none" stroke={haze} strokeWidth="1.2" strokeLinecap="round" opacity="0.58" />
        <path d="M46 47 C37 73 41 103 53 123" fill="none" stroke={haze} strokeWidth="1" strokeLinecap="round" opacity="0.46" />
        <path d="M86 54 C91 78 83 105 72 121" fill="none" stroke={haze} strokeWidth="1" strokeLinecap="round" opacity="0.44" />
        {/* Minimal facial detail survives both cards and full-bleed fallback. */}
        <path d="M50 73 Q55 69 60 73" fill="none" stroke={hair} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M69 72 Q74 69 79 72" fill="none" stroke={hair} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="56" cy="73" r="1.3" fill={hair} />
        <circle cx="74" cy="72" r="1.3" fill={hair} />
        <path d="M64 75 Q62 82 65 83" fill="none" stroke="#a87870" strokeWidth="0.9" strokeLinecap="round" opacity="0.7" />
        <path d="M59 90 Q65 94 71 89" fill="none" stroke="#a85f67" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M40 125 C55 137 78 137 91 124" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.46" />
      </g>

      {/* Quiet botanical/spark detail is vector chrome, never content text. */}
      <g fill="none" stroke="#fff" strokeLinecap="round" opacity="0.58">
        <path d="M96 15 C88 28 90 42 83 53" strokeWidth="1" />
        <path d="M91 26 C84 24 81 20 80 16 M89 34 C97 31 102 27 105 22 M86 43 C80 41 76 38 73 34" strokeWidth="0.8" />
      </g>
      <g fill="#fff" opacity="0.7">
        <circle cx="80" cy="16" r="2" /><circle cx="105" cy="22" r="1.8" /><circle cx="73" cy="34" r="1.6" />
        <path d="M19 34c.6 3 1.4 3.8 4.4 4.4-3 .6-3.8 1.4-4.4 4.4-.6-3-1.4-3.8-4.4-4.4 3-.6 3.8-1.4 4.4-4.4Z" />
      </g>
      <rect width="120" height="160" fill={`url(#qaCvLight${uid})`} />
      {glyph && (
        <g transform="translate(97 137)">
          <circle r="13" fill="#fff" opacity="0.88" />
          <circle r="12.5" fill="none" stroke="#fff" opacity="0.8" />
          <text y="1" textAnchor="middle" dominantBaseline="middle"
            fontFamily="Inter, 'PingFang SC', system-ui, sans-serif" fontWeight="700" fontSize="10"
            fill={hair}>{initial}</text>
        </g>
      )}
    </svg>
  );
}

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
  const app = typeof document !== 'undefined' && document.documentElement.dataset.app === '1';
  if (app) return <AppCoverPortrait name={name} className={className} uid={uid} h={h} glyph={glyph} />;
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
  if (isAppMode()) return <AppEmptyArt kind={kind} size={size} className={className} />;
  const scene = SCENES[kind] || <GenericScene />;
  return (
    <svg className={'empty-art' + (className ? ' ' + className : '')} width={size} height={Math.round(size * 0.825)}
      viewBox="0 0 160 132" fill="none" aria-hidden="true">
      <Stage>{scene}</Stage>
    </svg>
  );
}
