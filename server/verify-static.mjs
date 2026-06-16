import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:8080';
const OUT = path.join(process.cwd(), 'shots-static');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'],
    executablePath: await chromium.executablePath(), headless: true
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // First load installs the mock & seeds; set a demo token then reload to auto-login.
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await sleep(600);
  await page.evaluate(() => localStorage.setItem('huanyu_token', 'tok.1'));
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await sleep(900);

  const shot = async (hash, name, { wait = 1000, before } = {}) => {
    await page.evaluate(h => { window.location.hash = h; }, hash);
    await sleep(wait);
    if (before) { try { await before(); } catch {} }
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot', name);
  };
  await shot('/', 's01-discover');
  await shot('/scripts', 's02-scripts');
  await shot('/wallet', 's03-wallet');
  await shot('/theater/1', 's04-theater', { wait: 1400 });
  await shot('/community', 's05-community');
  await shot('/chats/1', 's06-chat', { wait: 1400 });

  // verify login flow from scratch
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/#/auth', { waitUntil: 'networkidle0' });
  await sleep(500);
  const loginResult = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: '123456' }) });
    const d = await r.json();
    return { ok: r.ok, hasToken: !!d.token, gold: d.user?.gold };
  });
  console.log('LOGIN', JSON.stringify(loginResult));

  await browser.close();
  console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
};
run().catch(e => { console.error(e); process.exit(1); });
