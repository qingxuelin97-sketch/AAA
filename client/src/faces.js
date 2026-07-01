// Realistic-style human face preset avatars — drawn as crisp parametric SVG
// (no external images). Distinguishes 男 / 女 via hairstyle, brows, lips and jaw.
// Shared by the avatar picker (UI) and the in-browser backend seed.

const svgUrl = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());

// True for our generated / letter-style SVG avatars (seed a_*.svg, faces.js data
// URIs, etc.). These are tiny 200–400px squares built to be shown inside a small
// circle — stretched edge-to-edge as a full-bleed feed background they blow up
// into one giant glyph. Callers use this to switch to a bounded "portrait" layout
// for vector avatars while keeping real raster photos full-bleed.
export const isVectorAvatar = (u) => !!u && (/\.svg(?:[?#]|$)/i.test(u) || /^data:image\/svg/i.test(u));
const rng = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 9973; return () => (x = (x * 73 + 41) % 9973) / 9973; };

const SKIN_SHADE = (hex) => {
  // darken a hex skin tone ~12% for neck/jaw shading
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 26), g = Math.max(0, ((n >> 8) & 255) - 24), b = Math.max(0, (n & 255) - 22);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

// Build one portrait. gender: 'f' | 'm'.
export function faceAvatar({ bg1 = '#e9d9c4', bg2 = '#cdb79b', skin = '#f0c9a8', hair = '#3a2a1d', cloth = '#6b6f86', eye = '#5a3b28', gender = 'f', id = 0 } = {}) {
  const female = gender === 'f';
  const shade = SKIN_SHADE(skin);
  const faceRx = female ? 40 : 43;
  const faceRy = female ? 50 : 50;
  const chinY = 92 + faceRy;

  // ---- hair (behind) ----
  const backHair = female
    ? `<path d="M46 64 Q40 150 66 184 L80 184 Q60 150 60 96 Q70 64 100 60 Q130 64 140 96 Q140 150 120 184 L134 184 Q160 150 154 64 Q150 20 100 16 Q50 20 46 64 Z" fill="${hair}"/>`
    : '';

  // ---- neck + shoulders ----
  const neck = `<rect x="${female ? 87 : 85}" y="126" width="${female ? 26 : 30}" height="34" rx="10" fill="${shade}"/>`;
  const shoulders = `<path d="M34 200 Q40 156 76 144 L124 144 Q160 156 166 200 Z" fill="${cloth}"/>
    <path d="M34 200 Q40 156 76 144 L84 152 Q70 164 64 200 Z" fill="rgba(0,0,0,0.08)"/>`;

  // ---- face ----
  const face = `<ellipse cx="100" cy="92" rx="${faceRx}" ry="${faceRy}" fill="${skin}"/>
    <ellipse cx="${100 - faceRx + 6}" cy="98" rx="7" ry="11" fill="${skin}"/>
    <ellipse cx="${100 + faceRx - 6}" cy="98" rx="7" ry="11" fill="${skin}"/>
    <path d="M70 120 Q100 ${chinY - 2} 130 120 Q116 ${chinY + 4} 100 ${chinY + 5} Q84 ${chinY + 4} 70 120 Z" fill="${shade}" opacity="0.25"/>`;

  // ---- front hair / fringe ----
  const frontHair = female
    ? `<path d="M56 92 Q52 40 100 36 Q148 40 144 92 Q140 66 126 60 Q120 78 110 64 Q104 80 100 66 Q96 80 90 64 Q80 78 74 60 Q60 66 56 92 Z" fill="${hair}"/>`
    : `<path d="M60 84 Q56 44 100 42 Q144 44 140 84 Q138 64 120 58 Q108 50 100 52 Q92 50 80 58 Q62 64 60 84 Z" fill="${hair}"/>
       <path d="M60 84 Q62 70 72 64 L78 70 Q66 76 64 88 Z" fill="rgba(0,0,0,0.12)"/>`;

  // ---- brows ----
  const brows = female
    ? `<path d="M76 84 Q84 79 93 83" stroke="${hair}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
       <path d="M107 83 Q116 79 124 84" stroke="${hair}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : `<path d="M74 84 Q84 78 95 83" stroke="${hair}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
       <path d="M105 83 Q116 78 126 84" stroke="${hair}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;

  // ---- eyes ----
  const eyeAt = (cx) => `<ellipse cx="${cx}" cy="96" rx="8" ry="${female ? 5.4 : 4.8}" fill="#fff"/>
    <circle cx="${cx}" cy="96" r="3.4" fill="${eye}"/><circle cx="${cx}" cy="96" r="1.7" fill="#1c1410"/>
    <circle cx="${cx - 1.2}" cy="94.6" r="0.9" fill="#fff"/>
    <path d="M${cx - 8} 96 Q${cx} ${88} ${cx + 8} 96" stroke="#3a2a20" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    ${female ? `<path d="M${cx - 8} 95 Q${cx} 87.5 ${cx + 8} 95" stroke="#241712" stroke-width="0.8" fill="none"/>` : ''}`;
  const eyes = eyeAt(84) + eyeAt(116);

  // ---- nose ----
  const nose = `<path d="M100 100 L97 112 Q100 115 103 112" stroke="${shade}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

  // ---- mouth ----
  const mouth = female
    ? `<path d="M90 124 Q100 130 110 124 Q100 134 90 124 Z" fill="#c96a64"/>
       <path d="M90 124 Q100 127 110 124" stroke="#a8504c" stroke-width="1" fill="none"/>`
    : `<path d="M89 125 Q100 130 111 125" stroke="#9a5a4e" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

  // ---- accents ----
  const blush = female
    ? `<ellipse cx="76" cy="112" rx="7" ry="4" fill="#e8917f" opacity="0.35"/><ellipse cx="124" cy="112" rx="7" ry="4" fill="#e8917f" opacity="0.35"/>`
    : `<path d="M72 128 Q100 138 128 128 Q128 134 100 140 Q72 134 72 128 Z" fill="${shade}" opacity="0.18"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <defs><linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs>
    <rect width="200" height="200" fill="url(#bg${id})"/>
    <circle cx="158" cy="40" r="60" fill="#fff" opacity="0.08"/>
    ${backHair}${neck}${shoulders}${face}${frontHair}${brows}${eyes}${nose}${mouth}${blush}
  </svg>`;
  return svgUrl(svg);
}

// Curated, balanced gallery — 6 female + 6 male, varied skin/hair tones.
const RAW = [
  { gender: 'f', skin: '#f3d3b3', hair: '#2c2420', cloth: '#b46d7a', bg1: '#f6e2cf', bg2: '#e3b9a0' },
  { gender: 'f', skin: '#e8b98f', hair: '#5a3b22', cloth: '#5d7b8c', bg1: '#e7d7c0', bg2: '#c2a585' },
  { gender: 'f', skin: '#f0c9a8', hair: '#8a4a2a', cloth: '#7e6aa8', bg1: '#efd9e6', bg2: '#c9a7cf' },
  { gender: 'f', skin: '#d89b6c', hair: '#1f1a17', cloth: '#4f8f86', bg1: '#dfe7d4', bg2: '#a9c2a0' },
  { gender: 'f', skin: '#f3d3b3', hair: '#caa24a', cloth: '#c98a3a', bg1: '#f7ead0', bg2: '#e6c98c' },
  { gender: 'f', skin: '#c98a5a', hair: '#241712', cloth: '#9a5560', bg1: '#ead6cf', bg2: '#c79a93' },
  { gender: 'm', skin: '#f0c9a8', hair: '#241a14', cloth: '#3f5570', bg1: '#dbe3ee', bg2: '#aab9cf' },
  { gender: 'm', skin: '#e8b98f', hair: '#3a2a1d', cloth: '#5a6b54', bg1: '#dde4d6', bg2: '#b3c0a4' },
  { gender: 'm', skin: '#d89b6c', hair: '#15110d', cloth: '#6b5a48', bg1: '#e6dccb', bg2: '#bfa988' },
  { gender: 'm', skin: '#f3d3b3', hair: '#7a4a2a', cloth: '#7a4a4a', bg1: '#ecd9c8', bg2: '#cdac8e' },
  { gender: 'm', skin: '#c98a5a', hair: '#201512', cloth: '#445a66', bg1: '#d6e0e4', bg2: '#a7bcc4' },
  { gender: 'm', skin: '#b9774a', hair: '#161210', cloth: '#5b4f6e', bg1: '#ddd6e6', bg2: '#ad9fc0' }
];

export const FACE_PRESETS = RAW.map((p, i) => ({
  id: 'face-' + i,
  gender: p.gender,
  url: faceAvatar({ ...p, eye: i % 3 === 0 ? '#3a2a20' : i % 3 === 1 ? '#5a3b28' : '#4a6a5a', id: i })
}));

// ---------------------------------------------------------------------------
// Anime (二次元) avatars — large expressive eyes, colorful hair, soft shading.
export function animeAvatar({ bg1 = '#ffd9ec', bg2 = '#c9b8ff', hair = '#6a4bd6', hair2 = '#8f74ff', eye = '#5ad2ff', skin = '#ffe6d4', id = 0, blush = '#ff9ec2' } = {}) {
  const eyeAt = (cx) => `
    <g>
      <ellipse cx="${cx}" cy="212" rx="20" ry="26" fill="#fff"/>
      <ellipse cx="${cx}" cy="214" rx="17" ry="23" fill="${eye}"/>
      <ellipse cx="${cx}" cy="220" rx="17" ry="16" fill="#1b2740" opacity="0.45"/>
      <circle cx="${cx}" cy="216" r="8.5" fill="#15203a"/>
      <ellipse cx="${cx - 6}" cy="203" rx="7" ry="9" fill="#fff" opacity="0.95"/>
      <circle cx="${cx + 5}" cy="224" r="3.2" fill="#fff" opacity="0.8"/>
      <path d="M${cx - 21} 196 Q${cx} 182 ${cx + 21} 196" stroke="#2a2233" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M${cx - 21} 196 L${cx - 23} 189" stroke="#2a2233" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M${cx - 18} 178 Q${cx} 170 ${cx + 18} 178" stroke="${hair}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    </g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <defs><radialGradient id="ab${id}" cx="40%" cy="32%"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></radialGradient>
      <linearGradient id="ah${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="${hair2}"/><stop offset="100%" stop-color="${hair}"/></linearGradient></defs>
    <rect width="400" height="400" fill="url(#ab${id})"/>
    <circle cx="320" cy="80" r="70" fill="#fff" opacity="0.18"/><circle cx="70" cy="330" r="56" fill="#fff" opacity="0.13"/>
    <path d="M96 250 Q70 150 130 96 Q200 54 270 96 Q330 150 304 250 Q300 210 286 196 L286 150 Q200 120 114 150 L114 196 Q100 210 96 250 Z" fill="url(#ah${id})"/>
    <path d="M130 175 Q130 118 200 116 Q270 118 270 175 Q272 244 234 284 Q212 305 200 305 Q188 305 166 284 Q128 244 130 175 Z" fill="${skin}"/>
    <ellipse cx="131" cy="208" rx="8" ry="12" fill="${skin}"/><ellipse cx="269" cy="208" rx="8" ry="12" fill="${skin}"/>
    ${eyeAt(165)}${eyeAt(235)}
    <path d="M197 232 Q200 240 203 232" stroke="#caa18a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M188 258 Q200 268 212 258" stroke="#d77a72" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="150" cy="244" rx="13" ry="7" fill="${blush}" opacity="0.5"/><ellipse cx="250" cy="244" rx="13" ry="7" fill="${blush}" opacity="0.5"/>
    <path d="M114 150 Q150 120 190 138 Q170 150 150 176 Q146 152 132 150 Z" fill="url(#ah${id})"/>
    <path d="M286 150 Q250 120 210 138 Q230 150 250 176 Q254 152 268 150 Z" fill="url(#ah${id})"/>
    <path d="M168 132 Q200 118 232 132 Q214 150 200 150 Q186 150 168 132 Z" fill="url(#ah${id})"/>
    <path d="M196 116 Q188 96 206 90 Q200 104 210 112 Z" fill="${hair2}"/>
  </svg>`;
  return svgUrl(svg);
}

const ANIME_RAW = [
  { hair: '#6a4bd6', hair2: '#9a82ff', eye: '#ff86b6', bg1: '#ffe0ef', bg2: '#cdbcff' },
  { hair: '#e85a8a', hair2: '#ff8fb4', eye: '#7ad7ff', bg1: '#ffe6ee', bg2: '#ffc7dd' },
  { hair: '#2f9e8f', hair2: '#5fccb8', eye: '#ffce5a', bg1: '#d9f5ec', bg2: '#aee3da' },
  { hair: '#3a6ad0', hair2: '#6f9cff', eye: '#ff9a5a', bg1: '#dde8ff', bg2: '#b9ccff' },
  { hair: '#caa23a', hair2: '#ffd96b', eye: '#7c6bff', bg1: '#fff3d6', bg2: '#ffe0a8' },
  { hair: '#9a9aa8', hair2: '#c7c7d8', eye: '#5ad2ff', bg1: '#eef0f6', bg2: '#d3d8ea' },
  { hair: '#d05a5a', hair2: '#ff8a8a', eye: '#5ae0a0', bg1: '#ffe3e0', bg2: '#ffc2bd' },
  { hair: '#5535a8', hair2: '#8a63e0', eye: '#ffd45a', bg1: '#ece0ff', bg2: '#cdb6ff' }
];
export const ANIME_PRESETS = ANIME_RAW.map((p, i) => ({ id: 'anime-' + i, gender: 'a', url: animeAvatar({ ...p, id: 100 + i }) }));

// Draw ONE random anime avatar and return it as a fixed data URL — the result never
// changes again (a "gacha" that locks on draw, no live/random endpoints involved).
export function randomAnimeAvatar() {
  const p = ANIME_RAW[Math.floor(Math.random() * ANIME_RAW.length)];
  const eyes = ['#5ad2ff', '#ff6fa8', '#9a82ff', '#5fd6a0', '#ffb04f', '#ff5a6e'];
  return animeAvatar({ ...p, eye: eyes[Math.floor(Math.random() * eyes.length)], id: Math.floor(Math.random() * 1e6) });
}

// ---------------------------------------------------------------------------
// Chat background presets — layered anime-style scenery (sky gradient, sun/moon,
// mountain silhouettes / city skyline, sakura / stars / bokeh).
function bgPreset({ sky1, sky2, body, bodyOp = 0.9, mtn1, mtn2, kind, accent, seed }) {
  const r = rng(seed); let deco = '';
  if (body) { deco += `<circle cx="1000" cy="172" r="190" fill="${body}" opacity="${0.16 * bodyOp}"/><circle cx="1000" cy="172" r="84" fill="${body}" opacity="${bodyOp}"/>`; }
  if (kind === 'stars') for (let i = 0; i < 110; i++) deco += `<circle cx="${r() * 1280}" cy="${r() * 440}" r="${r() * 1.7 + 0.3}" fill="#fff" opacity="${r() * 0.8 + 0.2}"/>`;
  if (kind === 'city') {
    let bx = 0; while (bx < 1280) { const bw = 42 + r() * 74, bh = 130 + r() * 250, by = 720 - bh;
      deco += `<rect x="${bx}" y="${by}" width="${bw - 6}" height="${bh}" fill="${mtn2}" opacity="0.94"/>`;
      for (let wy = by + 16; wy < 706; wy += 22) for (let wx = bx + 9; wx < bx + bw - 14; wx += 16) if (r() > 0.5) deco += `<rect x="${wx}" y="${wy}" width="6" height="8" fill="${accent}" opacity="${0.45 + r() * 0.5}"/>`;
      bx += bw; }
  } else if (mtn1) {
    deco += `<path d="M0 540 L240 410 L440 520 L680 388 L920 540 L1180 450 L1280 520 L1280 720 L0 720 Z" fill="${mtn1}" opacity="0.5"/>`;
    deco += `<path d="M0 612 L280 510 L560 602 L860 488 L1140 592 L1280 532 L1280 720 L0 720 Z" fill="${mtn2}" opacity="0.86"/>`;
  }
  if (kind === 'sakura') for (let i = 0; i < 30; i++) { const x = r() * 1280, y = r() * 720, s = r() * 11 + 6, rot = r() * 360;
    deco += `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 -${s} Q${s * 0.55} -${s * 0.25} 0 ${s} Q${-s * 0.55} -${s * 0.25} 0 -${s} Z" fill="${accent}" opacity="${0.3 + r() * 0.5}"/></g>`; }
  if (kind === 'bokeh') for (let i = 0; i < 20; i++) deco += `<circle cx="${r() * 1280}" cy="${r() * 720}" r="${r() * 60 + 16}" fill="${accent}" opacity="${0.08 + r() * 0.14}"/>`;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${sky1}"/><stop offset="100%" stop-color="${sky2}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#sk)"/>${deco}</svg>`);
}
// Live anime image galleries from open community APIs. Each endpoint returns a
// random 二次元 image (used directly as <img> / chat background), so the wallpaper
// refreshes every time the chat opens — a lightweight "dynamic" effect. Availability
// depends on these third-party services.
export const ONLINE_BG = [
  { name: '精选二次元', url: 'https://pic.re/image' },
  { name: '横屏动漫壁纸', url: 'https://t.mwm.moe/pc' },
  { name: '竖屏动漫壁纸', url: 'https://t.mwm.moe/mp' },
  { name: '随机二次元', url: 'https://www.loliapi.com/acg/' },
  { name: '二次元竖屏', url: 'https://www.loliapi.com/acg/pe/' },
  { name: '原神场景', url: 'https://api.dujin.org/pic/yuanshen/' },
  { name: '动漫风景', url: 'https://api.btstu.cn/sjbz/api.php?lx=dongman&format=images' }
];
// Live anime avatar galleries (random each load).
export const ONLINE_AV = [
  { name: '精选头像', url: 'https://pic.re/image' },
  { name: '二次元头像', url: 'https://www.loliapi.com/acg/pp/' },
  { name: '动漫头像', url: 'https://api.btstu.cn/sjtx/api.php?lx=c1&format=images' }
];

export const BG_PRESETS = [
  { name: '樱花校园', url: bgPreset({ sky1: '#ffd9ea', sky2: '#fff0f5', body: '#fff2f8', bodyOp: 0.5, mtn1: '#f3b9d2', mtn2: '#e58ab4', kind: 'sakura', accent: '#ff7fb0', seed: 'sak' }) },
  { name: '绯色黄昏', url: bgPreset({ sky1: '#ffb86b', sky2: '#ff7e8a', body: '#fff2c4', bodyOp: 0.95, mtn1: '#c95f7a', mtn2: '#8a3d63', kind: 'bokeh', accent: '#ffe0b0', seed: 'dusk' }) },
  { name: '星空夜幕', url: bgPreset({ sky1: '#1b1d52', sky2: '#090a20', body: '#e2e8ff', bodyOp: 0.92, mtn1: '#2a2a55', mtn2: '#14143a', kind: 'stars', accent: '#9a82ff', seed: 'star' }) },
  { name: '霓虹都市', url: bgPreset({ sky1: '#2a1350', sky2: '#0c0926', body: '#ff6fae', bodyOp: 0, mtn2: '#110d2c', kind: 'city', accent: '#5ad2ff', seed: 'neon' }) },
  { name: '薄荷晴空', url: bgPreset({ sky1: '#9fe0ff', sky2: '#ecfcf4', body: '#ffffff', bodyOp: 0.85, mtn1: '#c2e8cb', mtn2: '#86c79a', kind: 'bokeh', accent: '#ffffff', seed: 'mint' }) },
  { name: '梦幻紫境', url: bgPreset({ sky1: '#caa6ff', sky2: '#f2e9ff', body: '#fff0fb', bodyOp: 0.6, mtn1: '#b78fef', mtn2: '#8a63d8', kind: 'bokeh', accent: '#ffffff', seed: 'dream' }) },
  { name: '森系治愈', url: bgPreset({ sky1: '#cdeebf', sky2: '#f1fae4', body: '#fcffe0', bodyOp: 0.8, mtn1: '#9ccf86', mtn2: '#5d9e63', kind: 'bokeh', accent: '#eaffd0', seed: 'forest' }) },
  { name: '海边夏日', url: bgPreset({ sky1: '#7fd0ff', sky2: '#ffe8c0', body: '#fff4cf', bodyOp: 0.95, mtn1: '#5ab4e0', mtn2: '#2f86c4', kind: 'bokeh', accent: '#ffffff', seed: 'sea' }) }
];

// Palette themes used by the "随机生成（锁定）" draw — each draw randomises particle
// layout via a fresh seed, then returns a fixed data URL so it never re-randomises.
const BG_THEMES = [
  { sky1: '#ffd9ea', sky2: '#fff0f5', body: '#fff2f8', bodyOp: 0.5, mtn1: '#f3b9d2', mtn2: '#e58ab4', kind: 'sakura', accent: '#ff7fb0' },
  { sky1: '#ffb86b', sky2: '#ff7e8a', body: '#fff2c4', bodyOp: 0.95, mtn1: '#c95f7a', mtn2: '#8a3d63', kind: 'bokeh', accent: '#ffe0b0' },
  { sky1: '#1b1d52', sky2: '#090a20', body: '#e2e8ff', bodyOp: 0.92, mtn1: '#2a2a55', mtn2: '#14143a', kind: 'stars', accent: '#9a82ff' },
  { sky1: '#2a1350', sky2: '#0c0926', body: '#ff6fae', bodyOp: 0, mtn2: '#110d2c', kind: 'city', accent: '#5ad2ff' },
  { sky1: '#9fe0ff', sky2: '#ecfcf4', body: '#ffffff', bodyOp: 0.85, mtn1: '#c2e8cb', mtn2: '#86c79a', kind: 'bokeh', accent: '#ffffff' },
  { sky1: '#caa6ff', sky2: '#f2e9ff', body: '#fff0fb', bodyOp: 0.6, mtn1: '#b78fef', mtn2: '#8a63d8', kind: 'sakura', accent: '#ffd0ec' },
  { sky1: '#cdeebf', sky2: '#f1fae4', body: '#fcffe0', bodyOp: 0.8, mtn1: '#9ccf86', mtn2: '#5d9e63', kind: 'bokeh', accent: '#eaffd0' },
  { sky1: '#7fd0ff', sky2: '#ffe8c0', body: '#fff4cf', bodyOp: 0.95, mtn1: '#5ab4e0', mtn2: '#2f86c4', kind: 'bokeh', accent: '#ffffff' },
  { sky1: '#12233f', sky2: '#0a1326', body: '#bfe0ff', bodyOp: 0.9, mtn1: '#1f3a5c', mtn2: '#102036', kind: 'stars', accent: '#7fd6ff' }
];
// Draw ONE random scenery background, frozen as a fixed data URL.
export function randomBg() {
  const t = BG_THEMES[Math.floor(Math.random() * BG_THEMES.length)];
  return bgPreset({ ...t, seed: 'r' + Math.random().toString(36).slice(2, 9) });
}
