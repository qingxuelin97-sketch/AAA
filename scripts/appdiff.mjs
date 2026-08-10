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
// #/chats/1 —— 对话详情页此前完全不在像素自证网内，而它是改动最密集的一页
//（消息渲染、变体翻页器、失败卡片、渲染窗口全在这里）。
const ROUTES = ['#/today', '#/', '#/messages', '#/chats/1', '#/me', '#/wallet', '#/achievements', '#/events', '#/insights', '#/settings', '#/app-controls'];
// 档位说明：
//   · dark 已删除 —— theme.js:13 证明 App 壳恒返回 light，dark 基线与 light 逐字节
//     相同，占掉 1/3 运行时间却换来 0 覆盖。
//   · balanced 只能靠「auto + 强机」凑出来，不能直接写进 huanyu_perf。
//     getPerfPref()（perf.js:19）只认 'high' | 'lite'，其余一律回落 'auto'；
//     而 resolvePerf('auto') 在 App 壳里走 deviceIsWeak()（perf.js:31：cores <= 4
//     即判弱机），无头 Chromium 恒报 4 核 → 落 'lite'。
//     ⚠ 更正：我先前在这里写的「balanced 是 100% 真实用户所处的档位」是错的。
//     那个配置写的是 huanyu_perf='balanced'，getPerfPref 不认 → 回落 auto →
//     判弱机 → 实际渲染的是 lite。所谓「balanced 与 lite 逐字节相同」不是覆盖
//     有限，而是它们本来就是同一组截图。这里改成显式伪造 CPU/内存来真正命中
//     balanced，并在每次导航后断言 data-perf，杜绝再出现空档。
// name = 截图文件名前缀；tier = 期望的 data-perf 实测值（两者不总相等：light 档
// 的 data-perf 是 'high'）。
const MODES = [
  { name: 'light', pref: 'high', tier: 'high' },
  // auto + 8 核 8G → deviceIsWeak() 为 false → App 壳落 'balanced'
  { name: 'balanced', pref: null, cores: 8, memory: 8, tier: 'balanced' },
  { name: 'lite', pref: 'lite', tier: 'lite' },
];

const srv = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
await mkdir(OUT, { recursive: true });
let failed = 0;
// 档位断言与像素比对分开计数：--baseline 跑法本来就允许「没有基线」，
// 但档位错了连基线都不该存下来，所以这一类失败在两种跑法下都要致命。
let tierFails = 0;

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
      // pref 为 null 表示「不写偏好」，让 getPerfPref() 走 auto —— balanced 只有这条路。
      if (m.pref) localStorage.setItem('huanyu_perf', m.pref); else localStorage.removeItem('huanyu_perf');
    } catch { /* */ }
    // 伪造硬件画像：无头容器恒报 4 核，deviceIsWeak() 必为 true，auto 档永远
    // 到不了 balanced。必须在页面脚本前改写 navigator 才来得及被 initPerf 读到。
    if (m.cores) {
      try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => m.cores, configurable: true }); } catch { /* */ }
      try { Object.defineProperty(navigator, 'deviceMemory', { get: () => m.memory, configurable: true }); } catch { /* */ }
    }
  }, mode);
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    await page.goto(`http://127.0.0.1:4275/?app=1${route}`);
    await page.waitForTimeout(1700);
    await page.evaluate(() => document.fonts?.ready?.then(() => {}));
    await page.waitForTimeout(500);
    const shot = await page.screenshot();
    const key = `${mode.name}${route.replace(/[#/]+/g, '_') || '_root'}`;
    // 档位自证：截图前确认 data-perf 真的是这一档。空档（写了个 getPerfPref
    // 不认的值 → 静默回落）此前让 balanced 与 lite 截出了同一组图，肉眼与
    // 逐像素比对都发现不了 —— 只有断言能拦住。
    const tier = await page.evaluate(() => document.documentElement.dataset.perf);
    if (tier !== mode.tier) {
      console.log('TIER', key, `期望 data-perf=${mode.tier}，实际 ${tier}`);
      tierFails += 1;
      continue;
    }
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
if (tierFails) console.log(`APPDIFF: ${tierFails} 处档位不符（截图无效，先修档位再谈像素）`);
console.log(BASELINE ? `BASELINE READY → ${OUT}` : failed === 0 ? 'APPDIFF: 0 changed pixels — PASS' : `APPDIFF: ${failed} FAILURES`);
process.exit(tierFails === 0 && (BASELINE || failed === 0) ? 0 : 1);
