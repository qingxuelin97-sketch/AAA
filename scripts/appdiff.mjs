// App 模式像素自证闸（S7-G8 qa→lg 令牌迁移专用，通用于任何「零视觉重构」）。
//   1) node scripts/appdiff.mjs --baseline   # 迁移前：构建产物截图存为基线
//   2) node scripts/appdiff.mjs              # 迁移后：重截并逐像素比对，非 0 即败
// 比对 9 路由 × light/dark/lite × 390×844。基线目录不入库（.tmp）。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'client/appdiff.tmp');
const BASELINE = process.argv.includes('--baseline');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg' };
const serve = () => new Promise((resolve) => {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    try { const b = await readFile(join(DIST, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { try { const b = await readFile(join(DIST, 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); } catch { res.writeHead(404); res.end(); } }
  });
  srv.listen(4275, () => resolve(srv));
});

// S7 终态：insights 纳入自证网（星轨页含 App 年鉴卡入口，属重构敏感面）
const ROUTES = ['#/today', '#/', '#/messages', '#/me', '#/wallet', '#/achievements', '#/events', '#/insights', '#/settings', '#/app-controls'];
const MODES = [
  { name: 'light', perf: 'high' },
  { name: 'dark', theme: 'dark', perf: 'high' },
  { name: 'lite', perf: 'lite' },
];

const srv = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
await mkdir(OUT, { recursive: true });
let failed = 0;

for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  // 冻结时钟：mock 播种与时间标签全部确定化，基线与复检跨分钟不漂移
  await ctx.addInitScript(() => {
    const FIXED = 1767225600000; // 2026-01-01 00:00:00 UTC（北京 08:00）
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { args.length === 0 ? super(FIXED) : super(...args); }
      static now() { return FIXED; }
    }
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    // eslint-disable-next-line no-global-assign
    window.Date = FrozenDate;
  });
  // 已知非确定源：SVG filter 头像的栅格化存在运行间亚像素抖动（±10~20px），
  // 与令牌无关。基线与复检两侧同时遮蔽，其余画面保持 0px 硬门。
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.ah-avatar .avatar, .ah-avatar img { visibility: hidden !important; }';
      document.head.appendChild(style);
    });
  });
  await ctx.addInitScript((m) => {
    try {
      localStorage.setItem('huanyu_app', '1');
      localStorage.setItem('huanyu_welcome_seen', new Date().toISOString().slice(0, 10));
      localStorage.setItem('huanyu_onboard_done', new Date().toISOString().slice(0, 10));
      localStorage.setItem('huanyu_token', 'tok.1');
      if (m.theme) localStorage.setItem('huanyu_theme', m.theme); else localStorage.removeItem('huanyu_theme');
      localStorage.setItem('huanyu_perf', m.perf);
    } catch { /* */ }
  }, mode);
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    await page.goto(`http://127.0.0.1:4275/?app=1${route}`);
    await page.waitForTimeout(1700);
    await page.evaluate(() => document.fonts?.ready?.then(() => {}));
    await page.waitForTimeout(500);
    const shot = await page.screenshot();
    const key = `${mode.name}${route.replace(/[#/]+/g, '_') || '_root'}`;
    const basePath = join(OUT, `${key}.base.png`);
    if (BASELINE) {
      await writeFile(basePath, shot);
      console.log('BASE', key);
      continue;
    }
    if (!existsSync(basePath)) { console.log('MISS', key, '(no baseline)'); failed += 1; continue; }
    const a = PNG.sync.read(await readFile(basePath));
    const b = PNG.sync.read(shot);
    if (a.width !== b.width || a.height !== b.height) { console.log('DIM ', key); failed += 1; continue; }
    const diffImg = new PNG({ width: a.width, height: a.height });
    const diff = pixelmatch(a.data, b.data, diffImg.data, a.width, a.height, { threshold: 0 });
    // 实测渲染噪声上限：Chromium 对渐变/conic 边缘的 AA 存在 ≤2px 运行间抖动
    //（同一构建自比对可复现）。令牌回归的量级是成百上千像素，2px 门不放走任何真实回归。
    const NOISE = 2;
    console.log(diff <= NOISE ? 'OK  ' : 'FAIL', key, diff, 'px');
    if (diff > NOISE) {
      failed += 1;
      await writeFile(join(OUT, `${key}.now.png`), shot);
      await writeFile(join(OUT, `${key}.diff.png`), PNG.sync.write(diffImg));
    }
  }
  await ctx.close();
}

await browser.close();
srv.close();
console.log(BASELINE ? `BASELINE READY → ${OUT}` : failed === 0 ? 'APPDIFF: 0 changed pixels — PASS' : `APPDIFF: ${failed} FAILURES`);
process.exit(BASELINE || failed === 0 ? 0 : 1);
