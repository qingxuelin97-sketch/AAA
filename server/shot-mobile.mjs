import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const B = 'http://localhost:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async () => {
  const br = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: true });
  const m = await br.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await m.goto(B + '/', { waitUntil: 'networkidle0' });
  await m.evaluate(() => localStorage.setItem('huanyu_token', 'tok.1'));
  const shot = async (hash, name, wait = 1400) => {
    await m.goto(B + '/', { waitUntil: 'networkidle0' });
    await m.evaluate(h => { location.hash = h; }, hash);
    await sleep(wait);
    await m.screenshot({ path: 'shots-static/' + name + '.png' });
    console.log('mobile', name);
  };
  await shot('/theater/1', 'm-theater', 1700);
  await shot('/chats/1', 'm-chat', 1500);
  await shot('/wallet', 'm-wallet');
  await shot('/', 'm-home');
  await br.close(); console.log('done');
};
run().catch(e => { console.error(e); process.exit(1); });
