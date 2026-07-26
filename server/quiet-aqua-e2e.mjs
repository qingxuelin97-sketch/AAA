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
const OUT = path.join(DIST, 'quiet-aqua-e2e');
const BASELINES = path.join(ROOT, 'docs', 'ui-baselines', 'quiet-aqua-e2e');
const HOST = '127.0.0.1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPDATE_BASELINES = process.argv.includes('--update-baselines');
const DETAIL_ROUTES_ONLY = process.argv.includes('--detail-routes-only');
const WALLET_ONLY = process.argv.includes('--wallet-only');
const MAX_VISUAL_DIFF_RATIO = 0.02;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function assert(condition, message, details = '') {
  if (!condition) throw new Error(`${message}${details ? `\n${details}` : ''}`);
}

function walkForChrome(dir, depth = 0) {
  if (!dir || depth > 5) return '';
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    if (entry.isFile() && /^(chrome|chromium|chrome-headless-shell)(\.exe)?$/i.test(entry.name)) return candidate;
    if (entry.isDirectory()) {
      const found = walkForChrome(candidate, depth + 1);
      if (found) return found;
    }
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
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;

  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    const found = walkForChrome(root);
    if (found) return found;
  }
  return chromium.executablePath();
}

function startStaticServer() {
  assert(fs.existsSync(path.join(DIST, 'index.html')), '缺少 client/dist；请先运行 npm run build:static');
  const server = createServer((req, res) => {
    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); } catch { /* use root */ }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let target = path.resolve(DIST, relative);
    if (!target.startsWith(path.resolve(DIST) + path.sep) && target !== path.join(DIST, 'index.html')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      const isResource = path.extname(relative) !== '' || relative.startsWith('assets/');
      if (isResource) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Not found');
        return;
      }
      target = path.join(DIST, 'index.html');
    }
    try {
      res.writeHead(200, {
        'Content-Type': MIME.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(target).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve({
      server,
      base: `http://${HOST}:${server.address().port}`,
    }));
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function preparePage(browser, base, {
  app = true,
  token = true,
  theme = 'light',
  accent = 'teal',
  perf = 'auto',
  viewport = { width: 390, height: 844 },
  reducedMotion = false,
  // S7 首启引导默认预置为「已完成」：既有场景与像素基线不感知引导；
  // 专测引导的场景显式传 onboard:false 摘除预置。
  onboard = true,
} = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  page.on('response', (response) => {
    if (response.url().startsWith(base) && response.status() >= 400) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // 本套件验证的是分档「契约」而非宿主机硬件：小核数 CI 容器会让 perf.js 的
  // deviceIsWeak() 把 auto 判成 lite，导致 balanced 契约根本测不到。统一伪装
  // 一台常规 8 核 / 8GiB 设备，auto 始终按产品语义解析（lite 档用显式 perf 配置测）。
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    } catch { /* 保守失败：维持宿主机真实值 */ }
  });
  await page.evaluateOnNewDocument((config) => {
    localStorage.setItem('huanyu_welcome_seen', new Date().toISOString().slice(0, 10));
    if (config.onboard) localStorage.setItem('huanyu_onboard_done', new Date().toISOString().slice(0, 10));
    else localStorage.removeItem('huanyu_onboard_done');
    localStorage.setItem('huanyu_theme', config.theme);
    localStorage.setItem('huanyu_accent', config.accent);
    localStorage.setItem('huanyu_perf', config.perf);
    if (config.app) localStorage.setItem('huanyu_app', '1');
    else localStorage.removeItem('huanyu_app');
    if (config.token) localStorage.setItem('huanyu_token', 'tok.1');
    else localStorage.removeItem('huanyu_token');
  }, { app, token, theme, accent, perf, onboard });
  page.__qaErrors = errors;
  page.__qaBase = base;
  return page;
}

async function settlePage(page) {
  await page.waitForSelector('.app-boot', { hidden: true, timeout: 3500 });
  await page.evaluate(() => document.fonts?.ready);
  // Route and material springs intentionally run for up to 460ms. Capturing at
  // 120ms records a translucent transition frame and makes healthy surfaces
  // look disabled; baselines must represent the settled UI.
  await sleep(560);
}

function compareScreenshot(name, actualPath) {
  const baselinePath = path.join(BASELINES, name);
  if (UPDATE_BASELINES) {
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.copyFileSync(actualPath, baselinePath);
    return;
  }
  assert(fs.existsSync(baselinePath), `Missing reviewed UI baseline: ${name}`);
  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  const expected = PNG.sync.read(fs.readFileSync(baselinePath));
  assert(
    actual.width === expected.width && actual.height === expected.height,
    `UI baseline dimensions changed: ${name}`,
    `expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
  );
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: 0.12, includeAA: false },
  );
  const ratio = changed / (actual.width * actual.height);
  if (ratio > MAX_VISUAL_DIFF_RATIO) {
    fs.writeFileSync(path.join(OUT, `${path.parse(name).name}.diff.png`), PNG.sync.write(diff));
  }
  assert(ratio <= MAX_VISUAL_DIFF_RATIO, `Visual regression exceeded ${MAX_VISUAL_DIFF_RATIO * 100}%: ${name}`, `${(ratio * 100).toFixed(2)}% pixels changed`);
}

async function captureScreenshot(page, name) {
  const actualPath = path.join(OUT, name);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: actualPath });
  compareScreenshot(name, actualPath);
}

async function saveScreenshot(page, name) {
  // Vite clears client/dist at the beginning of a rebuild. Recreate the
  // artifact directory at write time so an adjacent local build cannot turn a
  // healthy screenshot run into an ENOENT failure.
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

async function pageQualityAssertions(page, label) {
  const result = await page.evaluate(async () => {
    const visible = (element) => {
      if (element.closest('.tab-pane.off, [hidden], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.contentVisibility !== 'hidden';
    };
    const inViewport = (element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > .5
        && rect.height > .5
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    };
    const viewportImages = [...document.images].filter(inViewport);
    await Promise.all(viewportImages.map((element) => {
      if (element.complete) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => resolve();
        element.addEventListener('load', done, { once: true });
        element.addEventListener('error', done, { once: true });
        setTimeout(done, 1500);
      });
    }));

    const controls = [...document.querySelectorAll('.qa-button, .qa-icon-button, .qa-tab-button')].filter(visible);
    const small = controls.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40),
        width: rect.width,
        height: rect.height,
      };
    }).filter(({ width, height }) => width < 43.5 || height < 43.5);
    const unnamedIcons = [...document.querySelectorAll('.qa-icon-button')]
      .filter(visible)
      .filter((element) => !(element.getAttribute('aria-label') || '').trim())
      .map((element) => element.outerHTML.slice(0, 160));
    const brokenImages = viewportImages
      // Lazy images in adjacent scroll-snap cards have layout boxes but are not
      // requested until the card enters the viewport. Treating those as broken
      // made the visual gate depend on browser prefetch timing.
      .filter((element) => !element.complete || element.naturalWidth === 0)
      .map((element) => element.currentSrc || element.src);
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      small,
      unnamedIcons,
      brokenImages,
    };
  });
  assert(result.overflow <= 1, `${label} has horizontal overflow`, JSON.stringify(result));
  assert(result.small.length === 0, `${label} has Quiet Aqua controls smaller than 44x44`, JSON.stringify(result.small));
  assert(result.unnamedIcons.length === 0, `${label} has unnamed icon buttons`, result.unnamedIcons.join('\n'));
  assert(result.brokenImages.length === 0, `${label} has broken images`, result.brokenImages.join('\n'));
}

async function visit(page, hash, selector) {
  const app = hash.startsWith('/auth-web') ? '0' : '1';
  const route = hash === '/auth-web' ? '/auth' : hash;
  await page.goto(`${page.__qaBase}/?app=${app}#${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  await settlePage(page);
}

async function readSeedFixtures(page) {
  // The static preview installs its mock backend before React mounts. Query its
  // public read endpoints instead of assuming that a seeded row will forever be
  // id=1: migrations and future fixtures are free to change insertion order.
  const fixtures = await page.evaluate(async () => {
    const token = localStorage.getItem('huanyu_token') || '';
    const get = async (endpoint) => {
      const response = await fetch(`/api${endpoint}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* asserted below */ }
      if (!response.ok) throw new Error(`${endpoint} -> ${response.status}`);
      return payload || {};
    };
    const [characters, groups, theaters, novels] = await Promise.all([
      get('/characters/public'),
      get('/groups'),
      get('/theater'),
      get('/novels'),
    ]);
    const firstId = (items, preferred) => {
      const rows = Array.isArray(items) ? items : [];
      return (rows.find(preferred) || rows[0])?.id || null;
    };
    return {
      characterId: firstId(characters.characters, (row) => row.name === '沈知微'),
      groupId: firstId(groups.groups, (row) => row.name === '幻域创作者联盟'),
      theaterId: firstId(theaters.theaters, (row) => row.name === '永青森林的不速之客'),
      novelId: firstId(novels.novels, (row) => String(row.title || '').includes('朔月当空')),
    };
  });
  for (const [kind, id] of Object.entries(fixtures)) {
    assert(Number.isSafeInteger(Number(id)) && Number(id) > 0, `Static mock is missing the ${kind} fixture`, JSON.stringify(fixtures));
  }
  return fixtures;
}

function consumeExpectedHttpError(page, status, pathFragment) {
  const prefix = `http ${status}: `;
  const matches = [];
  page.__qaErrors.forEach((message, index) => {
    if (message.startsWith(prefix) && message.includes(pathFragment)) matches.push(index);
  });
  // Real network responses are recorded by Puppeteer; the static preview's
  // in-page fetch shim returns a synthetic Response, which intentionally never
  // reaches page.on('response'). The rendered error-state assertions below are
  // therefore the source of truth, while this helper removes a real 404 when
  // one exists so it cannot mask unrelated browser failures.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    page.__qaErrors.splice(matches[index], 1);
  }
}

async function appModalAssertions(page, selector, label) {
  await page.waitForSelector(selector, { visible: true, timeout: 3000 });
  await page.waitForFunction((target) => {
    const dialog = document.querySelector(target);
    const root = document.getElementById('root');
    return Boolean(dialog && dialog.contains(document.activeElement)
      && (root?.inert || root?.getAttribute('aria-hidden') === 'true'));
  }, { timeout: 3000 }, selector);
  await page.waitForFunction((target) => {
    const dialog = document.querySelector(target);
    if (!dialog) return false;
    const style = getComputedStyle(dialog);
    const rect = dialog.getBoundingClientRect();
    return Number.parseFloat(style.opacity || '1') >= .98
      && rect.width > 1
      && rect.height > 1
      && rect.bottom > 0
      && rect.top < innerHeight;
  }, { timeout: 3000 }, selector);
  const result = await page.$eval(selector, (dialog) => ({
    role: dialog.getAttribute('role'),
    modal: dialog.getAttribute('aria-modal'),
    portal: dialog.parentElement?.parentElement === document.body,
    focused: dialog.contains(document.activeElement),
    isolated: Boolean(document.getElementById('root')?.inert
      || document.getElementById('root')?.getAttribute('aria-hidden') === 'true'),
  }));
  assert(result.role === 'dialog' && result.modal === 'true', `${label} is missing dialog semantics`, JSON.stringify(result));
  assert(result.portal && result.focused && result.isolated, `${label} broke the App overlay contract`, JSON.stringify(result));
}

async function galleryAssertions(page, expectedPerf) {
  const result = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.qa-button, .qa-icon-button, .qa-tab-button')];
    const small = controls.map((element) => {
      const rect = element.getBoundingClientRect();
      return { cls: element.className, text: element.textContent.trim(), width: rect.width, height: rect.height };
    }).filter(({ width, height }) => width < 43.5 || height < 43.5);
    const unnamedIcons = [...document.querySelectorAll('.qa-icon-button')]
      .filter((element) => !(element.getAttribute('aria-label') || '').trim())
      .map((element) => element.outerHTML.slice(0, 180));
    const disabledLink = document.querySelector('[data-testid="disabled-control-link"]');
    const selected = document.querySelector('[data-selected]');
    const focusTarget = document.querySelector('.qa-gallery .qa-button');
    focusTarget?.focus();
    const focusStyle = focusTarget ? getComputedStyle(focusTarget) : null;
    return {
      app: document.documentElement.dataset.app,
      theme: document.documentElement.dataset.theme,
      perf: document.documentElement.dataset.perf,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      small,
      unnamedIcons,
      disabled: disabledLink ? {
        aria: disabledLink.getAttribute('aria-disabled'),
        tabIndex: disabledLink.tabIndex,
      } : null,
      selected: Boolean(selected),
      selectedPressed: document.querySelector('[aria-pressed="true"]')?.hasAttribute('data-selected') || false,
      focusOutline: focusStyle ? `${focusStyle.outlineStyle} ${focusStyle.outlineWidth}` : '',
    };
  });
  assert(result.app === '1', '控件页未进入 App 模式', JSON.stringify(result));
  assert(result.perf === expectedPerf, `性能档错误：期望 ${expectedPerf}，实际 ${result.perf}`);
  assert(result.overflow <= 1, '控件页存在横向溢出', JSON.stringify(result));
  assert(result.small.length === 0, '存在小于 44×44 的 Quiet Aqua 控件', JSON.stringify(result.small));
  assert(result.unnamedIcons.length === 0, '存在无可访问名称的图标按钮', result.unnamedIcons.join('\n'));
  assert(result.disabled?.aria === 'true' && result.disabled?.tabIndex === -1, '不可用链接仍可聚焦或缺少 aria-disabled');
  assert(result.selected && result.selectedPressed, 'selected / pressed 状态联系表不完整');
  assert(!result.focusOutline.startsWith('none') && !result.focusOutline.endsWith('0px'), 'focus-visible 外环不可见', result.focusOutline);

  const beforeHash = await page.evaluate(() => location.hash);
  await page.click('[data-testid="disabled-control-link"]');
  const afterHash = await page.evaluate(() => location.hash);
  assert(beforeHash === afterHash, '不可用链接仍触发了导航');

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.qa-button')].find((node) => node.textContent.includes('加载演示'));
    button?.click();
  });
  await page.waitForSelector('.qa-button[aria-busy="true"] .qa-spinner', { timeout: 2000 });
}

async function dockAndOverlayAssertions(page, expectedPerf) {
  await visit(page, '/today', '.apphome');
  const dock = await page.evaluate(() => {
    const nav = document.querySelector('.app-dock nav');
    const fab = document.querySelector('.app-dock .app-fab');
    const firstStory = document.querySelector('.ah-resume');
    const navRect = nav?.getBoundingClientRect();
    const storyRect = firstStory?.getBoundingClientRect();
    const style = nav ? getComputedStyle(nav) : null;
    return {
      links: nav?.querySelectorAll('a').length || 0,
      fabOutside: Boolean(nav && fab && !nav.contains(fab)),
      // Lumen：Dock 是悬浮玻璃条（底距 12px），内容从玻璃下穿过是设计语义；
      // 首屏故事卡允许伸入不超过悬浮底距（12px+1 容差），滚动可完全露出。
      storyClearsDock: !storyRect || !navRect || storyRect.bottom <= navRect.top + 13,
      storyBottom: storyRect?.bottom || null,
      dockTop: navRect?.top || null,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      backdrop: style?.backdropFilter || style?.webkitBackdropFilter || '',
      tabbarBackdrop: (() => {
        const bar = document.querySelector('.app-tabbar');
        if (!bar) return '';
        const cs = getComputedStyle(bar);
        return cs.backdropFilter || cs.webkitBackdropFilter || '';
      })(),
      headingFont: (() => {
        const h = document.querySelector('.aht-brand, .apphome h2, .apphome h1');
        return h ? getComputedStyle(h).fontFamily : '';
      })(),
      perf: document.documentElement.dataset.perf,
    };
  });
  assert(dock.links === 4 && dock.fabOutside, 'Dock 必须只有四个导航目的地，创建按钮在 nav 外', JSON.stringify(dock));
  assert(dock.storyClearsDock, 'Today 首屏故事卡片被 Dock 遮挡', JSON.stringify(dock));
  assert(dock.overflow <= 1, 'Today 存在横向溢出', JSON.stringify(dock));
  assert(dock.perf === expectedPerf, 'Today 性能档不一致', JSON.stringify(dock));
  assert(!/Fraunces|Songti|Noto Serif/i.test(dock.headingFont), 'App 标题不得回落到展示衬线字体', dock.headingFont);
  if (expectedPerf === 'lite') {
    assert(!dock.backdrop || dock.backdrop === 'none', '极简性能档仍启用了 Dock 模糊', dock.backdrop);
  }
  if (expectedPerf === 'balanced') {
    // Liuli v5 契约：chrome 层玻璃在 balanced 常开（内容卡仍不透明）。
    assert(/blur\(/.test(dock.tabbarBackdrop), 'balanced 档 Dock 必须保有 chrome 玻璃', dock.tabbarBackdrop);
  }

  await page.click('.app-fab');
  await page.waitForSelector('#app-create-sheet', { visible: true });
  // The portal paints before React effects register it with OverlayProvider.
  // Wait for the observable isolation/focus contract, not merely the first DOM frame.
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    const sheet = document.getElementById('app-create-sheet');
    return Boolean(
      sheet
      && (root?.inert || root?.getAttribute('aria-hidden') === 'true')
      && sheet.contains(document.activeElement),
    );
  }, { timeout: 3000 });
  const overlay = await page.evaluate(() => {
    const root = document.getElementById('root');
    const sheet = document.getElementById('app-create-sheet');
    const style = sheet ? getComputedStyle(sheet) : null;
    return {
      portal: sheet?.parentElement?.parentElement === document.body,
      isolated: Boolean(root?.inert || root?.getAttribute('aria-hidden') === 'true'),
      focused: Boolean(sheet?.contains(document.activeElement)),
      backdrop: style?.backdropFilter || style?.webkitBackdropFilter || '',
    };
  });
  assert(overlay.portal && overlay.isolated && overlay.focused, 'Create Sheet 未保持 Portal、隔离或焦点管理', JSON.stringify(overlay));
  if (expectedPerf === 'lite') {
    assert(!overlay.backdrop || overlay.backdrop === 'none', '极简性能档仍启用了 Sheet 模糊', overlay.backdrop);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('#app-create-sheet', { hidden: true });
  try {
    await page.waitForFunction(() => document.activeElement?.classList.contains('app-fab'), { timeout: 3000 });
  } catch (error) {
    const details = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeClass: document.activeElement?.className || '',
      fabConnected: Boolean(document.querySelector('.app-fab')?.isConnected),
      rootInert: Boolean(document.getElementById('root')?.inert),
      rootHidden: document.getElementById('root')?.getAttribute('aria-hidden'),
    }));
    throw new Error(`关闭 Create Sheet 后焦点归还超时\n${JSON.stringify(details)}`, { cause: error });
  }
  const focusReturned = await page.evaluate(() => document.activeElement?.classList.contains('app-fab'));
  assert(focusReturned, '关闭 Create Sheet 后焦点未归还创建按钮');
}

async function integrationAssertions(browser, base) {
  const auth = await preparePage(browser, base, { app: true, token: false });
  await visit(auth, '/auth', '.auth-card');
  await auth.click('#auth-tab-register');
  await auth.waitForFunction(() => document.querySelector('#auth-tab-register')?.getAttribute('aria-selected') === 'true');
  const authResult = await auth.evaluate(() => {
    const tabs = [...document.querySelectorAll('.auth-tabs [role="tab"]')];
    const submit = document.querySelector('.auth-submit');
    return {
      tabs: tabs.length,
      selected: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
      submitHeight: submit?.getBoundingClientRect().height || 0,
      copy: document.querySelector('.auth-card .muted')?.textContent || '',
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
  assert(authResult.tabs === 2 && authResult.selected === 1, 'App 登录分段语义不完整', JSON.stringify(authResult));
  assert(authResult.submitHeight >= 47.5, '认证提交按钮小于 48px', JSON.stringify(authResult));
  assert(authResult.copy.includes('HTTP App 壳内测'), 'App 注册边界文案错误', authResult.copy);
  assert(authResult.overflow <= 1, 'Auth 存在横向溢出', JSON.stringify(authResult));
  await auth.waitForSelector('.app-boot', { hidden: true, timeout: 2200 }).catch(() => {});
  await auth.screenshot({ path: path.join(OUT, 'auth-register-390x844-light.png') });
  await auth.close();

  const web = await preparePage(browser, base, { app: false, token: false });
  await visit(web, '/auth-web', '.auth-card');
  await web.evaluate(() => document.querySelectorAll('.auth-tabs button')[1]?.click());
  await web.waitForFunction(() => document.querySelector('.auth-tabs button.active')?.textContent.trim() === '注册');
  const webResult = await web.evaluate(() => ({
    app: document.documentElement.dataset.app,
    qaClasses: document.querySelectorAll('[class*="qa-"]').length,
    wrappers: document.querySelectorAll('.qa-button__content, .qa-icon-button__content').length,
    // web: W4 起 Web 壳自有 Lumen 控件（.lgw-*）合法携带 loading/selected 状态
    // 属性；守卫改为「状态属性只允许出现在 lgw 控件上」—— qa-* 泄漏仍零容忍。
    strayStates: [...document.querySelectorAll('[data-selected], [data-loading], [aria-busy="true"]')]
      .filter((el) => !((el.getAttribute('class') || '').includes('lgw-'))).length,
    copy: document.querySelector('.auth-card .muted')?.textContent || '',
  }));
  assert(webResult.app === '0', 'Web guard 未退出 App 模式', JSON.stringify(webResult));
  assert(webResult.qaClasses === 0 && webResult.wrappers === 0 && webResult.strayStates === 0, 'Web 被 Quiet Aqua DOM 污染', JSON.stringify(webResult));
  assert(webResult.copy.includes('正式 Play App 可注册'), 'Web 既有文案被 App 内测文案覆盖', webResult.copy);
  await web.close();

  const chat = await preparePage(browser, base, { app: true, token: true });
  await visit(chat, '/chats/1', '.chat-input-bar');
  const chatResult = await chat.evaluate(() => {
    const islandButtons = [...document.querySelectorAll('.chat-input-bar .qa-icon-button')];
    const small = islandButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width < 43.5 || rect.height < 43.5;
    }).length;
    const send = document.querySelector('.chat-input-bar .send-btn');
    return {
      small,
      sendDisabled: Boolean(send?.disabled || send?.getAttribute('aria-disabled') === 'true'),
      actionsControls: document.querySelector('.chat-input-bar [aria-controls="chat-actions-panel"]')?.getAttribute('aria-expanded'),
      toolsControls: document.querySelector('.chat-input-bar [aria-controls="chat-tools-panel"]')?.getAttribute('aria-expanded'),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
  assert(chatResult.small === 0 && chatResult.sendDisabled, '聊天输入岛热区或空发送状态错误', JSON.stringify(chatResult));
  assert(chatResult.actionsControls === 'false' && chatResult.toolsControls === 'false', '聊天展开控件缺少状态关联', JSON.stringify(chatResult));
  assert(chatResult.overflow <= 1, 'Chat 存在横向溢出', JSON.stringify(chatResult));
  assert(chat.__qaErrors.length === 0, 'Chat 产生浏览器错误', chat.__qaErrors.join('\n'));
  await chat.waitForSelector('.app-boot', { hidden: true, timeout: 2200 }).catch(() => {});
  await chat.screenshot({ path: path.join(OUT, 'chat-390x844-light.png') });
  await chat.close();
}

async function captureCoreScreens(browser, base, theme) {
  const page = await preparePage(browser, base, { app: true, token: true, theme, perf: 'auto' });
  const screens = [
    ['/today', '.apphome', 'today'],
    ['/', '.qa-discover-page', 'discover'],
    ['/messages', '.qa-messages-page', 'messages'],
    ['/me', '.qa-profile', 'profile'],
    ['/notifications', '.qa-notifications', 'notifications'],
    ['/wallet', '.qa-wallet', 'wallet'],
    ['/vip', '.qa-vip', 'vip'],
    ['/settings', '.qa-settings-page', 'settings'],
    ['/friends', '.qa-friends-page', 'friends'],
    ['/groups', '.qa-groups-page', 'groups'],
    ['/search', '.qa-search-page', 'search'],
    ['/announcements', '.qa-announcements-page', 'announcements'],
    ['/events', '.qa-events-page', 'events'],
    ['/library', '.qa-library-page', 'library'],
    ['/worldbooks', '.qa-worldbooks-page', 'worldbooks'],
    ['/worldbook/1', '.qa-worldbooks-view', 'worldbook-view'],
    ['/atelier', '.qa-atelier', 'atelier'],
    ['/theater', '.qa-theater-page', 'theater'],
    ['/achievements', '.qa-achievements-page', 'achievements'],
    ['/leaderboard', '.qa-leaderboard-page', 'leaderboard'],
    ['/gacha', '.qa-gacha-page', 'gacha'],
    ['/app-controls', '.qa-gallery', 'controls'],
  ];
  for (const [route, selector, name] of screens) {
    await visit(page, route, selector);
    // Baselines represent the settled application, not the bootstrap fade.
    await page.waitForSelector('.app-boot', { hidden: true, timeout: 2200 }).catch(() => {});
    await pageQualityAssertions(page, `${name} ${theme}`);
    await page.screenshot({ path: path.join(OUT, `${name}-390x844-${theme}.png`) });
  }
  assert(page.__qaErrors.length === 0, `${theme} 截图流程产生浏览器错误`, page.__qaErrors.join('\n'));
  await page.close();
}

async function walletAssertions(browser, base) {
  for (const theme of ['light', 'dark']) {
    const page = await preparePage(browser, base, {
      app: true,
      token: true,
      theme,
      perf: 'auto',
      viewport: { width: 390, height: 844 },
    });
    await visit(page, '/wallet', '.qa-wallet-v4');
    await page.waitForSelector('.app-boot', { hidden: true, timeout: 2200 }).catch(() => {});
    const wallet = await page.evaluate(() => {
      const head = document.querySelector('.qa-wallet-v4 .qa-wallet-head');
      const quick = document.querySelector('.qa-wallet-v4__quick .qa-button');
      const balance = document.querySelector('.qa-wallet-v4__balance');
      const filterOf = (node) => {
        const style = getComputedStyle(node);
        return style.backdropFilter || style.webkitBackdropFilter || '';
      };
      const currencyImages = [...document.querySelectorAll('.qa-wallet-v4__asset-icon img')];
      return {
        headGlass: filterOf(head),
        quickGlass: filterOf(quick),
        balanceGlass: filterOf(balance),
        switchPresent: Boolean(document.querySelector('.qa-wallet-v4__switch')),
        currencyPng: currencyImages.length === 2 && currencyImages.every((image) => (/\.png(?:$|\?)/i.test(image.currentSrc) || image.currentSrc.startsWith('data:image/png')) && image.naturalWidth > 0),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    });
    assert(wallet.headGlass.includes('blur(') && wallet.quickGlass.includes('blur(') && wallet.balanceGlass.includes('blur('), 'Wallet balanced 档丢失玻璃材质', JSON.stringify(wallet));
    assert(!wallet.switchPresent, 'Wallet 根页仍存在与母版不符的双层分段器', JSON.stringify(wallet));
    assert(wallet.currencyPng, 'Wallet 货币资产未使用可加载的 PNG', JSON.stringify(wallet));
    assert(wallet.overflow <= 1, 'Wallet 存在横向溢出', JSON.stringify(wallet));
    await page.screenshot({ path: path.join(OUT, `wallet-390x844-${theme}.png`) });

    await page.click('.qa-wallet-v4__recharge');
    await page.waitForFunction(() => document.querySelector('.qa-wallet-v4')?.dataset.walletView === 'recharge');
    const recharge = await page.evaluate(() => {
      const productImages = [...document.querySelectorAll('.qa-wallet-v4__gem img')];
      const checkout = document.querySelector('.qa-wallet-v4__checkout');
      const checkoutRect = checkout?.getBoundingClientRect();
      const packageLayout = [...document.querySelectorAll('.qa-wallet-v4__packages > button')].every((card) => {
        const gem = card.querySelector('.qa-wallet-v4__gem')?.getBoundingClientRect();
        const amount = card.querySelector('strong')?.getBoundingClientRect();
        const reward = card.querySelector(':scope > span:not(.qa-wallet-v4__gem)')?.getBoundingClientRect();
        const price = card.querySelector(':scope > b')?.getBoundingClientRect();
        return gem && amount && reward && price
          && gem.bottom <= amount.top + 1
          && amount.bottom <= reward.top + 1
          && reward.bottom <= price.top + 1;
      });
      return {
        productCount: productImages.length,
        productPng: productImages.length > 0 && productImages.every((image) => (/\.png(?:$|\?)/i.test(image.currentSrc) || image.currentSrc.startsWith('data:image/png')) && image.naturalWidth > 0),
        packageLayout,
        checkoutGlass: (getComputedStyle(checkout).backdropFilter || ''),
        checkoutPosition: getComputedStyle(checkout).position,
        checkoutRect: checkoutRect ? { top: checkoutRect.top, bottom: checkoutRect.bottom, width: checkoutRect.width } : null,
        viewportHeight: window.innerHeight,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    });
    assert(recharge.productPng, 'Recharge 套餐未使用可加载的 PNG', JSON.stringify(recharge));
    assert(recharge.checkoutGlass.includes('blur('), 'Recharge 结算层丢失玻璃材质', JSON.stringify(recharge));
    assert(recharge.checkoutPosition === 'fixed' && recharge.checkoutRect?.top >= 0 && recharge.checkoutRect?.bottom <= recharge.viewportHeight + 1, 'Recharge 结算层未固定在可视区', JSON.stringify(recharge));
    assert(recharge.overflow <= 1, 'Recharge 存在横向溢出', JSON.stringify(recharge));
    assert(recharge.packageLayout, 'Recharge package art and numbers still overlap', JSON.stringify(recharge));
    await page.screenshot({ path: path.join(OUT, `wallet-recharge-390x844-${theme}.png`) });
    assert(page.__qaErrors.length === 0, `Wallet ${theme} 产生浏览器错误`, page.__qaErrors.join('\n'));
    await page.close();
  }
}

async function characterEditorAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 360, height: 800 },
  });
  await visit(page, '/character/new', '.qa-character-editor');
  await page.waitForSelector('.app-boot', { hidden: true, timeout: 2200 }).catch(() => {});

  const inspect = () => page.evaluate(() => {
    const controls = [...document.querySelectorAll('.qa-character-editor .qa-button, .qa-character-editor .qa-icon-button, .qa-character-editor__savebar .qa-button')];
    const small = controls.map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: rect.width, height: rect.height };
    }).filter(({ width, height }) => width < 43.5 || height < 43.5);
    const savebar = document.querySelector('.qa-character-editor__savebar')?.getBoundingClientRect();
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      tabs: document.querySelectorAll('.qa-character-editor [role="tab"]').length,
      selectedTabs: document.querySelectorAll('.qa-character-editor [role="tab"][aria-selected="true"]').length,
      panels: document.querySelectorAll('.qa-character-editor [role="tabpanel"]').length,
      unnamedIcons: [...document.querySelectorAll('.qa-character-editor .qa-icon-button')]
        .filter((element) => !(element.getAttribute('aria-label') || '').trim()).length,
      dock: Boolean(document.querySelector('.app-tabbar')),
      savebarBottom: savebar ? Math.abs(window.innerHeight - savebar.bottom) : null,
      savebarHeight: savebar?.height || 0,
      small,
    };
  });

  let result = await inspect();
  assert(result.tabs === 4 && result.selectedTabs === 1 && result.panels === 1, '角色编辑器四段 ARIA 结构不完整', JSON.stringify(result));
  assert(result.overflow <= 1, '角色编辑器在 360px 出现横向溢出', JSON.stringify(result));
  assert(result.small.length === 0, '角色编辑器存在小于 44×44 的 Quiet Aqua 控件', JSON.stringify(result.small));
  assert(result.unnamedIcons === 0, '角色编辑器存在无可访问名称的图标按钮');
  assert(!result.dock, '角色编辑器无 Dock 路由仍渲染了底部 Dock');
  assert(result.savebarBottom !== null && result.savebarBottom <= 1 && result.savebarHeight >= 68, '角色编辑器保存条没有贴合视口底部', JSON.stringify(result));
  await page.screenshot({ path: path.join(OUT, 'character-editor-basic-360x800-light.png') });

  for (const step of ['world', 'media']) {
    await page.click(`#character-editor-tab-${step}`);
    await page.waitForSelector(`#character-editor-panel-${step}`, { visible: true });
    result = await inspect();
    assert(result.overflow <= 1, `角色编辑器 ${step} 分段出现横向溢出`, JSON.stringify(result));
    assert(result.small.length === 0, `角色编辑器 ${step} 分段存在小于 44×44 的 Quiet Aqua 控件`, JSON.stringify(result.small));
    await page.screenshot({ path: path.join(OUT, `character-editor-${step}-360x800-light.png`) });
  }
  assert(page.__qaErrors.length === 0, '角色编辑器 App 流程产生浏览器错误', page.__qaErrors.join('\n'));
  await page.close();

  const dark = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'dark',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });
  await visit(dark, '/character/new', '.qa-character-editor');
  await dark.click('#character-editor-tab-media');
  await dark.waitForSelector('#character-editor-panel-media', { visible: true });
  const darkResult = await dark.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    surface: getComputedStyle(document.querySelector('.qa-character-editor__media > .field')).backgroundColor,
  }));
  assert(darkResult.theme === 'dark' && darkResult.overflow <= 1, '角色编辑器深色模式或宽度回归', JSON.stringify(darkResult));
  assert(darkResult.surface !== 'rgb(255, 255, 255)', '角色编辑器深色模式仍使用白色表面', JSON.stringify(darkResult));
  assert(dark.__qaErrors.length === 0, '角色编辑器深色模式产生浏览器错误', dark.__qaErrors.join('\n'));
  await dark.screenshot({ path: path.join(OUT, 'character-editor-media-390x844-dark.png') });
  await dark.close();

  const web = await preparePage(browser, base, { app: false, token: true, viewport: { width: 1280, height: 900 } });
  await web.goto(`${base}/?app=0#/character/new`, { waitUntil: 'networkidle0', timeout: 30000 });
  await web.waitForSelector('.page .tabs-bar', { visible: true, timeout: 20000 });
  const webResult = await web.evaluate(() => ({
    appRoot: Boolean(document.querySelector('.qa-character-editor')),
    savebar: Boolean(document.querySelector('.qa-character-editor__savebar')),
    tabLabels: [...document.querySelectorAll('.page > .tabs-bar > button')].map((button) => button.textContent.trim()),
    topSave: [...document.querySelectorAll('.topbar button')].some((button) => button.textContent.includes('保存角色')),
  }));
  assert(!webResult.appRoot && !webResult.savebar, 'CharacterEditor 的 App DOM 泄漏到 Web', JSON.stringify(webResult));
  assert(webResult.topSave && webResult.tabLabels.join('|') === '基础信息|人设 / 简介|世界书 (0)|立绘 / 背景', 'CharacterEditor Web 基线 DOM/文案发生变化', JSON.stringify(webResult));
  assert(web.__qaErrors.length === 0, '角色编辑器 Web 基线产生浏览器错误', web.__qaErrors.join('\n'));
  await web.close();
}

