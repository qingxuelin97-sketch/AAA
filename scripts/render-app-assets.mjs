// Liuli v5 · App 内容媒体素材渲染管线。
// 手动运行：node scripts/render-app-assets.mjs  （产物入库，不进 CI）
// 设计约束（APP_UI_ORACLE）：PNG 只能是内容媒体 —— 零文字、零按钮、零导航；
// 产品文字永远是活 DOM。全部素材由本脚本的参数化 SVG 场景确定性生成
// （固定 seed 的 feTurbulence 噪点防色带），Chromium 截图输出 @2x PNG。
// 输出：client/src/assets/app/<id>@2x.png（Vite 哈希指纹，SW 无需 bump）。
import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
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
  // ── S7 扩产：九幕新空态（同一舞台语言，零文字） ──
  achievements: stage(`
    <circle cx="360" cy="206" r="74" fill="url(#pane)" stroke="${P.gold}" stroke-width="5" stroke-opacity="0.55"/>
    <circle cx="360" cy="206" r="44" fill="${P.goldSoft}"/>
    <path d="M 360 176 L 372 200 L 398 204 L 379 222 L 384 248 L 360 236 L 336 248 L 341 222 L 322 204 L 348 200 Z" fill="${P.gold}" opacity="0.85"/>
    <path d="M 330 274 L 316 336 L 344 318 Z" fill="url(#deep)"/>
    <path d="M 390 274 L 404 336 L 376 318 Z" fill="url(#deep)" opacity="0.8"/>
  `),
  theater: stage(`
    <path d="M 232 140 C 252 220 252 268 232 340 L 208 340 L 208 140 Z" fill="url(#deep)"/>
    <path d="M 488 140 C 468 220 468 268 488 340 L 512 340 L 512 140 Z" fill="url(#deep)" opacity="0.88"/>
    <rect x="252" y="140" width="216" height="16" rx="8" fill="url(#deep)" opacity="0.7"/>
    <ellipse cx="360" cy="292" rx="96" ry="30" fill="${P.goldSoft}" opacity="0.9"/>
    <path d="M 316 168 L 360 268 L 404 168 Z" fill="url(#pane)" opacity="0.85"/>
  `),
  atelier: stage(`
    <rect x="252" y="152" width="176" height="200" rx="16" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <rect x="278" y="188" width="118" height="10" rx="5" fill="${P.blueMist}" opacity="0.7"/>
    <rect x="278" y="216" width="92" height="10" rx="5" fill="${P.blueMist}" opacity="0.55"/>
    <rect x="278" y="244" width="106" height="10" rx="5" fill="${P.blueMist}" opacity="0.4"/>
    <path d="M 430 316 C 452 250 486 194 508 164 C 514 190 502 262 452 322 L 436 330 Z" fill="url(#deep)"/>
    <circle cx="436" cy="330" r="9" fill="${P.indigo}"/>
  `),
  leaderboard: stage(`
    <rect x="244" y="230" width="72" height="110" rx="12" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <rect x="324" y="180" width="72" height="160" rx="12" fill="${P.goldSoft}" stroke="${P.gold}" stroke-width="4" stroke-opacity="0.6"/>
    <rect x="404" y="256" width="72" height="84" rx="12" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <circle cx="360" cy="146" r="24" fill="${P.gold}" opacity="0.9"/>
  `),
  events: stage(`
    <rect x="284" y="212" width="152" height="128" rx="14" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <rect x="272" y="184" width="176" height="44" rx="12" fill="url(#deep)"/>
    <rect x="348" y="184" width="24" height="156" fill="${P.rose}" opacity="0.55"/>
    <path d="M 360 184 C 330 150 302 154 300 176 C 298 194 330 192 360 184 Z" fill="${P.rose}" opacity="0.75"/>
    <path d="M 360 184 C 390 150 418 154 420 176 C 422 194 390 192 360 184 Z" fill="${P.rose}" opacity="0.75"/>
  `),
  worldbooks: stage(`
    <path d="M 360 168 C 320 148 268 148 240 162 L 240 322 C 268 308 320 308 360 328 Z" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <path d="M 360 168 C 400 148 452 148 480 162 L 480 322 C 452 308 400 308 360 328 Z" fill="url(#deep)" opacity="0.92"/>
    <rect x="262" y="196" width="72" height="8" rx="4" fill="${P.blueMist}" opacity="0.8"/>
    <rect x="262" y="222" width="58" height="8" rx="4" fill="${P.blueMist}" opacity="0.6"/>
    <circle cx="420" cy="222" r="22" fill="#ffffff" opacity="0.4"/>
  `),
  insights: stage(`
    <rect x="236" y="160" width="118" height="180" rx="14" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <rect x="366" y="160" width="118" height="180" rx="14" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <polyline points="256,300 288,262 316,278 340,222" fill="none" stroke="url(#deep)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="388" y="286" width="20" height="36" rx="6" fill="url(#deep)" opacity="0.65"/>
    <rect x="416" y="252" width="20" height="70" rx="6" fill="url(#deep)"/>
    <rect x="444" y="270" width="20" height="52" rx="6" fill="url(#deep)" opacity="0.8"/>
  `),
  noresult: stage(`
    <circle cx="340" cy="196" r="66" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="6"/>
    <rect x="390" y="252" width="76" height="22" rx="11" transform="rotate(45 390 252)" fill="url(#deep)"/>
    <path d="M 248 330 L 472 330 L 448 296 L 272 296 Z" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <circle cx="322" cy="182" r="8" fill="${P.graphite}" opacity="0.4"/>
    <circle cx="358" cy="182" r="8" fill="${P.graphite}" opacity="0.4"/>
  `),
  group: stage(`
    ${bubble(230, 168, 150, 96, 30, 'url(#pane)')}
    <path d="M 268 264 L 258 296 L 302 266 Z" fill="url(#pane)"/>
    ${bubble(348, 136, 140, 90, 28, 'url(#deep)')}
    <path d="M 424 226 L 436 258 L 388 228 Z" fill="${P.blueDeep}"/>
    ${bubble(310, 252, 130, 84, 26, P.goldSoft)}
    <path d="M 344 336 L 336 364 L 378 338 Z" fill="${P.goldSoft}"/>
  `),
};

