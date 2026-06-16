import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
fs.mkdirSync(dir, { recursive: true });

function write(name, svg) {
  fs.writeFileSync(path.join(dir, name), svg.trim());
  return '/uploads/' + name;
}
const rnd = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 9973; return () => (x = (x * 73 + 41) % 9973) / 9973; };

function avatar(name, c1, c2, emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient></defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="300" cy="110" r="140" fill="#ffffff" opacity="0.08"/>
  <circle cx="90" cy="320" r="100" fill="#000000" opacity="0.12"/>
  <text x="200" y="250" font-size="150" text-anchor="middle">${emoji}</text>
  </svg>`;
  return write(name, svg);
}
function bg(name, c1, c2, c3, kind) {
  const r = rnd(name); let deco = '';
  if (kind === 'stars') { for (let i = 0; i < 70; i++) deco += `<circle cx="${r()*1280}" cy="${r()*720}" r="${r()*1.8+0.4}" fill="#fff" opacity="${r()*0.8+0.2}"/>`; }
  else if (kind === 'forest') { for (let i = 0; i < 16; i++) { const x = r()*1280; deco += `<polygon points="${x},${260+r()*200} ${x-70},${720} ${x+70},${720}" fill="${c3}" opacity="${0.3+r()*0.4}"/>`; } }
  else { for (let i = 0; i < 24; i++) deco += `<circle cx="${r()*1280}" cy="${r()*720}" r="${r()*120+20}" fill="${c3}" opacity="0.10"/>`; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>${deco}</svg>`;
  return write(name, svg);
}

const upd = db.prepare('UPDATE characters SET avatar=?, background=?, background_type=? WHERE id=?');
const byName = (n) => db.prepare('SELECT id FROM characters WHERE name=? LIMIT 1').get(n)?.id;
const set = (n, av, bgp) => { const id = byName(n); if (id) upd.run(av, bgp, 'image', id); };

set('森灵 · 薇尔', avatar('a_veil.svg', '#3fae7d', '#15402f', '🧝‍♀️'), bg('bg_forest.svg', '#1d4d39', '#0c2018', '#0a3322', 'forest'));
set('机械管家 · 赛斯', avatar('a_seth.svg', '#c79a5b', '#5a3d1f', '🤖'), bg('bg_steam.svg', '#4a3722', '#1c130a', '#b07d3c', 'soft'));
set('星界旅人 · 莉雅', avatar('a_lia.svg', '#a779ff', '#2a1a55', '🌙'), bg('bg_star.svg', '#241a4a', '#0c0b20', '#fff', 'stars'));
set('赛博侦探 · K', avatar('a_k.svg', '#37d6e0', '#10303a', '🕵️'), bg('bg_cyber.svg', '#0e2a3a', '#1a0f2e', '#ff4f9d', 'soft'));
set('猫娘咖啡店长 · 棉花', avatar('a_mochi.svg', '#ff9ec4', '#6e2f4d', '🐱'), bg('bg_cafe.svg', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'));

// Cover images for posts that mirror the linked character art.
const posts = db.prepare('SELECT id, title FROM posts').all();
const coverFor = { '星界旅人 · 莉雅': '/uploads/a_lia.svg', '赛博侦探 · K': '/uploads/a_k.svg', '猫娘咖啡店长 · 棉花': '/uploads/a_mochi.svg',
  '【多结局】雾港谜案': bg('cv_fog.svg', '#2b3a4a', '#10171f', '#5a7a96', 'soft'),
  '咖啡店的一百个午后': bg('cv_cafe.svg', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'),
  '猎户座最后的信号': bg('cv_orion.svg', '#1a2350', '#080a18', '#fff', 'stars') };
const updp = db.prepare('UPDATE posts SET cover=? WHERE id=?');
posts.forEach(p => { if (coverFor[p.title]) updp.run(coverFor[p.title], p.id); });

console.log('🎨 角色立绘、背景与封面已生成。');