async function detailRouteAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  // Mount the static mock backend, then resolve all detail fixtures through its
  // read APIs. No route below depends on a particular insertion sequence.
  await visit(page, '/today', '.apphome');
  const fixtures = await readSeedFixtures(page);

  await visit(page, `/character/${fixtures.characterId}`, '.qa-character-view');
  await pageQualityAssertions(page, 'character view light');
  const character = await page.evaluate(() => ({
    name: document.querySelector('.qa-character-view .cvx-name')?.textContent.trim() || '',
    hero: Boolean(document.querySelector('.qa-character-view .cvx-hero-media')),
    primaryAction: Boolean(document.querySelector('.qa-character-view .cvx-go')),
    favoriteAction: Boolean(document.querySelector('.qa-character-view .cvx-fav')),
    dock: Boolean(document.querySelector('.app-tabbar')),
  }));
  assert(character.name && character.hero && character.primaryAction && character.favoriteAction,
    'CharacterView is missing its identity, hero, or primary actions', JSON.stringify(character));
  assert(!character.dock, 'CharacterView detail route rendered the primary Dock', JSON.stringify(character));
  await saveScreenshot(page, 'character-view-390x844-light.png');

  await visit(page, `/group/${fixtures.groupId}`, '.qa-group-room');
  await pageQualityAssertions(page, 'group room light');
  const group = await page.evaluate(() => ({
    identity: document.querySelector('.qa-group-room-identity b')?.textContent.trim() || '',
    log: document.querySelector('.qa-group-room-scroll')?.getAttribute('role'),
    messages: document.querySelectorAll('.qa-group-room .group-message').length,
    composer: Boolean(document.querySelector('.qa-group-room-composer textarea')),
    emptySendDisabled: Boolean(document.querySelector('.qa-group-room-send')?.disabled),
    dock: Boolean(document.querySelector('.app-tabbar')),
  }));
  assert(group.identity && group.log === 'log' && group.messages > 0 && group.composer,
    'GroupRoom did not render its identity, message log, seeded thread, and composer', JSON.stringify(group));
  assert(group.emptySendDisabled && !group.dock, 'GroupRoom empty-send or detail-route Dock contract regressed', JSON.stringify(group));
  await saveScreenshot(page, 'group-room-390x844-light.png');

  await page.click('.qa-group-room-members-button');
  await appModalAssertions(page, '.qa-group-room-members-modal', 'GroupRoom members sheet');
  const groupMembers = await page.$$eval('.qa-group-room-member', (rows) => rows.length);
  assert(groupMembers > 0, 'GroupRoom members sheet is empty for a seeded group');
  await saveScreenshot(page, 'group-room-members-390x844-light.png');
  await page.click('.qa-group-room-members-modal [aria-label="关闭成员列表"]');
  await page.waitForSelector('.qa-group-room-members-modal', { hidden: true, timeout: 3000 });

  await visit(page, `/theater/${fixtures.theaterId}`, '.qa-theater-room');
  await page.$eval('.inovel-scroll', (element) => element.scrollTo({ top: 0, behavior: 'auto' }));
  await sleep(120);
  await pageQualityAssertions(page, 'theater room light');
  const theater = await page.evaluate(() => ({
    title: document.querySelector('.qa-theater-room .inovel-title')?.textContent.trim() || '',
    passages: document.querySelectorAll('.qa-theater-room .inovel-passage').length,
    cast: document.querySelectorAll('.qa-theater-room .inovel-cast-tag').length,
    composer: Boolean(document.querySelector('.qa-theater-room .inovel-input, .qa-theater-room textarea')),
    dock: Boolean(document.querySelector('.app-tabbar')),
  }));
  assert(theater.title && theater.passages > 0 && theater.cast > 0 && theater.composer,
    'TheaterRoom did not render its title, seeded prose, cast, and action composer', JSON.stringify(theater));
  assert(!theater.dock, 'TheaterRoom detail route rendered the primary Dock', JSON.stringify(theater));
  await saveScreenshot(page, 'theater-room-390x844-light.png');

  await page.click('.qa-theater-room-head [aria-label="更多阅读设置"]');
  await appModalAssertions(page, '.qa-theater-more-sheet', 'TheaterRoom reading settings sheet');
  const theaterSettings = await page.evaluate(() => ({
    fontGroup: Boolean(document.querySelector('.qa-theater-font-segment[role="group"]')),
    toolButtons: document.querySelectorAll('.qa-theater-tool-list .qa-button').length,
  }));
  assert(theaterSettings.fontGroup && theaterSettings.toolButtons >= 2,
    'TheaterRoom settings sheet is missing reading or work tools', JSON.stringify(theaterSettings));
  await saveScreenshot(page, 'theater-room-settings-390x844-light.png');
  await page.click('.qa-theater-more-sheet [aria-label="关闭更多设置"]');
  await page.waitForSelector('.qa-theater-more-sheet', { hidden: true, timeout: 3000 });

  await visit(page, `/atelier/${fixtures.novelId}`, '.qa-novel-workspace');
  await page.$eval('.qa-novel-manuscript', (element) => element.scrollTo({ top: 0, behavior: 'auto' }));
  await sleep(120);
  await pageQualityAssertions(page, 'novel workspace light');
  const workspace = await page.evaluate(() => ({
    title: document.querySelector('.qa-novel-page-head .atl-ms-title')?.textContent.trim() || '',
    toolbar: document.querySelectorAll('.qa-novel-toolbar .qa-button').length,
    manuscript: Boolean(document.querySelector('.qa-novel-manuscript[role="region"]')),
    composer: Boolean(document.querySelector('.qa-novel-composer')),
    dock: Boolean(document.querySelector('.app-tabbar')),
  }));
  assert(workspace.title && workspace.toolbar >= 4 && workspace.manuscript && workspace.composer,
    'NovelWorkspace did not render its manuscript, toolbar, and composer', JSON.stringify(workspace));
  assert(!workspace.dock, 'NovelWorkspace detail route rendered the primary Dock', JSON.stringify(workspace));
  await saveScreenshot(page, 'novel-workspace-390x844-light.png');

  await page.click('.qa-novel-more');
  await appModalAssertions(page, '.qa-novel-more-sheet', 'NovelWorkspace tools sheet');
  const novelTools = await page.$$eval('.qa-novel-more-list .qa-button', (buttons) => buttons.length);
  assert(novelTools >= 4, 'NovelWorkspace tools sheet is incomplete', String(novelTools));
  await saveScreenshot(page, 'novel-workspace-tools-390x844-light.png');
  await page.click('.qa-novel-more-sheet [aria-label="关闭更多工具"]');
  await page.waitForSelector('.qa-novel-more-sheet', { hidden: true, timeout: 3000 });

  assert(page.__qaErrors.length === 0, 'Detail route screenshot flow produced browser errors', page.__qaErrors.join('\n'));
  await page.close();
}

