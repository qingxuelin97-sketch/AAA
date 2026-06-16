import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:4000';
const OUT = path.join(process.cwd(), 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function token() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' })
  });
  return (await r.json()).token;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const tk = await token();
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'],
    executablePath: await chromium.executablePath(),
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const go = async (urlPath, name, { wait = 1100, full = false } = {}) => {
    await page.goto(BASE + urlPath, { waitUntil: 'networkidle0' });
    await sleep(wait);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
    console.log('📸', name);
  };

  // 1. Auth (logged-out) — clear storage first
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await go('/auth', '01-auth', { wait: 900 });
  // register tab variant
  await page.goto(BASE + '/auth', { waitUntil: 'networkidle0' });
  await sleep(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.auth-tabs button')].find(x => x.textContent.includes('注册')); b && b.click(); });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '02-register.png') });
  console.log('📸 02-register');

  // Inject auth token for the rest
  await page.evaluateOnNewDocument((t) => localStorage.setItem('huanyu_token', t), tk);

  await go('/', '03-home');
  await go('/library', '04-library');
  await go('/character/4/edit', '05-character-basic');
  // switch tabs in editor
  for (const [label, name] of [['人设', '06-persona'], ['世界书', '07-worldbook'], ['立绘', '08-media']]) {
    await page.evaluate((l) => { const b = [...document.querySelectorAll('.tabs-bar button')].find(x => x.textContent.includes(l)); b && b.click(); }, label);
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('📸', name);
  }
  await go('/chats/1', '09-chat', { wait: 1600 });
  await go('/settings', '10-settings');
  await go('/publish', '11-publish');
  await go('/inbox', '12-inbox');
  await go('/profile', '13-profile', { full: true });
  await go('/post/1', '14-post-detail');

  await browser.close();
  console.log('✅ 全部截图完成 →', OUT);
};

run().catch(e => { console.error(e); process.exit(1); });
