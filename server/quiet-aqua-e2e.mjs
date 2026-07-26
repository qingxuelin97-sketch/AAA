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
    localStorage.setItem('huanyu_theme', config.theme);
    localStorage.setItem('huanyu_accent', config.accent);
    localStorage.setItem('huanyu_perf', config.perf);
    if (config.app) localStorage.setItem('huanyu_app', '1');
    else localStorage.removeItem('huanyu_app');
    if (config.token) localStorage.setItem('huanyu_token', 'tok.1');
    else localStorage.removeItem('huanyu_token');
  }, { app, token, theme, accent, perf });
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
      storyClearsDock: !storyRect || !navRect || storyRect.bottom <= navRect.top + 1,
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
    injectedStates: document.querySelectorAll('[data-selected], [data-loading], [aria-busy="true"]').length,
    copy: document.querySelector('.auth-card .muted')?.textContent || '',
  }));
  assert(webResult.app === '0', 'Web guard 未退出 App 模式', JSON.stringify(webResult));
  assert(webResult.qaClasses === 0 && webResult.wrappers === 0 && webResult.injectedStates === 0, 'Web 被 Quiet Aqua DOM 污染', JSON.stringify(webResult));
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
