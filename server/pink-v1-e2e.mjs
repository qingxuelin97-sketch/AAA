import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'client', 'dist');
const REF = path.join(ROOT, 'docs', 'ui-reference', 'pink-v1');
const BASELINES = path.join(REF, 'baseline');
const OUT = path.join(DIST, 'pink-v1-e2e');
const HOST = '127.0.0.1';
const MAX_DIFF = 0.02;
const ROUTES = [
  ['today', '/today'],
  ['discover', '/'],
  ['messages', '/messages'],
  ['profile', '/me'],
];
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.svg', 'image/svg+xml'],
]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function walkForChrome(dir, depth = 0) {
  if (!dir || depth > 5) return '';
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    if (entry.isFile() && /^(chrome|chromium|chrome-headless-shell)(\.exe)?$/i.test(entry.name)) return candidate;
    if (entry.isDirectory()) { const found = walkForChrome(candidate, depth + 1); if (found) return found; }
  }
  return '';
}

async function resolveChrome() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return walkForChrome(process.env.PLAYWRIGHT_BROWSERS_PATH, 0) || chromium.executablePath();
}

function startStaticServer() {
  assert(fs.existsSync(path.join(DIST, 'index.html')), '缺少 client/dist，请先运行 build:static');
  const server = createServer((req, res) => {
    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); } catch { /* root */ }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let target = path.resolve(DIST, relative);
    const distRoot = path.resolve(DIST);
    if (!target.startsWith(distRoot + path.sep) && target !== path.join(distRoot, 'index.html')) return res.writeHead(403).end('Forbidden');
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      if (path.extname(relative)) return res.writeHead(404).end('Not found');
      target = path.join(DIST, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME.get(path.extname(target).toLowerCase()) || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve({ server, base: `http://${HOST}:${server.address().port}` }));
  });
}

async function newPage(browser, base, viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('huanyu_app', '1');
    localStorage.setItem('huanyu_theme', 'light');
    localStorage.setItem('huanyu_perf', 'lite');
    localStorage.setItem('huanyu_welcome_seen', new Date().toISOString().slice(0, 10));
    localStorage.setItem('huanyu_onboard_done', new Date().toISOString().slice(0, 10));
  });
  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle0' });
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Huanyu-App': '1' },
      body: JSON.stringify({ username: 'demo', password: '123456' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'login failed');
    localStorage.setItem('huanyu_app_token', result.token);
    localStorage.removeItem('huanyu_token');
    return result.user;
  });
  assert(session.username === 'app-demo', 'App demo login must map to the isolated app-demo account');
  // Hash-only navigation does not reload React's anonymous AuthProvider.
  // Reload once so bootstrap restores the newly written App-scoped token.
  await page.reload({ waitUntil: 'networkidle0' });
  page.__pinkErrors = errors;
  return page;
}

