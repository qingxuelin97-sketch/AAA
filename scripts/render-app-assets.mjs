// Liuli v5 · App 内容媒体素材渲染管线。
// 手动运行：node scripts/render-app-assets.mjs  （产物入库，不进 CI）
// 设计约束（APP_UI_ORACLE）：PNG 只能是内容媒体 —— 零文字、零按钮、零导航；
// 产品文字永远是活 DOM。全部素材由本脚本的参数化 SVG 场景确定性生成
// （固定 seed 的 feTurbulence 噪点防色带），Chromium 截图输出 @2x PNG。
// 输出：client/src/assets/app/<id>@2x.png（Vite 哈希指纹，SW 无需 bump）。
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'client/src/assets/app');

// ── 琉璃调色板（与 app-quiet-aqua-tokens.css 对齐；此处按内容媒体允许渐变） ──
// Lumen Glass v1.0 内容媒体近似色（UI 层禁新增颜色；PNG 媒体按令牌 oklch 栅格化取近似 hex）
const P = {
  canvas: '#EDEFF6', grouped: '#E3E7F0', ink: '#12151E',
  blue: '#5658c8', blueDeep: '#4547ad', blueSoft: '#e9eafb', blueMist: '#c9cdf7',
  graphite: '#525A6E', gold: '#a07100', goldSoft: '#f0e9d3',
  coral: '#c65238', rose: '#b04a76', indigo: '#7b5cc2', success: '#1d7a53',
};

// 共用 defs：细噪点（固定 seed）、玻璃渐变、柔和投影。
const DEFS = `
  <filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n"/>
    <feColorMatrix in="n" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.028 0" result="g"/>
    <feComposite in="g" in2="SourceGraphic" operator="over"/>
  </filter>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#101623" flood-opacity="0.10"/>
  </filter>
  <linearGradient id="pane" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.92"/>
    <stop offset="1" stop-color="${P.blueSoft}" stop-opacity="0.78"/>
  </linearGradient>
  <linearGradient id="deep" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${P.blue}"/>
    <stop offset="1" stop-color="${P.blueDeep}"/>
  </linearGradient>
  <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
    <stop offset="0" stop-color="${P.blueMist}" stop-opacity="0.55"/>
    <stop offset="1" stop-color="${P.blueMist}" stop-opacity="0"/>
  </radialGradient>`;

// 琉璃境舞台：柔光（扁平低透明椭圆两层，PNG 友好）+ 月门残弧 + 瓷白地台。
const stage = (inner) => `
  <rect width="720" height="480" fill="none"/>
  <ellipse cx="360" cy="248" rx="292" ry="200" fill="${P.blueMist}" opacity="0.16"/>
  <ellipse cx="360" cy="244" rx="206" ry="146" fill="${P.blueMist}" opacity="0.18"/>
  <path d="M 208 336 A 152 152 0 1 1 512 336" fill="none" stroke="${P.blueMist}" stroke-width="10" stroke-linecap="round" opacity="0.8"/>
  <ellipse cx="360" cy="368" rx="196" ry="26" fill="${P.grouped}"/>
  <g filter="url(#soft)">${inner}</g>`;

const bubble = (x, y, w, h, r, fill, stroke) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="4"` : ''}/>`;

// ── 每个空态一幕（抽象几何，无文字） ──
const SCENES = {
  chat: stage(`
    ${bubble(196, 168, 220, 132, 40, 'url(#pane)')}
    <path d="M 252 300 L 240 344 L 300 302 Z" fill="url(#pane)"/>
    <circle cx="266" cy="234" r="10" fill="${P.graphite}" opacity="0.5"/>
    <circle cx="306" cy="234" r="10" fill="${P.graphite}" opacity="0.5"/>
    <circle cx="346" cy="234" r="10" fill="${P.graphite}" opacity="0.5"/>
    ${bubble(430, 128, 132, 88, 30, 'url(#deep)')}
    <path d="M 508 216 L 522 252 L 468 218 Z" fill="${P.blueDeep}"/>
  `),
  favorites: stage(`
    <path d="M 360 320 C 300 276 252 240 252 196 C 252 160 280 138 312 138 C 336 138 352 152 360 168 C 368 152 384 138 408 138 C 440 138 468 160 468 196 C 468 240 420 276 360 320 Z"
      fill="url(#pane)" stroke="${P.rose}" stroke-width="5" stroke-opacity="0.55"/>
    <circle cx="360" cy="212" r="30" fill="${P.rose}" opacity="0.16"/>
  `),
  notifications: stage(`
    <path d="M 360 132 C 310 132 282 168 282 214 L 282 268 L 262 296 L 458 296 L 438 268 L 438 214 C 438 168 410 132 360 132 Z"
      fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <circle cx="360" cy="326" r="20" fill="url(#deep)"/>
    <circle cx="436" cy="150" r="14" fill="${P.coral}" opacity="0.85"/>
  `),
  friends: stage(`
    <circle cx="308" cy="196" r="52" fill="url(#pane)"/>
    <path d="M 224 330 C 224 282 262 258 308 258 C 354 258 392 282 392 330 Z" fill="url(#pane)"/>
    <circle cx="428" cy="208" r="42" fill="url(#deep)" opacity="0.92"/>
    <path d="M 360 330 C 364 292 394 272 428 272 C 464 272 494 294 496 330 Z" fill="url(#deep)" opacity="0.92"/>
  `),
  search: stage(`
    <circle cx="342" cy="216" r="86" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="6"/>
    <circle cx="342" cy="216" r="54" fill="${P.blueSoft}" opacity="0.5"/>
    <rect x="404" y="288" width="96" height="26" rx="13" transform="rotate(45 404 288)" fill="url(#deep)"/>
  `),
  library: stage(`
    <rect x="236" y="152" width="64" height="196" rx="12" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <rect x="312" y="128" width="72" height="220" rx="12" fill="url(#deep)"/>
    <rect x="396" y="164" width="64" height="184" rx="12" fill="${P.goldSoft}" stroke="${P.gold}" stroke-width="4" stroke-opacity="0.5"/>
    <rect x="330" y="156" width="36" height="8" rx="4" fill="#ffffff" opacity="0.55"/>
  `),
  generic: stage(`
    <circle cx="360" cy="224" r="96" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="6"/>
    <path d="M 288 224 A 72 72 0 0 1 432 224" fill="none" stroke="url(#deep)" stroke-width="14" stroke-linecap="round"/>
    <circle cx="360" cy="286" r="14" fill="url(#deep)"/>
  `),
};

