// Realistic-style human face preset avatars — drawn as crisp parametric SVG
// (no external images). Distinguishes 男 / 女 via hairstyle, brows, lips and jaw.
// Shared by the avatar picker (UI) and the in-browser backend seed.

const svgUrl = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());

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