async function scriptRouteAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/script/2', '.qa-script-detail-v4');
  await pageQualityAssertions(page, 'script detail light');
  const detail = await page.evaluate(() => ({
    title: document.querySelector('.qa-script-detail-v4__hero-copy h1')?.textContent.trim() || '',
    unlock: Boolean(document.querySelector('.qa-script-detail-v4__unlock-button')),
    reviews: Boolean(document.querySelector('.qa-script-detail-v4__reviews')),
    dock: Boolean(document.querySelector('.app-tabbar')),
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
  }));
  assert(detail.title && detail.unlock && detail.reviews && !detail.dock && detail.overflow <= 1,
    'ScriptDetail App surface is missing its paywall, review region, or detail-route shell', JSON.stringify(detail));
  await saveScreenshot(page, 'script-detail-390x844-light.png');
  await page.evaluate(() => document.scrollingElement?.scrollTo({ top: 520, behavior: 'auto' }));
  await sleep(80);
  const detailTop = await page.$eval('.qa-script-detail-v4__topbar', (element) => element.getBoundingClientRect().top);
  assert(detailTop >= -0.5 && detailTop <= 0.5, 'ScriptDetail top bar stopped sticking while reading', String(detailTop));

  await visit(page, '/script/new', '.qa-script-editor-v4');
  await pageQualityAssertions(page, 'script editor light');
  const editor = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.qa-script-editor-v4__tab').length,
    sections: document.querySelectorAll('.qa-script-editor-v4__section').length,
    savebar: Boolean(document.querySelector('.qa-script-editor-v4__savebar')),
    title: Boolean(document.querySelector('#qa-script-title')),
    story: Boolean(document.querySelector('#qa-script-content')),
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
  }));
  assert(editor.tabs === 3 && editor.sections === 3 && editor.savebar && editor.title && editor.story && editor.overflow <= 1,
    'ScriptEditor App surface is missing its section navigation, form regions, or save bar', JSON.stringify(editor));
  await saveScreenshot(page, 'script-editor-390x844-light.png');
  await page.click('.qa-script-editor-v4__tab[data-section="story"]');
  await sleep(650);
  const storyPosition = await page.$eval('#qa-script-editor-story', (element) => element.getBoundingClientRect().top);
  const scriptChrome = await page.evaluate(() => {
    const topbar = document.querySelector('.qa-script-editor-v4__topbar')?.getBoundingClientRect();
    const tabs = document.querySelector('.qa-script-editor-v4__tabs')?.getBoundingClientRect();
    return { topbar: topbar ? { top: topbar.top, bottom: topbar.bottom } : null, tabs: tabs ? { top: tabs.top, bottom: tabs.bottom } : null };
  });
  assert(storyPosition < 180, 'ScriptEditor section navigation did not bring the story section into view', String(storyPosition));
  assert(scriptChrome.topbar?.top >= -0.5 && scriptChrome.tabs?.top >= scriptChrome.topbar.bottom - 0.5,
    'ScriptEditor top bar or section tabs stopped sticking during long-form editing', JSON.stringify(scriptChrome));
  await saveScreenshot(page, 'script-editor-story-390x844-light.png');

  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${base}/?app=1#/script/new`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.qa-script-editor-v4', { visible: true, timeout: 20000 });
  await settlePage(page);
  await page.evaluate(() => {
    document.scrollingElement?.scrollTo({ top: 0, behavior: 'auto' });
    document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'auto' });
  });
  await page.click('.qa-script-editor-v4__tab[data-section="basics"]');
  await sleep(650);
  await pageQualityAssertions(page, 'script editor 360 light');
  const narrow = await page.$eval('.qa-script-editor-v4__savebar', (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width };
  });
  assert(narrow.left >= 0 && narrow.right <= 360 && narrow.bottom <= 800.5,
    'ScriptEditor save bar is clipped at 360px', JSON.stringify(narrow));
  await saveScreenshot(page, 'script-editor-360x800-light.png');

  assert(page.__qaErrors.length === 0, 'Script detail/editor route flow produced browser errors', page.__qaErrors.join('\n'));
  await page.close();

  const web = await preparePage(browser, base, {
    app: false,
    token: true,
    viewport: { width: 1280, height: 800 },
  });
  await web.goto(`${base}/?app=0#/script/new`, { waitUntil: 'networkidle0', timeout: 30000 });
  await web.waitForSelector('.topbar', { visible: true, timeout: 20000 });
  await settlePage(web);
  const webBaseline = await web.evaluate(() => ({
    appRoot: Boolean(document.querySelector('.qa-script-editor-v4')),
    savebar: Boolean(document.querySelector('.qa-script-editor-v4__savebar')),
    title: document.querySelector('.topbar h1')?.textContent.trim() || '',
    legacySave: [...document.querySelectorAll('.topbar button')].some((button) => button.textContent.includes('保存')),
    fields: document.querySelectorAll('.page > .field').length,
  }));
  assert(!webBaseline.appRoot && !webBaseline.savebar && webBaseline.title === '创建剧本'
    && webBaseline.legacySave && webBaseline.fields >= 5,
  'ScriptEditor App DOM or composition leaked into the Web baseline', JSON.stringify(webBaseline));
  assert(web.__qaErrors.length === 0, 'ScriptEditor Web baseline produced browser errors', web.__qaErrors.join('\n'));
  await web.close();
}

