import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const B = 'http://localhost:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async () => {
  const br = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: true });
  const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto(B + '/', { waitUntil: 'networkidle0' }); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '/#/auth', { waitUntil: 'networkidle0' }); await sleep(900);
  await p.screenshot({ path: 'shots-static/s07-auth.png' });
  const m = await br.newPage(); await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await m.goto(B + '/', { waitUntil: 'networkidle0' }); await m.evaluate(() => localStorage.setItem('huanyu_token', 'tok.1'));
  await m.goto(B + '/', { waitUntil: 'networkidle0' }); await m.evaluate(() => { location.hash = '/'; }); await sleep(1200);
  await m.screenshot({ path: 'shots-static/s08-mobile.png' });
  await br.close(); console.log('done');
};
run().catch(e => { console.error(e); process.exit(1); });
