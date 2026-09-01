// 启动冒烟：把每一条路由在**两个壳**里各挂载一次，拦下「进去就崩」这一类。
//
// 为什么需要它：像素闸只看 11 条路由的画面，守卫只看 CSS 与源码文本，
// 两者都不会执行页面。S1 修掉的 PublicShell 漏 import 是个 ReferenceError ——
// /help 与 /features 在两个壳里都是错误边界，而**全套测试没有一条能发现它**。
// 那类缺陷只有真把页面挂起来才看得见。
//
// 判失败的四条（任一即失败）：
//   ① 页面抛出未捕获异常（pageerror）；
//   ② 掉进了错误边界 —— .route-crash（路由级）或 .app-crash（根级）；
//   ③ 控制台出现真 JS 异常（ReferenceError / TypeError / ...）；
//   ④ 挂载后主内容区基本是空的（文本 < MIN_TEXT 字符且无图无输入）。
//
// ⚠ 前三条是**负向测试逼出来的**，不是设计出来的。第一版只判 ① ② ④，
// 拿 S1 修过的真实缺陷（PublicShell 漏 import isAppMode）复现回去，
// 结果 104/104 全绿 —— 三个探测器同时瞎：
//   · React 生产构建不把边界捕获的异常往 window 抛 ⇒ pageerror 不触发；
//   · 崩的是**根**边界不是路由级边界 ⇒ .route-crash 不出现；
//   · 崩溃卡本身有 61 个字 ⇒ 空白判定够不着。
// 修法是给根边界加 .app-crash 标记（ErrorBoundary.jsx，只在崩溃路径出现），
// 再补第 ③ 条。控制台 error 只认「以 JS 异常构造器名开头」的那一类：
// mock 后端下的取数失败不长这样，不会误报。
//
// 任何时候改这个脚本，都必须把那个漏 import 再复现一次确认能抓住。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'client/dist');
const PORT = 4311;
const MIN_TEXT = 12;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('缺少 client/dist —— 先跑 npm run build:static');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg' };
const srv = await new Promise((r) => {
  const s = createServer(async (rq, rs) => {
    let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    try { const b = await readFile(join(DIST, p)); rs.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); rs.end(b); }
    catch { try { const b = await readFile(join(DIST, 'index.html')); rs.writeHead(200, { 'content-type': 'text/html' }); rs.end(b); } catch { rs.writeHead(404); rs.end(); } }
  });
  s.listen(PORT, () => r(s));
});

// 路由全集取自 client/src/App.jsx 的 <Route path>，:id 一律代入 1。
// 通配 * 不列（它就是 NotFound 本身），/auth 单列（未登录态）。
const ROUTES = [
  '/', '/today', '/discover', '/app-controls', '/messages', '/me', '/chats', '/chats/1',
  '/wallet', '/settings', '/achievements', '/events', '/insights', '/notifications',
  '/scripts', '/script/new', '/script/1', '/script/1/edit', '/community', '/search', '/tags',
  '/announcements', '/leaderboard', '/gacha', '/parliament', '/draw', '/friends',
  '/vip', '/groups', '/group/1', '/theater', '/theater/1', '/library',
  '/worldbooks', '/worldbook/1', '/worldbook/1/edit', '/atelier', '/atelier/1', '/atelier/read/1',
  '/studio', '/favorites', '/character/new', '/character/1', '/character/1/edit',
  '/publish', '/profile', '/user/1', '/features', '/help', '/admin', '/auth',
  '/definitely-not-a-route',
];

const SHELLS = [
  { name: 'App', app: true },
  { name: 'Web', app: false },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const results = [];

for (const shell of SHELLS) {
  const ctx = await browser.newContext({
    viewport: shell.app ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await ctx.addInitScript((isApp) => {
    try {
      const d = new Date().toISOString().slice(0, 10);
      if (isApp) localStorage.setItem('huanyu_app', '1'); else localStorage.removeItem('huanyu_app');
      localStorage.setItem('huanyu_welcome_seen', d);
      localStorage.setItem('huanyu_onboard_done', d);
      localStorage.setItem('huanyu_token', 'tok.1');
    } catch { /* */ }
  }, shell.app);
  const page = await ctx.newPage();

  for (const route of ROUTES) {
    const errs = [];
    const onErr = (e) => errs.push(String(e?.message || e).slice(0, 160));
    // React 生产构建把渲染异常吞进边界，只留一条 console.error —— 只认真异常，
    // 不认取数失败：以 JS 异常构造器名开头是二者最干净的分界。
    const JS_ERR = /^(ReferenceError|TypeError|RangeError|SyntaxError|URIError|EvalError)\b/;
    const onCon = (m) => { if (m.type() === 'error' && JS_ERR.test(m.text().trim())) errs.push(m.text().trim().slice(0, 160)); };
    page.on('pageerror', onErr);
    page.on('console', onCon);
    let row;
    try {
      // 必须先离开当前文档：哈希路由下 goto 换 hash 属于**同文档导航**，不重新加载，
      // 于是根错误边界的 hasError 会一直留着 —— 一条路由崩掉会把它之后的每一条
      // 都判成崩溃。这个坑是负向测试里「后 5 条全红」暴露出来的。
      await page.goto('about:blank');
      await page.goto(`http://127.0.0.1:${PORT}/${shell.app ? '?app=1' : ''}#${route}`, { waitUntil: 'load' });
      await page.waitForTimeout(1400);
      const probe = await page.evaluate(() => {
        const crash = document.querySelector('.route-crash, .app-crash');
        const root = document.querySelector('#root') || document.body;
        const text = (root.innerText || '').replace(/\s+/g, '').length;
        const rich = root.querySelectorAll('img, svg, input, textarea, button').length;
        return {
          crash: crash ? (crash.className + ' :: ' + (crash.querySelector('pre, p')?.textContent || '').trim()).slice(0, 110) : null,
          text, rich,
        };
      });
      const blank = probe.text < MIN_TEXT && probe.rich === 0;
      row = {
        shell: shell.name, route,
        status: probe.crash ? 'CRASH' : errs.length ? 'THROW' : blank ? 'BLANK' : 'ok',
        detail: probe.crash || errs[0] || (blank ? `文本 ${probe.text} 字 / 元素 ${probe.rich}` : `文本 ${probe.text} 字`),
      };
    } catch (e) {
      row = { shell: shell.name, route, status: 'NAV', detail: String(e?.message || e).slice(0, 120) };
    }
    page.off('pageerror', onErr);
    page.off('console', onCon);
    results.push(row);
  }
  await ctx.close();
}
await browser.close();
srv.close();

const bad = results.filter((r) => r.status !== 'ok');
for (const r of results) {
  if (r.status !== 'ok') console.log(`${r.status.padEnd(5)} ${r.shell.padEnd(3)} ${r.route.padEnd(24)} ${r.detail}`);
}
console.log(`\nAPPSMOKE: ${results.length - bad.length}/${results.length} ok` + (bad.length ? ` —— ${bad.length} 条失败` : ' —— 全通过'));
process.exit(bad.length ? 1 : 0);