async function worldbookEditorAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  // New drafts exercise the empty-state path while the seeded book exercises
  // grouped entries and the advanced controls. Both must share the App shell.
  await visit(page, '/worldbook/new/edit', '.qa-worldbook-editor');
  await pageQualityAssertions(page, 'worldbook editor new light');
  const fresh = await page.evaluate(() => {
    const savebar = document.querySelector('.qa-worldbook-editor__savebar');
    const rect = savebar?.getBoundingClientRect();
    return {
      tabs: document.querySelectorAll('.qa-worldbook-editor__tab').length,
      toolbar: document.querySelectorAll('.qa-worldbook-editor__toolbar .qa-button').length,
      savebar: Boolean(savebar),
      savebarInside: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight + 1),
      identity: Boolean(document.querySelector('.qa-worldbook-editor__identity')),
      entries: Boolean(document.querySelector('.qa-worldbook-editor__entries-head')),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    };
  });
  assert(fresh.tabs === 4 && fresh.toolbar >= 2 && fresh.savebar && fresh.savebarInside && fresh.identity && fresh.entries && fresh.overflow <= 1,
    'WorldbookEditor new-draft App shell is incomplete or clipped', JSON.stringify(fresh));

  const opened = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.qa-worldbook-editor__toolbar .qa-button')]
      .find((element) => element.textContent.includes('AI 拆书'));
    button?.click();
    return Boolean(button);
  });
  assert(opened, 'WorldbookEditor is missing the AI split action');
  await appModalAssertions(page, '.qa-worldbook-editor__modal', 'Worldbook AI split sheet');
  await page.click('.qa-worldbook-editor__modal .btn.block');
  await page.waitForSelector('.qa-worldbook-editor__modal', { hidden: true, timeout: 3000 });
  await saveScreenshot(page, 'worldbook-new-editor-390x844-light.png');

  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${base}/?app=1#/worldbook/new/edit`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.qa-worldbook-editor', { visible: true, timeout: 20000 });
  await settlePage(page);
  await pageQualityAssertions(page, 'worldbook editor new 360 light');
  const narrow = await page.evaluate(() => {
    const savebar = document.querySelector('.qa-worldbook-editor__savebar');
    const rect = savebar?.getBoundingClientRect();
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? innerWidth + 1,
      bottom: rect?.bottom ?? 0,
      controls: [...document.querySelectorAll('.qa-worldbook-editor .qa-button, .qa-worldbook-editor .qa-icon-button')]
        .filter((element) => { const r = element.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).length,
    };
  });
  assert(narrow.overflow <= 1 && narrow.left >= 0 && narrow.right <= 360 && narrow.bottom <= 800.5 && narrow.controls === 0,
    'WorldbookEditor new-draft shell regressed at 360px', JSON.stringify(narrow));
  await saveScreenshot(page, 'worldbook-new-editor-360x800-light.png');

  await page.goto(`${base}/?app=1#/worldbook/1/edit`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.qa-worldbook-editor', { visible: true, timeout: 20000 });
  await settlePage(page);
  await pageQualityAssertions(page, 'worldbook editor seeded light');
  const seeded = await page.evaluate(() => ({
    entries: document.querySelectorAll('.world-entry').length,
    advancedButtons: document.querySelectorAll('.world-entry .top > button[title="高级配置"]').length,
    entryActions: [...document.querySelectorAll('.world-entry .top > button')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
  }));
  assert(seeded.entries > 0 && seeded.advancedButtons > 0
    && seeded.entryActions.every(({ width, height }) => width >= 43.5 && height >= 43.5)
    && seeded.overflow <= 1,
  'WorldbookEditor seeded entry controls or layout regressed', JSON.stringify(seeded));
  await saveScreenshot(page, 'worldbook-edit-editor-360x800-light.png');

  assert(page.__qaErrors.length === 0, 'WorldbookEditor route flow produced browser errors', page.__qaErrors.join('\n'));
  await page.close();
}

async function detailErrorStateAssertions(browser, base) {
  const missingId = 2147483647;
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, `/character/${missingId}`, '.cvx [role="alert"]');
  consumeExpectedHttpError(page, 404, `/api/characters/${missingId}`);
  const characterError = await page.evaluate(() => ({
    alert: document.querySelector('.cvx [role="alert"]')?.textContent || '',
    actions: document.querySelectorAll('.cvx [role="alert"] .qa-button').length,
  }));
  assert(characterError.alert.includes('暂时无法') && characterError.actions >= 2,
    'CharacterView error state is not actionable', JSON.stringify(characterError));
  await pageQualityAssertions(page, 'character view error');
  await saveScreenshot(page, 'character-view-error-390x844-light.png');

  await visit(page, `/theater/${missingId}`, '.qa-theater-room-loading.is-error');
  consumeExpectedHttpError(page, 404, `/api/theater/${missingId}`);
  const theaterError = await page.evaluate(() => ({
    role: document.querySelector('.qa-theater-room-loading.is-error')?.getAttribute('role'),
    retry: Boolean(document.querySelector('.qa-theater-room-load-error .qa-button')),
    title: document.querySelector('.qa-theater-room-load-error h1')?.textContent || '',
  }));
  assert(theaterError.role === 'alert' && theaterError.retry && theaterError.title,
    'TheaterRoom error state is missing alert or retry semantics', JSON.stringify(theaterError));
  await pageQualityAssertions(page, 'theater room error');
  await saveScreenshot(page, 'theater-room-error-390x844-light.png');

  await visit(page, `/character/${missingId}/edit`, '.qa-character-editor__load-error');
  consumeExpectedHttpError(page, 404, `/api/characters/${missingId}`);
  const editorError = await page.evaluate(() => ({
    role: document.querySelector('.qa-character-editor__load-error')?.getAttribute('role'),
    retry: [...document.querySelectorAll('.qa-character-editor__load-error .qa-button')]
      .some((button) => button.textContent.includes('重试')),
    save: Boolean(document.querySelector('.qa-character-editor__savebar')),
  }));
  assert(editorError.role === 'alert' && editorError.retry && !editorError.save,
    'CharacterEditor failed-load state can still expose saving or lacks retry', JSON.stringify(editorError));
  await pageQualityAssertions(page, 'character editor error');
  await saveScreenshot(page, 'character-editor-error-390x844-light.png');

  // NovelWorkspace deliberately returns to the bookshelf when a work cannot be
  // opened. Verify that this failure path settles on a usable App page instead
  // of leaving a perpetual workspace skeleton.
  await page.goto(`${base}/?app=1#/atelier/${missingId}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.qa-atelier', { visible: true, timeout: 20000 });
  await settlePage(page);
  consumeExpectedHttpError(page, 404, `/api/novels/${missingId}`);
  const novelFallback = await page.evaluate(() => ({
    route: location.hash,
    shelf: Boolean(document.querySelector('.qa-atelier')),
    workspace: Boolean(document.querySelector('.qa-novel-workspace')),
  }));
  assert(novelFallback.route === '#/atelier' && novelFallback.shelf && !novelFallback.workspace,
    'NovelWorkspace missing-work fallback did not return to a usable shelf', JSON.stringify(novelFallback));
  await saveScreenshot(page, 'novel-workspace-error-fallback-390x844-light.png');

  assert(page.__qaErrors.length === 0, 'Expected detail error states produced unexpected browser errors', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G7 · 长按上下文菜单：550ms 触压弹出（隔离契约）→ Escape 关闭回焦；
// 450ms 内位移 >10px 不触发（负例）。
async function pressMenuAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/messages', '.msgs-conv--app .msgs-conv-main');
  const row = await page.$('.msgs-conv--app .msgs-conv-main');
  const box = await row.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 长按 550ms → 菜单弹出
  await page.touchscreen.touchStart(cx, cy);
  await new Promise((resolve) => setTimeout(resolve, 550));
  await page.touchscreen.touchEnd();
  // 菜单语义是 role=menu（非 dialog）：按自身契约验收——可见、聚焦、根隔离。
  // 聚焦等待放宽到 10s：菜单自愈聚焦循环（120ms×12）在长套件高负载下
  // 偶发迟到，5s 窗口会把真实通过判成超时（已实测复跑即绿）。
  await page.waitForSelector('.qa-press-menu', { visible: true, timeout: 5000 });
  await page.waitForFunction(() => {
    const menu = document.querySelector('.qa-press-menu');
    const root = document.getElementById('root');
    return Boolean(menu && menu.contains(document.activeElement)
      && (root?.inert || root?.getAttribute('aria-hidden') === 'true'));
  }, { timeout: 10000 });
  const menu = await page.evaluate(() => ({
    role: document.querySelector('.qa-press-menu')?.getAttribute('role'),
    portal: document.querySelector('.qa-press-mask')?.parentElement === document.body,
    items: [...document.querySelectorAll('.qa-press-item')].map((b) => b.textContent.trim()),
    danger: Boolean(document.querySelector('.qa-press-item.is-danger')),
  }));
  assert(menu.role === 'menu' && menu.portal, '长按菜单缺少 menu 语义或未 portal', JSON.stringify(menu));
  assert(menu.items.some((t) => t.includes('打开对话')) && menu.items.some((t) => t.includes('生成分享卡')) && menu.danger,
    '长按菜单条目不完整', JSON.stringify(menu));
  await saveScreenshot(page, 'press-menu-390x844-light.png');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-press-menu'), { timeout: 5000 });

  // 负例：450ms 内位移超容差不得触发
  await page.touchscreen.touchStart(cx, cy);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.touchscreen.touchMove(cx + 40, cy);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.touchscreen.touchEnd();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(await page.evaluate(() => !document.querySelector('.qa-press-menu')),
    '滑动位移后仍误触长按菜单');

  assert(page.__qaErrors.length === 0, '长按菜单流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 周报卡：有故事即出现，7 根条形 + 整图文字替代 + 统计行 +
// 最相伴角色入口（点击应落到角色页）。
async function weeklyRecapAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/today', '.qa-weekly');
  const recap = await page.evaluate(() => ({
    bars: document.querySelectorAll('.qa-weekly-bar').length,
    todayBar: document.querySelectorAll('.qa-weekly-bar.today').length,
    alt: document.querySelector('.qa-weekly-bars')?.getAttribute('aria-label') || '',
    stats: document.querySelectorAll('.qa-weekly-stats span').length,
    companion: Boolean(document.querySelector('.qa-weekly-comp')),
  }));
  assert(recap.bars === 7 && recap.todayBar === 1, '周报条形数量异常', JSON.stringify(recap));
  assert(recap.alt.includes('本周逐日消息') && recap.stats >= 4, '周报统计行或文字替代缺失', JSON.stringify(recap));
  assert(recap.companion, '演示数据下最相伴角色行应存在');
  await page.evaluate(() => { document.querySelector('.qa-weekly').scrollIntoView({ block: 'center' }); });
  await saveScreenshot(page, 'weekly-recap-390x844-light.png');

  await page.evaluate(() => document.querySelector('.qa-weekly-comp').click());
  await page.waitForFunction(() => location.hash.startsWith('#/character/'), { timeout: 8000 });

  assert(page.__qaErrors.length === 0, '周报卡流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 钱包日历入口：wallet 光语境 streak 行 → 日历 Sheet，
// 月导航往返后回到当月且今日格仍在。
async function walletCalendarAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/wallet', '.qa-streak--wallet');
  await page.click('.qa-streak--wallet');
  await appModalAssertions(page, '.qa-cal', 'wallet check-in calendar sheet');
  const startMonth = await page.$eval('.qa-cal-month', (el) => el.textContent);
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-cal-nav .qa-icon-button')]
      .find((b) => b.getAttribute('aria-label') === '上一月')?.click();
  });
  await page.waitForFunction((prev) => {
    const label = document.querySelector('.qa-cal-month')?.textContent;
    return label && label !== prev && label !== '…';
  }, { timeout: 8000 }, startMonth);
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-cal-nav .qa-icon-button')]
      .find((b) => b.getAttribute('aria-label') === '下一月')?.click();
  });
  await page.waitForFunction((prev) => document.querySelector('.qa-cal-month')?.textContent === prev, { timeout: 8000 }, startMonth);
  const back = await page.evaluate(() => ({
    headers: document.querySelectorAll('.qa-cal-wd').length,
    nextDisabled: [...document.querySelectorAll('.qa-cal-nav .qa-icon-button')]
      .some((b) => b.disabled && b.getAttribute('aria-label') === '下一月'),
  }));
  assert(back.headers === 7 && back.nextDisabled, '钱包日历月导航往返状态异常', JSON.stringify(back));

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-cal'), { timeout: 5000 });

  // 流水筛选：支出档不得出现正向金额行；空档必须给出说明而不是塌缩
  await page.evaluate(() => { document.getElementById('wallet-ledger')?.scrollIntoView({ block: 'center' }); });
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-wallet-v4__tx-filter .qa-button')]
      .find((button) => button.textContent.includes('支出'))?.click();
  });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.qa-wallet-v4__tx')];
    const empty = document.querySelector('.qa-wallet-v4__empty');
    return (rows.length > 0 && rows.every((row) => !row.querySelector('.positive'))) || Boolean(empty);
  }, { timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-wallet-v4__tx-filter .qa-button')]
      .find((button) => button.textContent.includes('全部'))?.click();
  });
  await page.waitForSelector('.qa-wallet-v4__tx', { timeout: 5000 });

  assert(page.__qaErrors.length === 0, '钱包日历流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 台词卡：聊天气泡长按面板 App 分支入口 → 1080×1440 预览。
async function quoteCardAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/messages', '.msgs-conv--app .msgs-conv-main');
  await page.evaluate(() => document.querySelector('.msgs-conv--app .msgs-conv-main').click());
  await page.waitForSelector('.bubble', { visible: true, timeout: 10000 });
  const box = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble')];
    const el = bubbles[bubbles.length - 1];
    el.scrollIntoView({ block: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.touchscreen.touchStart(box.x, box.y);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.touchscreen.touchEnd();
  await page.waitForSelector('.msg-sheet', { visible: true, timeout: 5000 });
  const hasEntry = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ms-row')].find((b) => b.textContent.includes('生成台词卡'));
    if (btn) btn.click();
    return Boolean(btn);
  });
  assert(hasEntry, '长按面板缺少台词卡入口');
  await page.waitForSelector('.qa-share-preview', { visible: true, timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.qa-share-preview');
    return img && img.naturalWidth === 1080 && img.naturalHeight === 1440;
  }, { timeout: 10000 });
  await saveScreenshot(page, 'quote-card-390x844-light.png');

  assert(page.__qaErrors.length === 0, '台词卡流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · Gallery S7 展区：五展区在位；错误演示真 busy 循环；
// 长按演示弹 role=menu；示例台词卡合成 1080×1440。
async function galleryS7Assertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/app-controls', '.qa-gallery');
  const sections = await page.evaluate(() =>
    ['gallery-s7-empty', 'gallery-s7-streak', 'gallery-s7-medal', 'gallery-s7-weekly', 'gallery-s7-companion', 'gallery-s7-press']
      .filter((id) => !document.getElementById(id)));
  assert(sections.length === 0, 'Gallery S7 展区缺失', JSON.stringify(sections));

  // 错误演示：重试 → busy → 1.2s 后归位
  await page.evaluate(() => {
    document.getElementById('gallery-s7-empty').scrollIntoView({ block: 'center' });
    [...document.querySelectorAll('.qa-error-state .qa-button')].at(-1)?.click();
  });
  await page.waitForFunction(() => document.querySelector('.qa-error-state .qa-button[disabled], .qa-error-state .qa-button[data-loading="true"], .qa-error-state .qa-button[aria-busy="true"]'), { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('.qa-error-state .qa-button[disabled], .qa-error-state .qa-button[data-loading="true"], .qa-error-state .qa-button[aria-busy="true"]'), { timeout: 8000 });

  // 长按演示 → role=menu 三条目。先等图片装载完（上方空态 PNG 异步
  // 落位会推移版面），再在触摸前的最后一刻取坐标，避免测完即漂移。
  await page.evaluate(() => Promise.all(
    [...document.images].filter((img) => !img.complete)
      .map((img) => new Promise((resolve) => { img.onload = img.onerror = resolve; })),
  ));
  await page.evaluate(() => {
    document.querySelector('section[aria-labelledby="gallery-s7-press"] .qa-button')
      .scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForFunction(() => {
    const rect = document.querySelector('section[aria-labelledby="gallery-s7-press"] .qa-button').getBoundingClientRect();
    return rect.top > 0 && rect.bottom < window.innerHeight;
  }, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const anchor = await page.evaluate(() => {
    const rect = document.querySelector('section[aria-labelledby="gallery-s7-press"] .qa-button').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.touchscreen.touchStart(anchor.x, anchor.y);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.touchscreen.touchEnd();
  await page.waitForSelector('.qa-press-menu', { visible: true, timeout: 5000 });
  const items = await page.evaluate(() => [...document.querySelectorAll('.qa-press-item')].map((b) => b.textContent.trim()));
  assert(items.length === 3 && items.some((t) => t.includes('删除')), 'Gallery 长按演示菜单条目异常', JSON.stringify(items));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-press-menu'), { timeout: 5000 });

  // 示例台词卡
  await page.evaluate(() => {
    [...document.querySelectorAll('section[aria-labelledby="gallery-s7-press"] .qa-button')]
      .find((b) => b.textContent.includes('生成示例台词卡'))?.click();
  });
  await page.waitForFunction(() => document.querySelector('.qa-share-preview')?.naturalWidth === 1080, { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-share-sheet'), { timeout: 5000 });

  assert(page.__qaErrors.length === 0, 'Gallery S7 展区流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 会话整理：长按置顶 → 行标记与列表首位；免打扰标记；标签随态翻转。
async function conversationMarksAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/messages', '.msgs-conv--app .msgs-conv-main');
  const pressRow = async () => {
    const row = await page.$('.msgs-conv--app .msgs-conv-main');
    const rect = await row.boundingBox();
    await page.touchscreen.touchStart(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await page.touchscreen.touchEnd();
    await page.waitForSelector('.qa-press-menu', { visible: true, timeout: 5000 });
  };

  await pressRow();
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-press-item')].find((b) => b.textContent.includes('置顶对话'))?.click();
  });
  await page.waitForSelector('.msgs-marks [aria-label="已置顶"]', { timeout: 8000 });

  await pressRow();
  const flipped = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.qa-press-item')].map((b) => b.textContent.trim());
    [...document.querySelectorAll('.qa-press-item')].find((b) => b.textContent.includes('免打扰'))?.click();
    return labels;
  });
  assert(flipped.some((t) => t.includes('取消置顶')), '置顶后菜单标签未翻转', JSON.stringify(flipped));
  await page.waitForSelector('.msgs-marks [aria-label="已免打扰"]', { timeout: 8000 });
  await saveScreenshot(page, 'conversation-marks-390x844-light.png');

  // 排序稳定性：新建一段「更新时间更晚」的会话后，置顶的旧会话必须仍居首
  //（mark-only 不 bump updated_at + pinned 优先排序的组合验收）
  // 走产品自己的动线开一段新会话（今日 → 为你挑选 → 开聊）：
  // 新会话 updated_at 必然最新，检验 pinned 优先 + mark-only 不 bump 的组合
  await page.goto(`${base}/?app=1#/today`);
  await page.waitForSelector('.ah-pick', { visible: true, timeout: 10000 });
  await page.evaluate(() => document.querySelector('.ah-pick').click());
  await page.waitForFunction(() => location.hash.startsWith('#/chats/'), { timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 600)); // mock 350ms 落库
  await page.goto(`${base}/?app=1#/messages`);
  await page.waitForFunction(() => document.querySelectorAll('.msgs-conv--app').length >= 2, { timeout: 15000 });
  const firstRowPinned = await page.evaluate(() =>
    Boolean(document.querySelectorAll('.msgs-conv--app')[0].querySelector('[aria-label="已置顶"]')));
  assert(firstRowPinned, '有更新会话出现后，置顶会话未能保持列表首位');

  assert(page.__qaErrors.length === 0, '会话整理流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 会话草稿：输入落库（300ms 防抖）→ 列表「[草稿]」优先预览 →
// 回会话恢复 → 清空即删。
async function draftAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/messages', '.msgs-conv--app .msgs-conv-main');
  await page.evaluate(() => document.querySelector('.msgs-conv--app .msgs-conv-main').click());
  await page.waitForSelector('textarea', { visible: true, timeout: 10000 });
  await page.type('textarea', 'E2E 草稿样本');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('huanyu_draft_')), { timeout: 5000 });

  await page.goto(`${base}/?app=1#/messages`);
  await page.waitForSelector('.msgs-draft', { timeout: 10000 });
  const preview = await page.$eval('.msgs-conv-tx span', (el) => el.textContent);
  assert(preview.includes('草稿') && preview.includes('E2E 草稿样本'), '会话行草稿预览异常', preview);

  await page.evaluate(() => document.querySelector('.msgs-conv--app .msgs-conv-main').click());
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('E2E 草稿样本'), { timeout: 8000 });
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith('huanyu_draft_')), { timeout: 5000 });

  assert(page.__qaErrors.length === 0, '会话草稿流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 深色与 lite 巡检：S7 新面在暗色下渲染、lite 下守住去 blur 契约。
async function s7DarkTierAssertions(browser, base) {
  const dark = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'dark',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });
  await visit(dark, '/today', '.qa-weekly');
  const darkState = await dark.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bars: document.querySelectorAll('.qa-weekly-bar').length,
    streak: Boolean(document.querySelector('.qa-streak')),
  }));
  assert(darkState.theme === 'dark' && darkState.bars === 7 && darkState.streak,
    '深色今日页 S7 面渲染异常', JSON.stringify(darkState));
  await dark.evaluate(() => { document.querySelector('.qa-weekly').scrollIntoView({ block: 'center' }); });
  await saveScreenshot(dark, 'weekly-recap-390x844-dark.png');
  await visit(dark, '/achievements', '.qa-ach-wall');
  assert(await dark.evaluate(() => document.querySelectorAll('.qa-ach-ring').length === 5),
    '深色成就徽章墙五环缺失');
  assert(dark.__qaErrors.length === 0, '深色巡检产生了预期外的浏览器错误', dark.__qaErrors.join('\n'));
  await dark.close();

  const lite = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'lite',
    viewport: { width: 390, height: 844 },
  });
  await visit(lite, '/today', '.qa-weekly');
  const liteBlur = await lite.evaluate(() => {
    const card = document.querySelector('.qa-weekly-card');
    const style = getComputedStyle(card);
    return style.backdropFilter || style.webkitBackdropFilter || '';
  });
  assert(liteBlur === 'none' || liteBlur === '', 'lite 档周报卡必须去 blur 回落实底', liteBlur);
  assert(lite.__qaErrors.length === 0, 'lite 巡检产生了预期外的浏览器错误', lite.__qaErrors.join('\n'));
  await lite.close();
}