async function openScreen(page, base, route, screen) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle0' });
  try {
    await page.waitForSelector(`[data-pink-screen="${screen}"]`, { timeout: 5000 });
  } catch (error) {
    const state = await page.evaluate(async () => {
      const appToken = localStorage.getItem('huanyu_app_token');
      const probe = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${appToken}`, 'X-Huanyu-App': '1' } });
      return {
        href: location.href,
        html: { ...document.documentElement.dataset },
        root: document.querySelector('.app-root')?.outerHTML.slice(0, 500) || '',
        body: document.body.innerText.slice(0, 500),
        appToken,
        legacyToken: localStorage.getItem('huanyu_token'),
        probe: { status: probe.status, body: await probe.text() },
        dbUsers: JSON.parse(localStorage.getItem('huanyu_db_v7') || '{}').users?.map(user => [user.id, user.username]),
      };
    });
    throw new Error(`${error.message}\n${JSON.stringify(state)}\n${page.__pinkErrors.join('\n')}`);
  }
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const images = [...document.querySelectorAll('img')];
    await Promise.all(images.map(image => image.complete && image.naturalWidth
      ? Promise.resolve()
      : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
  });
  await sleep(520);
}

function compare(screen, actualPath) {
  const expected = PNG.sync.read(fs.readFileSync(path.join(BASELINES, `${screen}-390x844.png`)));
  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  assert(actual.width === expected.width && actual.height === expected.height, `${screen}: screenshot dimensions drifted`);
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.12, includeAA: false });
  const ratio = changed / (actual.width * actual.height);
  fs.writeFileSync(path.join(OUT, `${screen}-diff.png`), PNG.sync.write(diff));
  assert(ratio <= MAX_DIFF, `${screen}: visual diff ${(ratio * 100).toFixed(3)}% exceeded 2%`);
  return ratio;
}

function verifyPngAssets() {
  const assetRoot = path.join(ROOT, 'client', 'public', 'app-pink-v1');
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.png')) files.push(file);
  });
  walk(assetRoot);
  assert(files.length >= 20, `expected at least 20 PNG assets, found ${files.length}`);
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file}: invalid PNG header`);
    assert(bytes[25] === 6 || bytes[25] === 4, `${file}: PNG must expose an alpha channel (color type ${bytes[25]})`);
  }
  assert(!files.some(file => file.endsWith('.svg')), 'pink-v1 asset inventory must not contain SVG');
}

