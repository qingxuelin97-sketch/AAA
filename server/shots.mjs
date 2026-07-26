// Web 端回归截图工具（1440×900 桌面 + 390×844 移动 + 深色抽样）。
// 用法：
//   node server/shots.mjs                 → 截到 shots/
//   node server/shots.mjs --baseline      → 截到 shots-baseline/（作为对比基线入库或存档）
//   node server/shots.mjs --compare       → 截到 shots/ 并与 shots-baseline/ 逐像素对比，
//                                           差异率 > MAX_DIFF 的页面报错退出（pixelmatch）
// 需要：已 seed 的服务器跑在 :4000（npm run seed && npm start）。
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:4000';
const MODE = process.argv.includes('--baseline') ? 'baseline' : process.argv.includes('--compare') ? 'compare' : 'shoot';
const OUT = path.join(process.cwd(), MODE === 'baseline' ? 'shots-baseline' : 'shots');
const BASE_DIR = path.join(process.cwd(), 'shots-baseline');
const MAX_DIFF = 0.02; // 允许 2% 像素漂移（字体渲染/动画余量）
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const failures = [];

async function comparePng(name, file) {
  if (MODE !== 'compare') return;
  const baseFile = path.join(BASE_DIR, name + '.png');
  if (!fs.existsSync(baseFile)) { console.log('⚠️  无基线，跳过对比:', name); return; }
  const { PNG } = await import('pngjs');
  const { default: pixelmatch } = await import('pixelmatch');
  const a = PNG.sync.read(fs.readFileSync(baseFile));
  const b = PNG.sync.read(fs.readFileSync(file));
  if (a.width !== b.width || a.height !== b.height) { failures.push(`${name}: 尺寸不一致`); return; }
  const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.12 });
  const ratio = diff / (a.width * a.height);
  if (ratio > MAX_DIFF) failures.push(`${name}: 像素差异 ${(ratio * 100).toFixed(2)}% > ${MAX_DIFF * 100}%`);
}

async function token() {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' }) });
  return (await r.json()).token;
}

const run = async () => {
  const tk = await token();
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'],
    executablePath: await chromium.executablePath(), headless: true
  });

  // ---------- Desktop ----------
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  // SSE 长连接让 networkidle0 永不满足 —— 统一 domcontentloaded + 定长等待。
  const shot = async (urlPath, name, { wait = 1400, full = false, before, theme } = {}) => {
    if (theme) await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('huanyu_theme', t); } catch {} }, theme);
    await page.goto(BASE + urlPath, { waitUntil: 'domcontentloaded' });
    if (before) { try { await before(page); } catch {} }
    await sleep(wait);
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file, fullPage: full });
    console.log('🖥  ', name);
    await comparePng(name, file);
  };
  const clickText = (sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find(x => x.textContent.includes(t)); el && el.click(); }, sel, text);

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await shot('/auth', 'd01-auth', { wait: 900, before: async () => { await clickText('.auth-tabs button', '注册'); await sleep(400); } });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('huanyu_token', t), tk);
  await shot('/', 'd02-home');
  await shot('/discover', 'd02b-discover');
  await shot('/scripts', 'd03-scripts');
  await shot('/script/2', 'd04-script-detail');
  await shot('/community', 'd05-community');
  await shot('/groups', 'd06-groups');
  await shot('/group/1', 'd07-group-room', { wait: 1700 });
  await shot('/theater', 'd08-theater');
  await shot('/theater/1', 'd09-theater-room', { wait: 1900 });
  await shot('/wallet', 'd10-wallet', { full: true });
  await shot('/chats/1', 'd11-chat', { wait: 1800 });
  await shot('/character/4/edit', 'd12-character', { before: async () => { await clickText('.tabs-bar button', '世界书'); await sleep(500); } });
  await shot('/settings', 'd13-settings');
  await shot('/profile', 'd14-profile', { full: true });
  await shot('/notifications', 'd15-notifications');
  await shot('/favorites', 'd16-favorites');
  await shot('/library', 'd17-library');
  await shot('/messages', 'd18-messages');
  await shot('/vip', 'd19-vip');
  await shot('/app-controls', 'd20-controls', { full: true });
  // 深色抽样（关键路径 × dark）
  await shot('/', 'd21-home-dark', { theme: 'dark' });
  await shot('/chats/1', 'd22-chat-dark', { wait: 1800, theme: 'dark' });
  await shot('/settings', 'd23-settings-dark', { theme: 'dark' });
  await shot('/wallet', 'd24-wallet-dark', { full: true, theme: 'dark' });

  // ---------- Mobile ----------
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await m.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await m.evaluate((t) => localStorage.setItem('huanyu_token', t), tk);
  const mshot = async (urlPath, name, { wait = 1400, before } = {}) => {
    await m.goto(BASE + urlPath, { waitUntil: 'domcontentloaded' });
    if (before) { try { await before(m); } catch {} }
    await sleep(wait);
    const file = path.join(OUT, name + '.png');
    await m.screenshot({ path: file });
    console.log('📱 ', name);
    await comparePng(name, file);
  };
  await mshot('/', 'm01-home');
  await mshot('/discover', 'm01b-discover');
  await mshot('/scripts', 'm02-scripts');
  await mshot('/community', 'm03-community');
  await mshot('/theater/1', 'm04-theater', { wait: 1700 });
  await mshot('/wallet', 'm05-wallet');
  await mshot('/profile', 'm06-profile');
  await mshot('/chats/1', 'm07-chat', { wait: 1700 });
  await mshot('/messages', 'm08-messages');

  await browser.close();
  if (MODE === 'compare' && failures.length) {
    console.error('❌ 视觉回归超阈值:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('✅ 截图完成 →', OUT);
};
run().catch(e => { console.error(e); process.exit(1); });
