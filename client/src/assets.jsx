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

// Brand mark — a clay crescent + spark, drawn as crisp SVG (replaces emoji logo).
export function Logo({ size = 38, radius = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-label="幻域" role="img">
      <defs>
        <linearGradient id="huanyuLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dd8662" />
          <stop offset="100%" stopColor="#b3522f" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx={radius} fill="url(#huanyuLogoGrad)" />
      <circle cx="19" cy="20" r="9.5" fill="#fff" opacity="0.96" />
      <circle cx="23.5" cy="17.5" r="8.2" fill="url(#huanyuLogoGrad)" />
      <path d="M27.4 23.2l0.7 2 2 0.7-2 0.7-0.7 2-0.7-2-2-0.7 2-0.7z" fill="#fff" />
    </svg>
  );
}
