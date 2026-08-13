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
  // D5/D3 状态帧：毛玻璃关 与 强调色 dusk 是两条真实的用户可达状态，
  // 级联清理（cssaudit 批次）若只在默认态过闸，会漏掉只在这两态生效的规则。
  // attrs = 导航后必须实测到的 <html> dataset（同 tier 断言：错态的截图不许入库）。
  { name: 'glassoff', pref: 'high', tier: 'high', extra: { huanyu_glass: '0' }, attrs: { glass: 'off' } },
  { name: 'accentdusk', pref: 'high', tier: 'high', extra: { huanyu_accent: 'dusk' }, attrs: { accent: 'dusk' } },
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
  // 已知非确定源：SVG 图形的栅格化存在运行间亚像素抖动，与令牌无关。
  //   · .ah-avatar —— SVG filter 头像（±10~20px）；
  //   · .msgs-entry-ic svg —— 消息页三个圆形入口里的 lucide 图标字形。实测同一构建
  //     自比对会在 0px 与 1329px 之间反复横跳，差异区恰好是三个图标的字形本身
  //     （包围盒 18px 宽、跨三个圆），画面其余部分逐像素相同。
  // 一个会随机报 1329px 的闸门比没有闸门更糟 —— 它教人忽略失败。基线与复检两侧
  // 同时遮蔽，其余画面保持 0px 硬门。
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      // 2026-08-11 追记：只藏 svg 已不够。对照实验（同源码重建 vs 同源基线）在
      // balanced/accentdusk 两档的消息页稳定复现 1338/1343px 差异，bbox 是
      // x52-70 一条竖条跨三个圆形入口 —— 跨构建的光栅化漂移（同构建内逐位稳定，
      // 两次复跑像素数相同）。圆形入口整体并入遮蔽；渐变芯片的样式覆盖由其它
      // 页面的同款芯片（设置行/宫格）继续承担。
      //
      // ⚠ 已知盲区（设计审计发现，必须记在这里）：这条遮蔽罩住的是**整个元素**，
      // 不只是注释里说的 svg。后果是 /messages 这一帧对「芯片本身长什么样」是瞎的 ——
      // 底色、圆角、投影的改动在闸门里看不见。D7 撤形的第 ③ 处落点正好在这里。
      // 收窄条件：撤形把渐变底换成平色淡染之后，上面那条光栅漂移的来源（渐变 dithering）
      // 消失，届时把遮蔽收回 `.msgs-entry-ic svg` 并复跑三次确认稳定。
      // 在那之前，/messages 对芯片类改动**不是证据帧**，别拿它当通过依据。
      style.textContent = '.ah-avatar .avatar, .ah-avatar img, .msgs-entry-ic { visibility: hidden !important; }';
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
      for (const [k, v] of Object.entries(m.extra || {})) localStorage.setItem(k, v);
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
    // fullPage：此前是 page.screenshot() 无参 —— 只拍视口顶部 844px。设计审计实测出的
    // 后果是一整类改动既证不实也证不伪：底部死区（108→40px）、成就页的小字号、空态、
    // 浮层投影，全部落在折叠线以下。改成整页取样，取样面从「首屏」扩到「整页」。
    // ⚠ 换成 fullPage 会让全部基线的高度改变，所以这次改动必须单独提交、单独重建基线，
    // 不能与任何源码删改同批 —— 否则那一次运行不构成自证。
    const shot = await page.screenshot({ fullPage: true });
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
    // glassoff / accentdusk 两档同理：dataset 没落上就说明状态没生效，截图无效。
    let attrBad = false;
    for (const [attr, want] of Object.entries(mode.attrs || {})) {
      const got = await page.evaluate((a) => document.documentElement.dataset[a], attr);
      if (got !== want) { console.log('ATTR', key, `期望 data-${attr}=${want}，实际 ${got}`); tierFails += 1; attrBad = true; }
    }
    if (attrBad) continue;
    // ── 材质预算探针（报告模式：只打印，不断言）──
    // 三档的材质预算此前没有任何量化。先量一段时间、把数字摊开，再谈阈值 ——
    // 直接开断言会让 CI 当天红，而红着的 CI 会训练人忽略 CI。
    // ⚠ 严格只读：不许注入元素或类名，否则探针自己会扰动这 55 帧基线。
    // ⚠ 已知偏差：被上面那条遮蔽 visibility:hidden 的元素，getComputedStyle 照样返回
    //   backdrop-filter 值，所以 blur 面数把 .msgs-entry-ic 也算了进来。
    const probe = await page.evaluate(() => {
      let blurFaces = 0, maxBlur = 0, maxShadow = 0, loops = 0, glassArea = 0;
      const vw = innerWidth * innerHeight;
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const bf = cs.backdropFilter || cs.webkitBackdropFilter;
        if (bf && bf !== 'none') {
          blurFaces += 1;
          const m = /blur\((\d+(?:\.\d+)?)px\)/.exec(bf);
          if (m) maxBlur = Math.max(maxBlur, parseFloat(m[1]));
          const r = el.getBoundingClientRect();
          glassArea += Math.max(0, r.width) * Math.max(0, r.height);
        }
        if (cs.animationIterationCount.split(',').some((v) => v.trim() === 'infinite')
            && cs.animationName !== 'none') loops += 1;
        for (const s of (cs.boxShadow || '').matchAll(/(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/g)) {
          maxShadow = Math.max(maxShadow, parseFloat(s[2]));
        }
      }
      return { blurFaces, maxBlur, maxShadow, loops, glassPct: vw ? Math.round(glassArea / vw * 100) : 0 };
    });
    console.log(`  probe ${key.padEnd(26)} blur面 ${String(probe.blurFaces).padStart(3)} · 最大半径 ${String(probe.maxBlur).padStart(4)}px · 玻璃覆盖 ${String(probe.glassPct).padStart(4)}% · 同屏循环 ${String(probe.loops).padStart(3)} · 最大外投影 ${probe.maxShadow}px`);
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