// S7-G10 · 新面收口巡检：新功能 Sheet / 相伴一览 / 足迹卡 / 排行榜名次 /
// 搜索热门分类 / 触感开关 —— G10 后半新增面的存在性与语义。
async function g10SurfaceAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  // 我的页：相伴一览三格 + 新功能 Sheet
  await visit(page, '/me', '.qa-glance');
  const glance = await page.evaluate(() => ({
    cells: document.querySelectorAll('.qa-glance-cell').length,
    ring: Boolean(document.querySelector('.qa-glance-ring')),
  }));
  assert(glance.cells >= 2 && glance.ring, '相伴一览三格或完成环缺失', JSON.stringify(glance));
  await page.evaluate(() => {
    [...document.querySelectorAll('.pf-foot .qa-button')].find((b) => b.textContent.includes('新功能'))?.click();
  });
  await page.waitForSelector('.qa-whatsnew', { visible: true, timeout: 5000 });
  assert(await page.evaluate(() => document.querySelectorAll('.qa-whatsnew-row').length >= 8),
    '新功能 Sheet 条目不足');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-whatsnew'), { timeout: 5000 });

  // 角色页：与 TA 的足迹（演示账号与薇尔有会话）
  await visit(page, '/messages', '.msgs-conv--app .msgs-conv-main');
  await page.evaluate(() => {
    document.querySelector('.msgs-conv--app .msgs-conv-main')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 }));
  });
  await page.waitForSelector('.qa-press-menu', { visible: true, timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-press-item')].find((b) => b.textContent.includes('查看角色'))?.click();
  });
  await page.waitForSelector('.qa-bond', { timeout: 8000 });
  assert(await page.evaluate(() => /继续这段故事/.test(document.querySelector('.qa-bond').textContent)),
    '足迹卡缺少续聊 CTA');

  // 排行榜：创作者榜我的名次行
  await visit(page, '/leaderboard', '.qa-leaderboard-tabs');
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-leaderboard-tabs .qa-button')].find((b) => b.textContent.includes('创作者榜'))?.click();
  });
  await page.waitForSelector('.qa-lb-mine', { timeout: 8000 });
  assert(await page.evaluate(() => /第 \d+ 名/.test(document.querySelector('.qa-lb-mine').textContent)),
    '我的名次行缺少排位数字');

  // 搜索：热门分类 chips 直达角色搜索
  await visit(page, '/search', '.qa-search-cats .tag-chip');
  await page.evaluate(() => document.querySelector('.qa-search-cats .tag-chip').click());
  await page.waitForFunction(() => Boolean(document.querySelector('.qa-search-results, .qa-search-empty, .qa-search-loading')), { timeout: 8000 });

  // 设置：触感开关 App 专属行存在且默认开
  await visit(page, '/settings', '.qa-settings-root, .settings, .page');
  await page.evaluate(() => {
    const prefEntry = [...document.querySelectorAll('button, a')].find((el) => /偏好/.test(el.textContent));
    prefEntry?.click();
  });
  await page.waitForSelector('.qa-haptics-row input', { timeout: 8000 });
  assert(await page.evaluate(() => document.querySelector('.qa-haptics-row input').checked),
    '触感开关默认应为开');

  assert(page.__qaErrors.length === 0, 'G10 新面巡检产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G10 · 新面收口巡检 B：公告 NEW 一次性、抽卡晒卡全流、收藏筛选规则、
// 画廊长按（有作品才验，空态即验空态）。
async function g10SurfaceBAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  // 公告 NEW：首次见到标 NEW，本次浏览即记已读——重访必须消失
  await visit(page, '/announcements', '.qa-announcements-item, .qa-announcements-empty');
  const firstVisit = await page.evaluate(() => ({
    items: document.querySelectorAll('.qa-announcements-item').length,
    fresh: document.querySelectorAll('.qa-ann-new').length,
  }));
  if (firstVisit.items > 0) {
    assert(firstVisit.fresh > 0, '全新账号首次进入公告页应看到 NEW 徽标', JSON.stringify(firstVisit));
    // 按真实动线折返（SPA 导航）：回今日再进公告，NEW 必须消失
    await page.evaluate(() => { location.hash = '#/today'; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await page.evaluate(() => { location.hash = '#/announcements'; });
    await page.waitForSelector('.qa-announcements-item', { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert(await page.evaluate(() => document.querySelectorAll('.qa-ann-new').length === 0),
      '折返公告页后 NEW 徽标必须消失');
  }

  // 抽卡 → 结果 → 晒出这张卡 → 1080×1440（走真实抽取流；演示账号钻石充足）
  await visit(page, '/gacha', '.qa-gacha-draw');
  await page.click('.qa-gacha-draw');
  await page.waitForSelector('.qa-gacha-result-card', { visible: true, timeout: 20000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-gacha-result-actions .qa-button')].find((b) => b.textContent.includes('晒出这张卡'))?.click();
  });
  await page.waitForFunction(() => document.querySelector('.qa-share-preview')?.naturalWidth === 1080, { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-share-sheet'), { timeout: 5000 });

  // 收藏筛选规则一致性：chips 出现当且仅当分类 ≥2；出现则支持切换与空档说明
  await visit(page, '/favorites', '.page');
  await page.waitForFunction(() => !document.querySelector('.skel'), { timeout: 10000 }).catch(() => {});
  const favChips = await page.evaluate(() => document.querySelectorAll('.qa-fav-cats .qa-button').length);
  if (favChips > 0) {
    assert(favChips >= 3, '筛选行出现时至少包含「全部 + 两个分类」', String(favChips));
    await page.evaluate(() => document.querySelectorAll('.qa-fav-cats .qa-button')[1].click());
    await page.waitForFunction(() => document.querySelectorAll('.char-card').length > 0
      || document.body.innerText.includes('该分类下暂无收藏'), { timeout: 5000 });
  }

  assert(page.__qaErrors.length === 0, 'G10 新面巡检 B 产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G6 · 分享卡：角色页菜单入口 → canvas 合成 1080×1440 预览 → 出口可用
// → 关闭回焦。canvas 文字反锯齿跨环境不稳，不建像素基线，只验尺寸与无错。
async function shareCardAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/character/1', '.cvx-top');
  await page.evaluate(() => {
    [...document.querySelectorAll('.cvx-top .qa-icon-button')]
      .find((b) => b.getAttribute('aria-label') === '更多' || b.getAttribute('aria-controls') === 'cvx-action-menu')
      ?.click();
  });
  await page.waitForSelector('#cvx-action-menu', { visible: true, timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('#cvx-action-menu .qa-button')]
      .find((b) => b.textContent.includes('生成分享卡'))?.click();
  });
  await page.waitForSelector('.qa-share-sheet', { visible: true, timeout: 8000 });
  await page.waitForSelector('.qa-share-preview', { visible: true, timeout: 15000 });
  const card = await page.evaluate(() => {
    const img = document.querySelector('.qa-share-preview');
    const acts = [...document.querySelectorAll('.qa-share-acts .qa-button')];
    return {
      w: img?.naturalWidth,
      h: img?.naturalHeight,
      blobSrc: (img?.src || '').startsWith('blob:'),
      shareEnabled: acts.some((b) => b.textContent.includes('系统分享') && !b.disabled),
      saveEnabled: acts.some((b) => b.textContent.includes('保存图片') && !b.disabled),
    };
  });
  assert(card.w === 1080 && card.h === 1440 && card.blobSrc && card.shareEnabled && card.saveEnabled,
    '分享卡合成或出口异常', JSON.stringify(card));
  await saveScreenshot(page, 'share-card-390x844-light.png');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-share-sheet'), { timeout: 5000 });

  assert(page.__qaErrors.length === 0, '分享卡流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G5 · 成就 2.0：徽章墙五环数值一致 → 稀有度三档并存 → 荣誉条目无领取钮
// → 领取一次性庆祝后金币上涨 → reduced-motion 下庆祝归零。
async function achievementsAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/achievements', '.qa-ach-wall');
  const wall = await page.evaluate(() => {
    const rings = [...document.querySelectorAll('.qa-ach-ring')];
    const ringsOk = rings.length === 5 && rings.every((ring) => {
      const now = Number(ring.getAttribute('aria-valuenow'));
      const [done, total] = ring.querySelector('b').textContent.split('/').map((n) => Number(n));
      return Number.isFinite(now) && total > 0
        && Math.abs(now - Math.round((done / total) * 100)) <= 1;
    });
    const medals = new Set([...document.querySelectorAll('.qa-achievements-card')]
      .map((card) => card.getAttribute('data-medal')));
    const honor = document.querySelector('.qa-achievements-card[data-honor]');
    return {
      ringsOk,
      medalTiers: [...medals].sort().join(','),
      honorPresent: Boolean(honor),
      honorHasClaim: Boolean(honor?.querySelector('.qa-button.qa-button--primary')),
      honorBadge: honor?.querySelector('.qa-ach-honor-badge')?.textContent || '',
    };
  });
  assert(wall.ringsOk, '徽章墙五环数值与分类完成度不一致', JSON.stringify(wall));
  assert(wall.medalTiers === 'bronze,gold,silver', '稀有度三档未同时呈现', wall.medalTiers);
  assert(wall.honorPresent && !wall.honorHasClaim && wall.honorBadge.includes('荣誉'),
    '荣誉成就的拒领语义缺失', JSON.stringify(wall));
  await saveScreenshot(page, 'achievements-wall-390x844-light.png');

  const hasClaimable = await page.evaluate(() => Boolean(document.querySelector('.qa-achievements-card .qa-button.qa-button--primary')));
  if (hasClaimable) {
    const goldBefore = await page.evaluate(() => {
      try {
        const db = JSON.parse(localStorage.getItem('huanyu_db_v7') || '{}');
        return (db.users || []).find((u) => u.id === 1)?.gold || 0;
      } catch { return 0; }
    });
    await page.evaluate(() => {
      [...document.querySelectorAll('.qa-achievements-card')]
        .find((card) => card.querySelector('.qa-button.qa-button--primary'))
        ?.querySelector('.qa-button.qa-button--primary')?.click();
    });
    await page.waitForSelector('.qa-ach-claimfx', { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('.qa-ach-claimfx'), { timeout: 5000 });
    await page.waitForFunction((prev) => {
      try {
        const db = JSON.parse(localStorage.getItem('huanyu_db_v7') || '{}');
        return ((db.users || []).find((u) => u.id === 1)?.gold || 0) > prev;
      } catch { return false; }
    }, { timeout: 8000 }, goldBefore);
  }

  assert(page.__qaErrors.length === 0, '成就 2.0 流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();

  // 减弱动效：领取庆祝动画必须归零
  const rmPage = await preparePage(browser, base, {
    app: true, token: true, theme: 'light', perf: 'auto', reducedMotion: true,
  });
  await rmPage.goto(`${base}/?app=1#/achievements`, { waitUntil: 'networkidle0', timeout: 30000 });
  await rmPage.waitForSelector('.qa-achievements-card', { visible: true, timeout: 8000 });
  const rmFx = await rmPage.evaluate(() => {
    const card = document.querySelector('.qa-achievements-card');
    card.classList.add('qa-ach-claimfx');
    return getComputedStyle(card).animationDuration;
  });
  assert(rmFx === '0s', '减弱动效下领取庆祝仍有动画', rmFx);
  await rmPage.close();
}

// S7-G4 · 今日签到仪式：streak 周点 → 签到成功转 done + 点亮 → 日历 sheet
// 数据一致 → 「完成每日签到」任务行内领取 → 金币上涨。
async function todayRitualAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });

  await visit(page, '/today', '.qa-streak');
  const before = await page.evaluate(() => ({
    dots: document.querySelectorAll('.qa-streak-dot').length,
    lit: document.querySelectorAll('.qa-streak-dot.on').length,
    checkinReady: Boolean(document.querySelector('.ah-checkin:not(.done)')),
  }));
  assert(before.dots === 7 && before.checkinReady,
    '今日页连签周视图初始状态异常', JSON.stringify(before));

  await page.click('.ah-checkin');
  await page.waitForSelector('.ah-checkin.done', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('.qa-streak-dot.on').length === 1, { timeout: 5000 });
  await saveScreenshot(page, 'today-ritual-390x844-light.png');

  // 「完成每日签到」任务即时转可领：行内领取 → 金币上涨
  await page.waitForSelector('.qa-task-claim', { timeout: 8000 });
  const goldBefore = await page.evaluate(() => {
    const text = document.querySelector('.ah-coin .ah-balance-value')?.textContent || '0';
    return Number(text.replace(/[^0-9]/g, ''));
  });
  await page.click('.qa-task-claim');
  await page.waitForFunction((prev) => {
    const text = document.querySelector('.ah-coin .ah-balance-value')?.textContent || '0';
    return Number(text.replace(/[^0-9]/g, '')) > prev;
  }, { timeout: 8000 }, goldBefore);

  // 日历 sheet：隔离契约 + 今日格与签到日一致
  await page.click('.qa-streak');
  await appModalAssertions(page, '.qa-cal', 'check-in calendar sheet');
  const calendar = await page.evaluate(() => ({
    headers: document.querySelectorAll('.qa-cal-wd').length,
    todayOn: Boolean(document.querySelector('.qa-cal-cell.on.today')),
    month: document.querySelector('.qa-cal-month')?.textContent || '',
    nextDisabled: [...document.querySelectorAll('.qa-cal-nav .qa-icon-button')]
      .some((button) => button.disabled && button.getAttribute('aria-label') === '下一月'),
    horizon: document.querySelector('.qa-cal-horizon')?.textContent || '',
  }));
  assert(calendar.headers === 7 && calendar.todayOn && /^\d{4}-\d{2}$/.test(calendar.month) && calendar.nextDisabled,
    '签到日历网格状态异常', JSON.stringify(calendar));
  assert(/距 \d+ 天里程碑还差 \d+ 天/.test(calendar.horizon), '里程碑地平线缺失或格式异常', calendar.horizon);
  await saveScreenshot(page, 'checkin-calendar-390x844-light.png');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.qa-cal'), { timeout: 5000 });

  assert(page.__qaErrors.length === 0, '签到仪式流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();
}

// S7-G3 · 首启引导：新账号首启弹出 → 逐屏前进 → 选兴趣 → 完成写键持久化；
// 二次进入不再弹；老账号静默补键零打扰。
async function onboardingAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
    onboard: false,
  });

  await page.goto(`${base}/?app=1#/today`, { waitUntil: 'networkidle0', timeout: 30000 });
  await appModalAssertions(page, '.qa-onboard', 'onboarding dialog');
  await saveScreenshot(page, 'onboarding-world-390x844-light.png');

  const clickAct = (label) => page.evaluate((text) => {
    const target = [...document.querySelectorAll('.qa-onboard-acts .qa-button')]
      .find((button) => button.textContent.includes(text));
    target?.click();
    return Boolean(target);
  }, label);

  assert(await clickAct('继续'), '首启引导第一屏缺少「继续」');
  await page.waitForFunction(() => document.querySelectorAll('.qa-onboard-dot')[1]?.classList.contains('on')
    && document.querySelectorAll('.qa-onboard-screen')[1]?.getAttribute('aria-hidden') === 'false', { timeout: 3000 });
  assert(await clickAct('继续'), '首启引导第二屏缺少「继续」');
  await page.waitForSelector('.qa-onboard-chips .qa-button', { visible: true, timeout: 5000 });

  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.qa-onboard-chips .qa-button')];
    chips[0]?.click(); chips[2]?.click();
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.qa-onboard-chips .qa-button[data-selected]').length === 2,
    { timeout: 3000 },
  );
  // pager 位移 380ms：等第三屏真正滑到位再截图
  await page.waitForFunction(() => {
    const track = document.querySelector('.qa-onboard-track');
    if (!track) return false;
    const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
    return Math.abs(Math.abs(m.m41) - track.getBoundingClientRect().width * 2) < 2;
  }, { timeout: 3000 });
  await saveScreenshot(page, 'onboarding-tune-390x844-light.png');

  assert(await clickAct('选好了'), '第三屏缺少完成按钮');
  await page.waitForFunction(() => !document.querySelector('.qa-onboard'), { timeout: 8000 });
  // mock 的 save() 有 350ms 合并落盘防抖：兴趣画像以轮询等待其真正写入 localStorage
  await page.waitForFunction(() => {
    try {
      const db = JSON.parse(localStorage.getItem('huanyu_db_v7') || '{}');
      const interests = (db.settings || []).find((s) => s.user_id === 1)?.interests || '';
      return Boolean(localStorage.getItem('huanyu_onboard_done'))
        && Boolean(localStorage.getItem('huanyu_welcome_seen'))
        && interests.split(',').filter(Boolean).length === 2;
    } catch { return false; }
  }, { timeout: 5000 });

  // 二次进入不再弹
  await page.goto(`${base}/?app=1#/today`, { waitUntil: 'networkidle0', timeout: 30000 });
  await settlePage(page);
  assert(await page.evaluate(() => !document.querySelector('.qa-onboard')), '完成后的二次进入仍弹出引导');

  // 老账号：无键但 created_at 久远 → 静默补键，不弹。
  // 注入必须在「旧页 pagehide 落盘之后、新页应用启动之前」执行——
  // evaluateOnNewDocument 恰在该窗口运行（页内 evaluate 会被落盘覆盖）。
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem('huanyu_onboard_done');
      const db = JSON.parse(localStorage.getItem('huanyu_db_v7') || '{}');
      const me = (db.users || []).find((u) => u.id === 1);
      if (me) { me.created_at = '2020-01-01 00:00:00'; localStorage.setItem('huanyu_db_v7', JSON.stringify(db)); }
    } catch { /* */ }
  });
  await page.goto(`${base}/?app=1#/today`, { waitUntil: 'networkidle0', timeout: 30000 });
  await settlePage(page);
  await page.waitForFunction(() => Boolean(localStorage.getItem('huanyu_onboard_done')), { timeout: 8000 });
  assert(await page.evaluate(() => !document.querySelector('.qa-onboard')), '老账号被误弹引导');

  assert(page.__qaErrors.length === 0, '首启引导流产生了预期外的浏览器错误', page.__qaErrors.join('\n'));
  await page.close();

  // 减弱动效变体：pager 不做位移过渡
  const rmPage = await preparePage(browser, base, {
    app: true, token: true, theme: 'light', perf: 'auto', reducedMotion: true, onboard: false,
  });
  await rmPage.goto(`${base}/?app=1#/today`, { waitUntil: 'networkidle0', timeout: 30000 });
  await rmPage.waitForSelector('.qa-onboard', { visible: true, timeout: 8000 });
  const rmTrack = await rmPage.$eval('.qa-onboard-track', (el) => getComputedStyle(el).transitionDuration);
  assert(rmTrack === '0s', '减弱动效下引导 pager 仍保留位移过渡', rmTrack);
  await rmPage.close();
}