async function structuralAssertions(page, manifest, screen, viewport) {
  const state = await page.evaluate(({ expectedDockTop, expectedScreen }) => {
    const root = document.querySelector('.app-root[data-pink-v1="demo"]');
    const plate = document.querySelector(`[data-pink-screen="${expectedScreen}"]`);
    const dock = document.querySelector('.app-dock');
    const relevant = [...document.querySelectorAll('.pink-hit, .pink-discover-composer input, .app-tab, .app-fab')]
      .filter(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.className, width: rect.width, height: rect.height };
      });
    return {
      root: root?.getBoundingClientRect().toJSON(), plate: plate?.getBoundingClientRect().toJSON(), dock: dock?.getBoundingClientRect().toJSON(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: relevant.filter(item => item.width < 43.5 || item.height < 43.5),
      svgs: root?.querySelectorAll('svg').length || 0,
      svgResources: performance.getEntriesByType('resource').filter(entry => /\.svg(?:$|[?#])/i.test(entry.name)).map(entry => entry.name),
      expectedDockTop,
      plateStyle: plate ? {
        height: getComputedStyle(plate).height, minHeight: getComputedStyle(plate).minHeight,
        maxHeight: getComputedStyle(plate).maxHeight, width: getComputedStyle(plate).width,
        display: getComputedStyle(plate).display, position: getComputedStyle(plate).position,
      } : null,
      parentStyle: plate?.parentElement ? {
        height: getComputedStyle(plate.parentElement).height, display: getComputedStyle(plate.parentElement).display,
        position: getComputedStyle(plate.parentElement).position,
      } : null,
    };
  }, { expectedDockTop: manifest.screens[screen].parts.at(-1).top, expectedScreen: screen });
  assert(state.root && state.plate && state.dock, `${screen}@${viewport.width}: missing pink shell geometry`);
  assert(state.overflow <= 0.5, `${screen}@${viewport.width}: horizontal overflow ${state.overflow}px`);
  assert(state.small.length === 0, `${screen}@${viewport.width}: controls smaller than 44px: ${JSON.stringify(state.small)}`);
  assert(state.svgs === 0 && state.svgResources.length === 0,
    `${screen}@${viewport.width}: new light view loaded SVG/Lucide output (${state.svgs}; ${state.svgResources.join(', ')})`);
  if (viewport.width === 390 && viewport.height === 844) {
    assert(Math.abs(state.plate.x) <= 0.5 && Math.abs(state.plate.y) <= 0.5, `${screen}: plate origin drifted`);
    assert(Math.abs(state.plate.width - 390) <= 0.5 && Math.abs(state.plate.height - 844) <= 0.5,
      `${screen}: plate baseline size drifted (${state.plate.width}x${state.plate.height} at ${state.plate.x},${state.plate.y}; ${JSON.stringify(state.plateStyle)}; parent ${JSON.stringify(state.parentStyle)})`);
    assert(Math.abs(state.dock.y - state.expectedDockTop) <= 2, `${screen}: dock boundary drifted by ${state.dock.y - state.expectedDockTop}px`);
  }
}

async function run() {
  verifyPngAssets();
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'public', 'app-pink-v1', 'baked', 'manifest.json'), 'utf8'));
  const { server, base } = await startStaticServer();
  const browser = await puppeteer.launch({
    executablePath: await resolveChrome(), headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  try {
    const baselinePage = await newPage(browser, base, { width: 390, height: 844 });
    for (const [screen, route] of ROUTES) {
      await openScreen(baselinePage, base, route, screen);
      await structuralAssertions(baselinePage, manifest, screen, { width: 390, height: 844 });
      const actualPath = path.join(OUT, `${screen}-actual.png`);
      await baselinePage.screenshot({ path: actualPath });
      const ratio = compare(screen, actualPath);
      console.log(`pink-v1 ${screen}: ${(ratio * 100).toFixed(3)}% diff`);
      if (screen === 'today') {
        await baselinePage.click('.pink-today-task');
        await baselinePage.waitForFunction(() => document.querySelector('.pink-today-task')?.disabled === true);
        await baselinePage.waitForSelector('.toast', { hidden: true, timeout: 5000 });
      }
      if (screen === 'discover') {
        await baselinePage.$eval('.pink-discover-wrap', element => {
          element.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        });
        await baselinePage.waitForFunction(() => document.querySelector('.pink-discover-wrap')?.dataset.pinkCardIndex === '1');
        await baselinePage.type('.pink-discover-composer input', '晚安');
        assert(await baselinePage.$eval('.pink-discover-composer input', input => input.value === '晚安'), 'Discover composer must remain a real input');
      }
      if (screen === 'messages') {
        await baselinePage.evaluate(() => {
          const row = document.querySelector('[data-pink-conversation="0"]');
          const rect = row?.getBoundingClientRect();
          if (!row || !rect) return;
          const touch = new Touch({ identifier: 1, target: row, clientX: rect.x + 20, clientY: rect.y + 20 });
          row.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch] }));
        });
        await baselinePage.waitForSelector('.qa-press-menu', { visible: true, timeout: 1500 });
        await baselinePage.keyboard.press('Escape');
        await baselinePage.waitForSelector('.qa-press-menu', { hidden: true });
        await baselinePage.click('.pink-messages-tab-fav');
        await baselinePage.waitForFunction(() => document.querySelector('.pink-messages-tab-fav')?.getAttribute('aria-pressed') === 'true');
        assert(await baselinePage.$eval('.app-root', root => root.querySelectorAll('svg').length === 0), 'Messages tab switching must stay on the PNG skin');
      }
    }
    assert(baselinePage.__pinkErrors.length === 0, `browser errors: ${baselinePage.__pinkErrors.join('\n')}`);
    await baselinePage.close();

    for (const viewport of [{ width: 360, height: 800 }, { width: 412, height: 915 }]) {
      const page = await newPage(browser, base, viewport);
      for (const [screen, route] of ROUTES) {
        await openScreen(page, base, route, screen);
        await structuralAssertions(page, manifest, screen, viewport);
      }
      assert(page.__pinkErrors.length === 0, `browser errors @${viewport.width}: ${page.__pinkErrors.join('\n')}`);
      await page.close();
    }

    const dark = await newPage(browser, base, { width: 390, height: 844 });
    await openScreen(dark, base, '/today', 'today');
    const darkFallback = await dark.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      window.dispatchEvent(new Event('huanyu-theme'));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        pink: !!document.querySelector('[data-pink-screen]'), old: !!document.querySelector('.apphome'),
      }))));
    });
    assert(!darkFallback.pink && darkFallback.old, 'dark mode must return the existing App UI');
    await dark.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('pink-v1 E2E passed');
}

run().catch(error => { console.error(error); process.exit(1); });
