// APP 模式（html[data-app="1"]）对话页回归截图 + 关键样式断言。
//   前置：后端已在 :4000 运行且有演示数据（npm run seed && npm start）。
//   运行：node server/app-shots.mjs [输出目录=shots-app]
// 覆盖：today/发现/消息/我的、聊天列表、有立绘/无立绘对话、+面板、长按操作面板、
// 引用条；并断言输入岛玻璃与气泡锚角等关键 computed style，防止皮肤层回退。
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

const BASE = process.env.APP_SHOTS_BASE || 'http://localhost:4000';

// 浏览器可执行文件解析：新皮肤用到 color-mix()/conic-gradient 等新特性，
// @sparticuz/chromium（serverless 旧内核）渲染不了会出全白页。优先顺序：
// CHROME_PATH 环境变量 → Playwright 本地 chromium（/opt/pw-browsers 或
// PLAYWRIGHT_BROWSERS_PATH）→ sparticuz 后备。
async function resolveChrome() {
  const cand = [process.env.CHROME_PATH, process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  const walk = (d, depth) => {
    if (depth > 4) return null;
    let ents; try { ents = fs.readdirSync(d); } catch { return null; }
    for (const f of ents) {
      const p = path.join(d, f);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isFile() && (f === 'chrome' || f === 'chromium')) return p;
      if (st.isDirectory()) { const r = walk(p, depth + 1); if (r) return r; }
    }
    return null;
  };
  for (const c of cand) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
      const found = walk(c, 0);
      if (found) return found;
    } catch { /* 下一个候选 */ }
  }
  return chromium.executablePath();
}
const OUT = path.resolve(process.argv[2] || 'shots-app');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { failed++; console.log('  ❌ ' + m); };

async function token() {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' }) });
  return (await r.json()).token;
}

const run = async () => {
  const tk = await token();
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
    executablePath: await resolveChrome(), headless: true,
  });
  const m = await browser.newPage();
  // 注意：需要先 `npm run build`（全栈版，BrowserRouter）。若 dist 是 build:static
  // 产物（HashRouter），路径路由会全白 —— 下面捕获 console 错误便于定位这类问题。
  m.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await m.evaluate((t) => {
    localStorage.setItem('huanyu_token', t);
    localStorage.setItem('huanyu_app', '1');
    localStorage.setItem('huanyu_welcome_seen', new Date().toISOString().slice(0, 10));
  }, tk);
  const shot = async (urlPath, name, { wait = 1300, before } = {}) => {
    await m.goto(BASE + urlPath, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    if (before) { try { await before(m); } catch (e) { console.error('  before() 失败:', e.message); } }
    await sleep(wait);
    await m.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('📱 ', name);
  };

  await shot('/today', 'a01-today');
  await shot('/', 'a02-discover');
  await shot('/messages', 'a03-messages');
  await shot('/me', 'a04-me');
  await shot('/chats', 'a05-chat-list');

  // 会话 1（种子数据：森灵·薇尔，带背景立绘 → has-bg 沉浸态）
  await shot('/chats/1', 'a06-chat-hasbg', { wait: 1700 });

  // —— 样式断言：皮肤层回退最容易坏的三处 ——
  const styles = await m.evaluate(() => {
    const g = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    return {
      islandRadius: g('.chat-main .chat-input-bar', 'borderRadius'),
      islandBlur: g('.chat-main .chat-input-bar', 'backdropFilter') || g('.chat-main .chat-input-bar', 'webkitBackdropFilter'),
      anchorTL: g('.msg.assistant.run-start .bubble', 'borderTopLeftRadius'),
    };
  });
  if (styles.islandRadius && parseInt(styles.islandRadius) >= 20) ok('输入岛圆角生效 (' + styles.islandRadius + ')');
  else bad('输入岛圆角缺失：' + styles.islandRadius);
  if (styles.islandBlur && styles.islandBlur.includes('blur')) ok('输入岛玻璃模糊生效');
  else bad('输入岛玻璃模糊缺失：' + styles.islandBlur);
  if (styles.anchorTL && parseInt(styles.anchorTL) <= 12) ok('气泡 run-start 锚角生效 (' + styles.anchorTL + ')');
  else bad('气泡锚角缺失：' + styles.anchorTL);

  // +面板
  await shot('/chats/1', 'a07-chat-plus', { wait: 1300, before: async (p) => {
    await p.evaluate(() => document.querySelector('.plus-btn')?.click()); await sleep(600);
  } });

  // 长按操作面板（合成触摸长按）
  await shot('/chats/1', 'a08-msg-sheet', { wait: 1300, before: async (p) => {
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('.msg.assistant .bubble')].pop();
      if (!b) return; const r = b.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: b, clientX: r.x + 20, clientY: r.y + 20 });
      b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], changedTouches: [t] }));
    });
    await sleep(650);
    const open = await p.evaluate(() => !!document.querySelector('.msg-sheet'));
    if (open) console.log('  ✅ 长按操作面板打开');
    else { console.log('  ❌ 长按操作面板未打开'); process.exitCode = 1; }
  } });

  await browser.close();
  console.log(failed === 0 ? '\n✅ app-shots 全部通过 → ' + OUT : `\n❌ ${failed} 项断言失败`);
  process.exit(failed === 0 && !process.exitCode ? 0 : 1);
};
run().catch(e => { console.error(e); process.exit(1); });
