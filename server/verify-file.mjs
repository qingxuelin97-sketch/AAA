import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import path from 'path';

const FILE = 'file://' + path.resolve('幻域-离线版.html');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--allow-file-access-from-files'], executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await sleep(1200);
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: '123456' }) });
    const d = await r.json(); return { ok: r.ok, token: d.token, gold: d.user?.gold };
  });
  await page.evaluate((t) => localStorage.setItem('huanyu_token', t), login.token);
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await sleep(1000);
  await page.evaluate(() => { location.hash = '/'; });
  await sleep(1200);
  await page.screenshot({ path: 'shots-static/file-discover.png' });
  console.log('LOGIN', JSON.stringify(login));
  console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6)) : 'none');
  await browser.close();
};
run().catch(e => { console.error(e); process.exit(1); });
