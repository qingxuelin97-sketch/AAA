import React from 'react';
import {
  Wand2, Rocket, Heart, Sprout, Search, Landmark, Gamepad2,
  Flower2, Coffee, Ghost, Swords, Sparkles
} from 'lucide-react';

// Single source of truth for content categories (no emoji — real icons).
export const CAT_ICONS = {
  fantasy: Wand2, scifi: Rocket, romance: Heart, healing: Sprout,
  mystery: Search, history: Landmark, game: Gamepad2, anime: Flower2,
  daily: Coffee, horror: Ghost, wuxia: Swords, other: Sparkles
};
export const CATEGORIES = [
  { slug: 'fantasy', name: '奇幻' }, { slug: 'scifi', name: '科幻' },
  { slug: 'romance', name: '恋爱' }, { slug: 'healing', name: '治愈' },
  { slug: 'mystery', name: '悬疑' }, { slug: 'history', name: '历史' },
  { slug: 'game', name: '游戏' }, { slug: 'anime', name: '二次元' },
  { slug: 'daily', name: '日常' }, { slug: 'horror', name: '惊悚' },
  { slug: 'wuxia', name: '武侠' }, { slug: 'other', name: '其他' }
];
export function CategoryIcon({ slug, size = 15, ...rest }) {
  const Icon = CAT_ICONS[slug] || Sparkles;
  return <Icon size={size} {...rest} />;
}
export const categoryName = (slug) => CATEGORIES.find(c => c.slug === slug)?.name || '';

// Namespaced public IDs so users / characters / scripts don't visually collide.
const PREFIX = { user: 'U', character: 'C', script: 'S' };
export const pid = (type, id) => (PREFIX[type] || '') + id;
// Parse a possibly-prefixed id, returning { type, n } or null.
export function parsePid(raw) {
  const s = String(raw || '').trim().toUpperCase();
  const m = /^([UCS])\s*[-#]?\s*(\d+)$/.exec(s);
  if (m) return { type: { U: 'user', C: 'character', S: 'script' }[m[1]], n: m[2] };
  if (/^\d+$/.test(s)) return { type: null, n: s };
  return null;
}

// Brand mark — 幻域 "moon-gate to the illusory realm": a glassy clay tile with a
// luminous crescent portal and an emerging spark. Drawn as crisp, resolution-free
// SVG. IDs are unique per instance (useId) so multiple logos on one page never
// collide — a fixed id would make a later-removed <defs> break url() fills,
// rendering them black. `radius` is kept for back-compat and mapped onto the tile.
export function Logo({ size = 38, radius }) {
  const raw = React.useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '');
  const tile = `hyT${uid}`, sheen = `hyS${uid}`, moon = `hyM${uid}`, cre = `hyC${uid}`, glow = `hyG${uid}`;
  // Map the legacy 40-grid radius onto the 48 viewBox, clamped to stay a squircle
  // (never a full circle), with a sensible default.
  const rx = radius != null ? Math.max(8, Math.min(16, radius * 1.12)) : 13;
  const spark = 'M31.7 12.4c.62 3.3 1.4 4.08 4.7 4.7-3.3.62-4.08 1.4-4.7 4.7-.62-3.3-1.4-4.08-4.7-4.7 3.3-.62 4.08-1.4 4.7-4.7Z';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="幻域" role="img">
      <defs>
        <linearGradient id={tile} x1="5" y1="2" x2="43" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0a079" />
          <stop offset=".52" stopColor="#dd7d54" />
          <stop offset="1" stopColor="#ad4c29" />
        </linearGradient>
        <radialGradient id={sheen} cx="30%" cy="20%" r="80%">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset="52%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={moon} x1="13" y1="12" x2="31" y2="37" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffe7d6" />
        </linearGradient>
        <mask id={cre}>
          <rect width="48" height="48" fill="#000" />
          <circle cx="22.4" cy="24.6" r="11.3" fill="#fff" />
          <circle cx="27.9" cy="20.2" r="9.5" fill="#000" />
        </mask>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.15" />
        </filter>
      </defs>
      <rect width="48" height="48" rx={rx} fill={`url(#${tile})`} />
      <rect width="48" height="48" rx={rx} fill={`url(#${sheen})`} />
      <rect width="48" height="48" fill={`url(#${moon})`} mask={`url(#${cre})`} />
      <path d={spark} fill="#fff" opacity=".55" filter={`url(#${glow})`} />
      <path d={spark} fill="#fff" />
      <circle cx="15.6" cy="33.4" r="1.15" fill="#fff" opacity=".88" />
    </svg>
  );
}
