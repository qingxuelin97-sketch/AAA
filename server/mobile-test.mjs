// 移动端渲染仿真机器人：用 @sparticuz/chromium 启动 headless 浏览器，
// 在移动端 viewport 下实际加载应用，登录后导航到角色对话页 / 设置页，
// 模拟聚焦输入框、滑动 tabs-bar，截图捕获真实渲染 bug，并 dump computed style。
//   运行：node server/mobile-test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4198;
const DB_PATH = path.join(__dirname, 'mobile-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = path.join(__dirname, '..', 'mobile-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端…');
const srv = spawn('node', ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH }, stdio: 'ignore' });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});

const findings = [];
try {
  // 等服务端起来
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* */ } await sleep(250); }

  const page = await browser.newPage();
  // iPhone 14 尺寸 + 真实移动端 UA
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  // 登录拿 token（前端从 localStorage 读 token）
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' }),
  });
  const { token } = await loginRes.json();
  // 关键：在每次导航前注入 token，避免 React auth 检查重定向到登录页
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('huanyu_token', t); } catch { /* */ } }, token);

  // 拦截 console 错误
  page.on('console', (m) => { if (m.type() === 'error') findings.push(`[console.error] ${m.text()}`); });
  page.on('pageerror', (e) => findings.push(`[pageerror] ${e.message}`));

  console.log('· 导航到首页…');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '01-home.png'), fullPage: false });

  // 取一个有背景图的公开角色
  const charsRes = await fetch(`${BASE}/api/characters/public`, { headers: { Authorization: 'Bearer ' + token } });
  const charsJson = await charsRes.json();
  const withBg = charsJson.characters.find(c => c.background) || charsJson.characters[0];
  console.log(`· 选角色 #${withBg.id} ${withBg.name} (background: ${!!withBg.background})`);

  // 创建一段对话
  const convRes = await fetch(`${BASE}/api/chat/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ character_id: withBg.id }),
  });
  const convJson = await convRes.json();
  const convId = convJson.conversation.id;
  console.log(`· 建对话 #${convId}`);

  // 导航到角色对话页（路由是 /chats/:id 复数）
  console.log('· 导航到角色对话页…');
  await page.goto(`${BASE}/chats/${convId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT_DIR, '02-chat-idle.png'), fullPage: false });

  // dump .chat-input-bar / .chat-main / .chat-layout / .chat-scroll / .app-shell computed style
  const chatStyle = await page.evaluate(() => {
    const bar = document.querySelector('.chat-input-bar');
    const main = document.querySelector('.chat-main');
    const layout = document.querySelector('.chat-layout');
    const scroll = document.querySelector('.chat-scroll');
    const shell = document.querySelector('.app-shell');
    const mtop = document.querySelector('.mobile-topbar');
    const bnav = document.querySelector('.bottom-nav');
    const pick = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { background: cs.background, backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage,
        overflow: cs.overflow, overflowX: cs.overflowX, overflowY: cs.overflowY, height: cs.height,
        position: cs.position, pointerEvents: cs.pointerEvents, color: cs.color, backdropFilter: cs.backdropFilter,
        overscrollBehavior: cs.overscrollBehavior, overscrollBehaviorY: cs.overscrollBehaviorY };
    };
    return { bar: pick(bar), main: pick(main), layout: pick(layout), scroll: pick(scroll), shell: pick(shell),
      mtopDisplay: mtop ? getComputedStyle(mtop).display : null,
      bnavDisplay: bnav ? getComputedStyle(bnav).display : null,
      scrollInfo: scroll ? { scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight } : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlOverflow: getComputedStyle(document.documentElement).overflowY,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      bodyScrollTop: document.body.scrollTop, htmlScrollTop: document.documentElement.scrollTop,
      themeAttr: document.documentElement.getAttribute('data-theme'),
      hasBg: !!document.querySelector('.chat-main.has-bg'),
      immersive: !!document.querySelector('.chat-layout.immersive') };
  });
  console.log('· chat computed style:', JSON.stringify(chatStyle, null, 2));

  // 模拟点击输入框（聚焦）
  console.log('· 点击输入框聚焦…');
  await page.click('.chat-input-bar textarea');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT_DIR, '03-chat-focused.png'), fullPage: false });

  // 模拟键盘弹起：headless Chromium 无真实键盘，但可以 Object.defineProperty 覆盖
  // visualViewport.height（模拟键盘遮挡后视觉视口缩小），再 dispatchEvent resize，
  // 验证输入栏 fixed + bottom 是否实时上移到键盘上方，chat-main 布局是否保持不动。
  console.log('· 模拟键盘弹起（vv.height 844→500，键盘 344px）…');
  const kbdSim = await page.evaluate(() => {
    const vv = window.visualViewport;
    if (!vv) return { error: 'no visualViewport' };
    const bar = document.querySelector('.chat-input-bar');
    const layout = document.querySelector('.chat-layout.immersive');
    const chatMain = document.querySelector('.chat-main');
    if (!bar || !layout || !chatMain) return { error: 'no bar/layout/main' };
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; };
    const before = {
      barPosition: getComputedStyle(bar).position,
      barBottom: bar.style.bottom,
      barRect: rect(bar),
      layoutHeight: layout.offsetHeight,
      chatMainHeight: chatMain.offsetHeight,
      vvHeight: vv.height,
      innerHeight: window.innerHeight,
    };
    // 覆盖 visualViewport.height 模拟键盘弹起（键盘占 344px）
    const KBD_H = 344;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KBD_H });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
    const after = {
      barBottom: bar.style.bottom,
      barRect: rect(bar),
      layoutHeight: layout.offsetHeight,
      chatMainHeight: chatMain.offsetHeight,
      vvHeight: vv.height,
    };
    document.body.scrollTop = -100;
    document.documentElement.scrollTop = -100;
    const afterScroll = { body: document.body.scrollTop, html: document.documentElement.scrollTop };
    return { before, after, afterScroll };
  });
  console.log('· 键盘模拟:', JSON.stringify(kbdSim, null, 2));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '03b-chat-keyboard.png'), fullPage: false });

  if (kbdSim.after && !kbdSim.error) {
    const kbdH = kbdSim.after.vvHeight; // 可见区 = 500
    // 1. 输入栏 fixed
    if (kbdSim.before.barPosition === 'fixed') console.log(`✅ 输入栏 position=fixed`);
    else { findings.push(`[kbd] 输入栏 position=${kbdSim.before.barPosition} 期望 fixed`); console.log(`❌ 输入栏 position=${kbdSim.before.barPosition}`); }
    // 2. 输入栏实际上移了键盘高度（现实现经 transform 合成层上移，而非改 bottom）
    const expectedShift = kbdSim.before.innerHeight - kbdH; // 844-500=344
    const actualShift = (kbdSim.before.barRect?.top ?? 0) - (kbdSim.after.barRect?.top ?? 0);
    if (Math.abs(actualShift - expectedShift) <= 2) console.log(`✅ 输入栏上移 ${actualShift.toFixed(0)}px = 键盘高度 ${expectedShift}px`);
    else { findings.push(`[kbd] 输入栏上移 ${actualShift.toFixed(0)}px 期望 ${expectedShift}px`); console.log(`❌ 输入栏上移 ${actualShift.toFixed(0)}px`); }
    // 3. 输入栏在键盘上方（barRect.bottom ≤ 可见区 + 容差）
    const barBottom = kbdSim.after.barRect?.bottom;
    if (barBottom != null && barBottom <= kbdH + 2) console.log(`✅ 输入栏 barRect.bottom=${barBottom.toFixed(0)} ≤ 可见区=${kbdH}`);
    else if (barBottom != null) { findings.push(`[kbd] 输入栏 barRect.bottom=${barBottom} > 可见区=${kbdH}`); console.log(`❌ 输入栏 barRect.bottom=${barBottom}`); }
    // 4. chat-main 布局不动（不收缩）
    if (kbdSim.after.chatMainHeight === kbdSim.before.chatMainHeight) console.log(`✅ chat-main 高度不变 ${kbdSim.before.chatMainHeight}（布局不收缩）`);
    else { findings.push(`[kbd] chat-main 高度变化 ${kbdSim.before.chatMainHeight}→${kbdSim.after.chatMainHeight}`); console.log(`❌ chat-main 高度变化`); }
    // 5. body 未滚动
    if (kbdSim.afterScroll.body === 0 && kbdSim.afterScroll.html === 0) console.log('✅ 上滑未滚动 body');
    else { findings.push(`[kbd] body 被滚动`); console.log(`❌ body 滚动 ${JSON.stringify(kbdSim.afterScroll)}`); }
  }

  // 模拟键盘收起
  console.log('· 模拟键盘收起…');
  await page.evaluate(() => {
    const vv = window.visualViewport;
    try { delete vv.height; } catch { /* */ }
    try { delete vv.offsetTop; } catch { /* */ }
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight });
    vv.dispatchEvent(new Event('resize'));
  });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, '03c-chat-keyboard-closed.png'), fullPage: false });

  const focusStyle = await page.evaluate(() => {
    const bar = document.querySelector('.chat-input-bar');
    const cs = getComputedStyle(bar);
    return { background: cs.background, backgroundColor: cs.backgroundColor };
  });
  console.log('· focus 后输入栏背景:', JSON.stringify(focusStyle));

  // 模拟输入文字
  await page.type('.chat-input-bar textarea', '你好');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '04-chat-typed.png'), fullPage: false });

  // 模拟上拉滚动到顶部看是否露出对话外内容
  console.log('· 模拟上拉滚动到顶部…');
  await page.evaluate(() => {
    const sc = document.querySelector('.chat-scroll');
    if (sc) sc.scrollTo({ top: 0, behavior: 'instant' });
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '05-chat-scrolled-top.png'), fullPage: false });

  // 检测上拉到顶后继续下拉，body 是否被滚动（露出对话外内容）
  const overscrollTest = await page.evaluate(() => {
    const sc = document.querySelector('.chat-scroll');
    if (!sc) return null;
    // 先滚到顶
    sc.scrollTop = 0;
    // 模拟 touch 拉伸：直接尝试把 body 滚动到负值看是否生效
    const before = { body: document.body.scrollTop, html: document.documentElement.scrollTop };
    document.body.scrollTop = -50;
    document.documentElement.scrollTop = -50;
    const after = { body: document.body.scrollTop, html: document.documentElement.scrollTop };
    // 检测 chat-main 顶部是否露出到视口上方（即 layout 是否被推上去）
    const mainRect = document.querySelector('.chat-main').getBoundingClientRect();
    const layoutRect = document.querySelector('.chat-layout').getBoundingClientRect();
    return { before, after, mainTop: mainRect.top, layoutTop: layoutRect.top, layoutHeight: layoutRect.height,
      scrollOverscroll: getComputedStyle(sc).overscrollBehaviorY };
  });
  console.log('· overscroll 测试:', JSON.stringify(overscrollTest, null, 2));
  await page.screenshot({ path: path.join(OUT_DIR, '05b-chat-overscroll.png'), fullPage: false });

  // 导航到设置页
  console.log('· 导航到设置页…');
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT_DIR, '06-settings-idle.png'), fullPage: false });

  // dump tabs-bar style
  const tabsStyle = await page.evaluate(() => {
    const bar = document.querySelector('.tabs-bar');
    if (!bar) return null;
    const cs = getComputedStyle(bar);
    const btns = [...bar.querySelectorAll('button')].map(b => {
      const bcs = getComputedStyle(b);
      return { text: b.textContent.trim().slice(0, 8), flexShrink: bcs.flexShrink, width: bcs.width, offsetWidth: b.offsetWidth };
    });
    return { overflow: cs.overflow, overflowX: cs.overflowX, scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth,
      flexWrap: cs.flexWrap, buttons: btns };
  });
  console.log('· tabs-bar style:', JSON.stringify(tabsStyle, null, 2));

  // 横滑 tabs-bar
  console.log('· 横滑 tabs-bar…');
  const tabsBar = await page.$('.tabs-bar');
  if (tabsBar) {
    const bb = await tabsBar.boundingBox();
    // 模拟触摸滑动：从右往左滑
    await page.touchscreen.touchStart(bb.x + bb.width - 30, bb.y + bb.height / 2);
    await page.touchscreen.touchMove(bb.x + 30, bb.y + bb.height / 2);
    await page.touchscreen.touchEnd();
    await sleep(400);
    await page.screenshot({ path: path.join(OUT_DIR, '07-settings-tabs-swiped.png'), fullPage: false });
  }

  // 点击各 tab 看是否有挤压
  for (let i = 0; i < 6; i++) {
    const btn = await page.$(`.tabs-bar button:nth-child(${i + 1})`);
    if (btn) {
      await btn.click();
      await sleep(300);
      await page.screenshot({ path: path.join(OUT_DIR, `08-settings-tab-${i}.png`), fullPage: false });
    }
  }

  console.log(`\n截图已存到 ${OUT_DIR}/`);
  if (findings.length) { console.log('运行时错误：'); findings.forEach(f => console.log('  - ' + f)); }
  else console.log('✅ 无运行时错误');
} catch (e) {
  console.error('仿真失败:', e);
  findings.push(`[fatal] ${e.message}`);
} finally {
  await browser.close();
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(findings.length === 0 ? 0 : 1);