// ── S7 首启引导三幕（720×480，内容媒体，零文字）与连签印章 ──
const ONBOARD = {
  world: stage(`
    <circle cx="360" cy="230" r="108" fill="url(#halo)"/>
    <circle cx="360" cy="230" r="108" fill="none" stroke="url(#deep)" stroke-width="18"/>
    <mask id="obWorldMoon">
      <rect width="720" height="480" fill="#ffffff"/>
      <circle cx="404" cy="186" r="34" fill="#000000"/>
    </mask>
    <circle cx="382" cy="204" r="40" fill="url(#deep)" mask="url(#obWorldMoon)" opacity="0.92"/>
    <ellipse cx="236" cy="160" rx="42" ry="14" fill="url(#pane)"/>
    <ellipse cx="492" cy="304" rx="50" ry="16" fill="url(#pane)"/>
    <circle cx="470" cy="140" r="9" fill="${P.gold}" opacity="0.8"/>
    <circle cx="252" cy="312" r="7" fill="${P.rose}" opacity="0.7"/>
  `),
  craft: stage(`
    <rect x="262" y="150" width="156" height="204" rx="18" fill="url(#pane)" stroke="${P.blueMist}" stroke-width="4"/>
    <circle cx="340" cy="212" r="34" fill="url(#deep)" opacity="0.9"/>
    <rect x="292" y="266" width="96" height="10" rx="5" fill="${P.blueMist}" opacity="0.7"/>
    <rect x="292" y="292" width="72" height="10" rx="5" fill="${P.blueMist}" opacity="0.5"/>
    <path d="M 428 322 C 448 262 478 210 500 180 C 506 206 494 272 448 328 L 432 334 Z" fill="url(#deep)"/>
    <path d="M 452 148 L 458 164 L 474 170 L 458 176 L 452 192 L 446 176 L 430 170 L 446 164 Z" fill="${P.gold}" opacity="0.85"/>
  `),
  tune: stage(`
    <rect x="252" y="176" width="216" height="12" rx="6" fill="${P.blueMist}" opacity="0.6"/>
    <circle cx="330" cy="182" r="20" fill="url(#deep)"/>
    <rect x="252" y="238" width="216" height="12" rx="6" fill="${P.blueMist}" opacity="0.6"/>
    <circle cx="416" cy="244" r="20" fill="${P.rose}" opacity="0.85"/>
    <rect x="252" y="300" width="216" height="12" rx="6" fill="${P.blueMist}" opacity="0.6"/>
    <circle cx="366" cy="306" r="20" fill="${P.gold}" opacity="0.85"/>
  `),
};

// 连签印章（320×320 = 160 逻辑 @2x，透明底）：环形玺 + 火种，零文字。
const STREAK_SEAL = `
  <circle cx="160" cy="160" r="120" fill="none" stroke="${P.gold}" stroke-width="14" stroke-opacity="0.85"/>
  <circle cx="160" cy="160" r="96" fill="${P.goldSoft}" opacity="0.5"/>
  <path d="M 160 92 C 190 128 202 152 202 182 C 202 212 184 232 160 232 C 136 232 118 212 118 182 C 118 164 126 148 138 132 C 138 152 146 162 156 164 C 150 140 152 116 160 92 Z"
    fill="${P.gold}" opacity="0.9"/>
  <circle cx="160" cy="196" r="16" fill="#ffffff" opacity="0.5"/>`;

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
  ...Object.entries(ONBOARD).map(([kind, body]) => ({ id: `qa5-onboard-${kind}@2x`, w: 720, h: 480, body })),
  { id: 'qa5-streak-seal@2x', w: 320, h: 320, body: STREAK_SEAL },
  { id: 'qa5-boot-mark@2x', w: 320, h: 320, body: BOOT_MARK },
  { id: 'qa5-boot-mark@3x', w: 480, h: 480, body: `<g transform="scale(1.5)">${BOOT_MARK}</g>` },
  { id: 'qa5-vip-weave@2x', w: 1372, h: 800, body: weave() },
];

const NATIVE = process.argv.includes('--native');
if (NATIVE) JOBS.push(...NATIVE_JOBS);
// 原子产出：全部 JOBS 先落临时目录，成功后一次性换名——半途崩溃不会留下
// 残缺目录（app-test 断言目录完整性，窗口期风险就此消除）。
const OUT_TMP = OUT + '.tmp';
await rm(OUT_TMP, { recursive: true, force: true });
await mkdir(OUT_TMP, { recursive: true });
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
    : join(OUT_TMP, `${job.id}.png`);
  await writeFile(file, buf);
  console.log(job.id, `${(buf.length / 1024).toFixed(1)}KB`);
  if (job.out !== 'resources' && buf.length > 300 * 1024) throw new Error(`${job.id} exceeds the 300KB asset ceiling`);
}
await browser.close();
await rm(OUT, { recursive: true, force: true });
await rename(OUT_TMP, OUT);
console.log('done →', OUT);
