// 单帧快检：build 后对指定路由（默认 settings）× light 档截图，与 55 帧基线比对
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
const route = process.argv[2] || '#/settings';
const key = 'light' + route.replace(/[#/]+/g, '_');
const DIST = 'client/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = await new Promise((r) => { const s = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { const b = await readFile(join(DIST, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); } catch { const b = await readFile(join(DIST, 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); } }); s.listen(4310, () => r(s)); });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  const FIXED = 1767225600000; const R = Date;
  class F extends R { constructor(...x) { x.length === 0 ? super(FIXED) : super(...x); } static now() { return FIXED; } }
  F.parse = R.parse; F.UTC = R.UTC; window.Date = F;
  const d = new Date().toISOString().slice(0, 10);
  localStorage.setItem('huanyu_app', '1'); localStorage.setItem('huanyu_welcome_seen', d);
  localStorage.setItem('huanyu_onboard_done', d); localStorage.setItem('huanyu_token', 'tok.1');
  localStorage.setItem('huanyu_perf', 'high');
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.ah-avatar .avatar, .ah-avatar img, .msgs-entry-ic { visibility: hidden !important; }';
    document.head.appendChild(style);
  });
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4310/?app=1' + route);
await page.waitForTimeout(1700);
await page.evaluate(() => document.fonts?.ready?.then(() => {}));
await page.waitForTimeout(500);
const shot = PNG.sync.read(await page.screenshot());
const base = PNG.sync.read(await readFile('client/appdiff.tmp/' + key + '.base.png'));
const diffImg = new PNG({ width: base.width, height: base.height });
const diff = pixelmatch(base.data, shot.data, diffImg.data, base.width, base.height, { threshold: 0 });
const { writeFile } = await import('node:fs/promises');
const OUT = '/tmp/claude-0/-home-user-AAA/587d8189-554b-5d5d-86b9-d5feccff2d16/scratchpad/';
const sbs = new PNG({ width: base.width * 2 + 8, height: base.height });
for (let y = 0; y < base.height; y++) for (let x = 0; x < sbs.width; x++) {
  const o = (y * sbs.width + x) * 4;
  let src = null, sx = x;
  if (x < base.width) src = base; else if (x >= base.width + 8) { src = shot; sx = x - base.width - 8; }
  if (!src) { sbs.data[o] = 255; sbs.data[o + 3] = 255; continue; }
  const i = (y * src.width + sx) * 4;
  for (let c = 0; c < 4; c++) sbs.data[o + c] = src.data[i + c];
}
await writeFile(OUT + 'fast_sbs.png', PNG.sync.write(sbs));
console.log('FASTCHECK', key, diff, 'px');
await browser.close(); srv.close();
process.exit(diff <= 2 ? 0 : 1);