// 开机徽记：月门 + 上弦月（320×320 = 160 逻辑 @2x，透明底）。
const BOOT_MARK = `
  <mask id="crescent">
    <rect width="320" height="320" fill="#ffffff"/>
    <circle cx="222" cy="100" r="46" fill="#000000"/>
  </mask>
  <circle cx="160" cy="160" r="118" fill="none" stroke="url(#deep)" stroke-width="22"/>
  <circle cx="160" cy="160" r="118" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.35"/>
  <circle cx="188" cy="124" r="54" fill="url(#deep)" mask="url(#crescent)"/>`;

// SVIP 卡织纹：金调细斜纹（1372×800 = 686×400 @2x），叠加于 CSS 底色之上。
const weave = () => {
  let lines = '';
  for (let i = -800; i < 1500; i += 40) {
    lines += `<line x1="${i}" y1="0" x2="${i + 560}" y2="800" stroke="#ffffff" stroke-width="2" stroke-opacity="${i % 120 === 0 ? 0.12 : 0.06}"/>`;
  }
  return `<rect width="1372" height="800" fill="none"/>${lines}
    <radialGradient id="wsheen" cx="0.22" cy="0.1" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.20"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <rect width="1372" height="800" fill="url(#wsheen)"/>`;
};

// 噪点不铺满画布（高熵会让 PNG 无法压缩）：只在主形体区域内做一层
// 低频微噪，其余交给柔和渐变（小值域下 8-bit 色带不可见）。
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${DEFS}</defs>${body}</svg>`;

// 原生启动资产（node scripts/render-app-assets.mjs --native 时一并生成）：
// capacitor-assets 的源图 —— 图标 = 群青底 + 白月门；splash logo = 群青月门。
const markAt = (scale, stroke, moon) => `
  <g transform="scale(${scale})">
    <mask id="crescentN">
      <rect width="320" height="320" fill="#ffffff"/>
      <circle cx="222" cy="100" r="46" fill="#000000"/>
    </mask>
    <circle cx="160" cy="160" r="118" fill="none" stroke="${stroke}" stroke-width="22"/>
    <circle cx="188" cy="124" r="54" fill="${moon}" mask="url(#crescentN)"/>
  </g>`;
const NATIVE_JOBS = [
  { id: 'icon-background', out: 'resources', w: 1024, h: 1024, body: `<rect width="1024" height="1024" fill="${P.blue}"/>` },
  { id: 'icon-foreground', out: 'resources', w: 1024, h: 1024,
    body: `<g transform="translate(224 224)">${markAt('1.8', '#ffffff', '#ffffff')}</g>` },
  { id: 'icon-only', out: 'resources', w: 1024, h: 1024,
    body: `<rect width="1024" height="1024" fill="${P.blue}"/><g transform="translate(224 224)">${markAt('1.8', '#ffffff', '#ffffff')}</g>` },
  { id: 'logo', out: 'resources', w: 1024, h: 1024,
    body: `<g transform="translate(224 224)">${markAt('1.8', "url(#deep)", "url(#deep)")}</g>` },
];

const JOBS = [
  ...Object.entries(SCENES).map(([kind, body]) => ({ id: `qa5-empty-${kind}@2x`, w: 720, h: 480, body })),
  { id: 'qa5-boot-mark@2x', w: 320, h: 320, body: BOOT_MARK },
  { id: 'qa5-boot-mark@3x', w: 480, h: 480, body: `<g transform="scale(1.5)">${BOOT_MARK}</g>` },
  { id: 'qa5-vip-weave@2x', w: 1372, h: 800, body: weave() },
];

const NATIVE = process.argv.includes('--native');
if (NATIVE) JOBS.push(...NATIVE_JOBS);
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
for (const job of JOBS) {
  const markup = svg(job.w, job.h, job.body);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><div id="a" style="width:${job.w}px;height:${job.h}px">${markup}</div></body></html>`);
  const el = await page.$('#a');
  const buf = await el.screenshot({ omitBackground: true });
  const file = job.out === 'resources'
    ? join(ROOT, 'resources', `${job.id}.png`)
    : join(OUT, `${job.id}.png`);
  await writeFile(file, buf);
  console.log(job.id, `${(buf.length / 1024).toFixed(1)}KB`);
  if (job.out !== 'resources' && buf.length > 300 * 1024) throw new Error(`${job.id} exceeds the 300KB asset ceiling`);
}
await browser.close();
console.log('done →', OUT);