// S7-G2 · Insights 首载失败 → AppErrorState 恢复出口（ORACLE §7.2）。
// 静态构建的 /api 由页内 mock fetch 直接合成响应，CDP 拦截看不到——
// 用访问器包装 mock 安装的 fetch，按开关注入 /me/insights 断网。
async function insightsRecoveryAssertions(browser, base) {
  const page = await preparePage(browser, base, {
    app: true,
    token: true,
    theme: 'light',
    perf: 'auto',
    viewport: { width: 390, height: 844 },
  });
  await page.evaluateOnNewDocument(() => {
    window.__qaFailInsights = true;
    let real = window.fetch;
    const wrapped = (...args) => {
      const url = String(args[0] || '');
      if (window.__qaFailInsights && url.includes('/me/insights')) {
        return Promise.reject(new TypeError('模拟星轨服务中断'));
      }
      return real(...args);
    };
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get() { return wrapped; },
      set(fn) { real = fn; },
    });
  });

  await visit(page, '/insights', '.qa-error-state');
  const errorState = await page.evaluate(() => ({
    role: document.querySelector('.qa-error-state')?.getAttribute('role'),
    title: document.querySelector('.qa-error-state__title')?.textContent || '',
    art: Boolean(document.querySelector('.qa-error-state .qa5-empty-art')),
    retry: [...document.querySelectorAll('.qa-error-state .qa-button')]
      .some((button) => button.textContent.includes('重试')),
  }));
  assert(errorState.role === 'alert' && errorState.retry && errorState.art
    && errorState.title.includes('星轨'),
  'Insights 首载失败未给出带插画的可恢复错误态', JSON.stringify(errorState));
  await saveScreenshot(page, 'insights-error-390x844-light.png');

  await page.evaluate(() => { window.__qaFailInsights = false; });
  await page.evaluate(() => {
    [...document.querySelectorAll('.qa-error-state .qa-button')]
      .find((button) => button.textContent.includes('重试'))?.click();
  });
  await page.waitForSelector('.ins-kpis', { visible: true, timeout: 20000 });
  const recovered = await page.evaluate(() => ({
    error: Boolean(document.querySelector('.qa-error-state')),
    kpis: document.querySelectorAll('.ins-kpi').length,
  }));
  assert(!recovered.error && recovered.kpis > 0,
    'Insights 重试后未恢复正常内容', JSON.stringify(recovered));
  await saveScreenshot(page, 'insights-recovered-390x844-light.png');
  const unexpected = page.__qaErrors.filter((message) => !message.includes('星轨') && !message.includes('insights'));
  assert(unexpected.length === 0, 'Insights 恢复流产生了预期外的浏览器错误', unexpected.join('\n'));
  await page.close();
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await startStaticServer();
  let browser;
  try {
    const executablePath = await resolveChrome();
    console.log(`Quiet Aqua browser: ${executablePath}`);
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'],
    });

    if (WALLET_ONLY) {
      await walletAssertions(browser, base);
      console.log(`✓ wallet and recharge: ${OUT}`);
      return;
    }

    if (DETAIL_ROUTES_ONLY) {
      await detailRouteAssertions(browser, base);
      await scriptRouteAssertions(browser, base);
      await worldbookEditorAssertions(browser, base);
      await detailErrorStateAssertions(browser, base);
      await insightsRecoveryAssertions(browser, base);
      console.log(`✓ detail routes and error states: ${OUT}`);
      return;
    }

    const matrix = [
      { width: 360, height: 800, theme: 'light', perf: 'auto', expectedPerf: 'balanced' },
      { width: 390, height: 844, theme: 'light', perf: 'auto', expectedPerf: 'balanced' },
      { width: 412, height: 915, theme: 'light', perf: 'auto', expectedPerf: 'balanced' },
      { width: 390, height: 844, theme: 'dark', perf: 'auto', expectedPerf: 'balanced' },
      { width: 390, height: 844, theme: 'light', perf: 'lite', expectedPerf: 'lite' },
    ];
    for (const scenario of matrix) {
      const page = await preparePage(browser, base, {
        theme: scenario.theme,
        perf: scenario.perf,
        viewport: { width: scenario.width, height: scenario.height },
      });
      await visit(page, '/app-controls', '.qa-gallery');
      await galleryAssertions(page, scenario.expectedPerf);
      await dockAndOverlayAssertions(page, scenario.expectedPerf);
      assert(page.__qaErrors.length === 0, '浏览器控制台出现错误', page.__qaErrors.join('\n'));
      await page.close();
      console.log(`✓ ${scenario.width}x${scenario.height} ${scenario.theme} ${scenario.expectedPerf}`);
    }

    const reduced = await preparePage(browser, base, { reducedMotion: true });
    await visit(reduced, '/app-controls', '.qa-gallery');
    const motion = await reduced.$eval('.qa-button', (button) => getComputedStyle(button).transitionDuration);
    assert(motion === '0s' || motion === '0.00001s', 'reduced-motion 未关闭状态过渡', motion);
    await reduced.close();

    await integrationAssertions(browser, base);
    await characterEditorAssertions(browser, base);
    await detailRouteAssertions(browser, base);
    await scriptRouteAssertions(browser, base);
    await worldbookEditorAssertions(browser, base);
    await detailErrorStateAssertions(browser, base);
    await insightsRecoveryAssertions(browser, base);
    await onboardingAssertions(browser, base);
    await todayRitualAssertions(browser, base);
    await achievementsAssertions(browser, base);
    await shareCardAssertions(browser, base);
    await pressMenuAssertions(browser, base);
    await weeklyRecapAssertions(browser, base);
    await walletCalendarAssertions(browser, base);
    await quoteCardAssertions(browser, base);
    await galleryS7Assertions(browser, base);
    await conversationMarksAssertions(browser, base);
    await draftAssertions(browser, base);
    await s7DarkTierAssertions(browser, base);
    await g10SurfaceAssertions(browser, base);
    await g10SurfaceBAssertions(browser, base);
    await captureCoreScreens(browser, base, 'light');
    await captureCoreScreens(browser, base, 'dark');
    console.log(`✓ screenshots: ${OUT}`);
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

run().catch((error) => {
  console.error(`Quiet Aqua E2E failed:\n${error.stack || error}`);
  process.exitCode = 1;
});
