import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:4000';
const OUT = path.join(process.cwd(), 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  const shot = async (urlPath, name, { wait = 1100, full = false, before } = {}) => {
    await page.goto(BASE + urlPath, { waitUntil: 'networkidle0' });
    if (before) { try { await before(page); } catch {} }
    await sleep(wait);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
    console.log('🖥  ', name);
  };
  const clickText = (sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find(x => x.textContent.includes(t)); el && el.click(); }, sel, text);

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await shot('/auth', 'd01-auth', { wait: 700, before: async () => { await clickText('.auth-tabs button', '注册'); await sleep(400); } });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('huanyu_token', t), tk);
  await shot('/', 'd02-discover');
  await shot('/scripts', 'd03-scripts');
  await shot('/script/2', 'd04-script-detail');
  await shot('/community', 'd05-community');
  await shot('/groups', 'd06-groups');
  await shot('/group/1', 'd07-group-room', { wait: 1400 });
  await shot('/theater', 'd08-theater');
  await shot('/theater/1', 'd09-theater-room', { wait: 1600 });
  await shot('/wallet', 'd10-wallet', { full: true });
  await shot('/chats/1', 'd11-chat', { wait: 1500 });
  await shot('/character/4/edit', 'd12-character', { before: async () => { await clickText('.tabs-bar button', '世界书'); await sleep(500); } });
  await shot('/settings', 'd13-settings');
  await shot('/profile', 'd14-profile', { full: true });
  await shot('/notifications', 'd15-notifications');
  await shot('/favorites', 'd16-favorites');
  await shot('/library', 'd17-library');

  // ---------- Mobile ----------
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await m.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await m.evaluate((t) => localStorage.setItem('huanyu_token', t), tk);
  const mshot = async (urlPath, name, { wait = 1100, before } = {}) => {
    await m.goto(BASE + urlPath, { waitUntil: 'networkidle0' });
    if (before) { try { await before(m); } catch {} }
    await sleep(wait);
    await m.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('📱 ', name);
  };
  await mshot('/', 'm01-discover');
  await mshot('/scripts', 'm02-scripts');
  await mshot('/community', 'm03-community');
  await mshot('/theater/1', 'm04-theater', { wait: 1500 });
  await mshot('/wallet', 'm05-wallet');
  await mshot('/profile', 'm06-profile');
  await mshot('/chats/1', 'm07-chat', { wait: 1400 });

  await browser.close();
  console.log('✅ 截图完成 →', OUT);
};
run().catch(e => { console.error(e); process.exit(1); });
