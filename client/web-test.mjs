// Web invariants — Lumen Web 层的静态守卫（对偶于 app-test.mjs 的 App 守卫）。
// 纯 Node 静态断言：读源码字符串做不变量检查，不跑浏览器。
// 保护的契约（web: W1-W6 大更新引入）：
//   1. 围栏：web-lumen-*.css 的每条规则都从 html:not([data-app="1"]) 开始，
//      Web 层永远不可能改写 App 壳的任何样式（反向的 App 围栏由 app-test 保护）。
//   2. 令牌：--lg-* 引用必须可解析；核心值字面锁定（防漂移）；
//      accent 契约（rose/clay 无块 = 基线契约）。
//   3. 材质纪律：backdrop-filter 只允许出现在 chrome/浮层允许名单；新增
//      keyframes 一律 lgw 前缀且与存量 160+ 同名 keyframes 零交集；无限循环
//      动画只允许 loading/骨架。
//   4. 结构：路由分流、控件三态 dispatch、CSS 按模式分包、性能自适应去门。
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';

let passed = 0;
const tally = (fn) => {
  const wrapped = (...args) => { fn(...args); passed++; };
  return wrapped;
};
const ok = tally(assert.ok.bind(assert));
const match = tally(assert.match.bind(assert));
const doesNotMatch = tally(assert.doesNotMatch.bind(assert));

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

/* ---- 待检文件 ---- */
const styleDir = new URL('./src/styles/', import.meta.url);
const lumenWebFiles = (await readdir(styleDir)).filter(f => f.startsWith('web-lumen-') && f.endsWith('.css')).sort();
ok(lumenWebFiles.includes('web-lumen-tokens.css') && lumenWebFiles.includes('web-lumen-bridge.css') && lumenWebFiles.includes('web-lumen-materials.css'),
  'the Lumen Web foundation trio (tokens / bridge / materials) must exist');
const css = {};
for (const f of lumenWebFiles) css[f] = await read(`./src/styles/${f}`);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* ---- 1. 围栏完整性：每条顶层选择器都从 html:not([data-app="1"]) 开始 ---- */
const FENCE = 'html:not([data-app="1"])';
function checkFence(name, source) {
  const text = stripComments(source);
  let depth = 0;
  let atRuleDepth = -1; // depth inside a non-conditional at-rule body (@keyframes/@font-face)
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const sel = buf.trim();
      buf = '';
      if (sel.startsWith('@')) {
        // conditional group rules keep requiring fenced selectors inside;
        // @keyframes bodies use % / from / to selectors — skip their contents.
        if (/^@(keyframes|-webkit-keyframes|font-face|property|counter-style)/.test(sel)) atRuleDepth = depth;
      } else if (atRuleDepth === -1 && sel) {
        // 按括号深度拆逗号：:is(a, b) 里的逗号不是选择器列表分隔符
        const parts = [];
        let cur = '', paren = 0;
        for (const c of sel) {
          if (c === '(') paren++;
          else if (c === ')') paren--;
          if (c === ',' && paren === 0) { parts.push(cur); cur = ''; } else cur += c;
        }
        parts.push(cur);
        for (const part of parts) {
          const p = part.trim();
          ok(p.startsWith(FENCE) || p.startsWith('@'),
            `${name}: selector "${p.slice(0, 80)}" must start with ${FENCE}`);
        }
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (atRuleDepth !== -1 && depth <= atRuleDepth) atRuleDepth = -1;
      buf = '';
    } else if (ch === ';') {
      buf = '';
    } else {
      buf += ch;
    }
  }
}
for (const f of lumenWebFiles) checkFence(f, css[f]);

/* ---- 2. 令牌解析：全部 var(--lg*) 引用都能在 tokens 文件内解析 ---- */
const tokensCss = css['web-lumen-tokens.css'];
const defined = new Set([...tokensCss.matchAll(/(--lgw?-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
for (const f of lumenWebFiles) {
  for (const m of stripComments(css[f]).matchAll(/var\((--lgw?-[a-z0-9-]+)/g)) {
    ok(defined.has(m[1]), `${f}: var(${m[1]}) must resolve in web-lumen-tokens.css`);
  }
}

/* ---- 3. 核心令牌值字面锁定（防漂移） ---- */
for (const decl of [
  '--lg-canvas: #EDEFF6;', '--lg-canvas: #0A0C12;',
  '--lg-ink: #12151E;', '--lg-ink: #F2F4F9;',
  '--lg-act: oklch(.52 .17 278);', '--lg-act: oklch(.78 .13 278);',
  '--lg-glass-1: rgb(255 255 255 / 58%);', '--lg-glass-2: rgb(255 255 255 / 78%);',
  '--lg-glass-3: rgb(250 251 255 / 60%);',
  '--lg-blur: blur(26px) saturate(170%);', '--lg-blur: blur(28px) saturate(150%);',
]) {
  ok(tokensCss.includes(decl), `web tokens must carry the locked value verbatim: "${decl}"`);
}

/* ---- 4. Web 强调色齐全；IX App 使用独立色板 ---- */
for (const id of ['teal', 'dusk', 'forest', 'amber']) {
  const webLine = tokensCss.match(new RegExp(`html:not\\(\\[data-app="1"\\]\\)\\[data-accent="${id}"\\]\\s*\\{([^}]+)\\}`));
  ok(webLine, `Web accent "${id}" must define its token block`);
}
doesNotMatch(tokensCss, /data-accent="rose"/, 'rose is a content semantic — it must fall back to the iris baseline (no block)');
doesNotMatch(tokensCss, /data-accent="clay"/, 'clay is the unset baseline (no attribute is stamped) — a block would be dead code hiding drift');

/* ---- 5. 深色 / lite / reduced-motion 变体契约 ---- */
match(tokensCss, /html:not\(\[data-app="1"\]\)\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark/, 'the dark block must flip color-scheme');
match(tokensCss, /\[data-perf="lite"\]\s*\{[^}]*--lg-blur:\s*none/s, 'the lite tier must zero the glass blur');
match(tokensCss, /\[data-glass="off"\]\s*\{[^}]*--lg-blur:\s*none/s, 'the user glass toggle must also zero the blur');
match(tokensCss, /prefers-reduced-motion[\s\S]*--lg-dur-press: 0ms;[\s\S]*--lg-dur-entity: 0ms;/, 'reduced-motion must zero all six duration tokens');

/* ---- 6. 桥接层关键映射；衬线体系不桥接 ---- */
const bridge = css['web-lumen-bridge.css'];
for (const pair of [['--bg', '--lg-canvas'], ['--text', '--lg-ink'], ['--muted', '--lg-ink-2'], ['--accent', '--lg-act'], ['--gold', '--lg-gold'], ['--diamond', '--lg-dia'], ['--ok', '--lg-jade'], ['--danger', '--lg-coral']]) {
  match(bridge, new RegExp(`${pair[0]}: var\\(${pair[1]}\\)`), `bridge must redirect ${pair[0]} → ${pair[1]}`);
}
doesNotMatch(bridge, /--serif\s*:|--sans\s*:/, 'the web serif/sans stack (Fraunces + Noto Serif SC) is a web asset — never bridge it away');

/* ---- 7. keyframes：lgw 前缀 + 与存量名零交集 ---- */
const legacyCss = (await read('./src/styles/base.css')) + (await read('./src/styles/web-modules.css'))
  + (await read('./src/styles/web-super.css')) + (await read('./src/styles/perf-atelier.css'));
const legacyKf = new Set([...legacyCss.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map(m => m[1]));
for (const f of lumenWebFiles) {
  for (const m of css[f].matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)) {
    ok(/^lgw/i.test(m[1]), `${f}: @keyframes "${m[1]}" must carry the lgw prefix`);
    ok(!legacyKf.has(m[1]), `${f}: @keyframes "${m[1]}" must not collide with a legacy animation (source-order override hazard)`);
  }
}

/* ---- 8. 无限循环动画白名单（loading / 骨架 shimmer 之外零容忍） ---- */
const INFINITE_ALLOW = /spin|shimmer|skel|loading|pulse-dot/i;
for (const f of lumenWebFiles) {
  for (const m of stripComments(css[f]).matchAll(/animation[^;]*infinite[^;]*;/g)) {
    ok(INFINITE_ALLOW.test(m[0]), `${f}: infinite animation outside the loading/skeleton allowlist: "${m[0].slice(0, 80)}"`);
  }
}

/* ---- 9. backdrop-filter 允许名单：blur 只属于 chrome 与浮层 ---- */
const BF_ALLOW = /sidebar|sb-peek|mobile-topbar|mnav|bottom-nav|cmdk|modal|welcome-pop|glass-chrome|glass-2|glass-3|chat-input|composer|sheet|backdrop|island|drawer|fd2-hist|lgwd-(panel|hist)|lgw-discover/i;
let bfCount = 0;
for (const f of lumenWebFiles) {
  const text = stripComments(css[f]);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of text.matchAll(re)) {
    const hasRealBlur = [...m[2].matchAll(/backdrop-filter\s*:\s*([^;]+)/g)]
      .some(d => d[1].trim() !== 'none');
    if (hasRealBlur) {
      bfCount++;
      ok(BF_ALLOW.test(m[1]), `${f}: backdrop-filter outside the chrome allowlist: "${m[1].trim().slice(0, 90)}"`);
    }
  }
}
ok(bfCount <= 48, `backdrop-filter rule count must stay bounded (got ${bfCount}) — glass belongs to chrome, not content`);

/* ---- 10. qa-* 类不得被 Web 层写样式（画廊脚手架在 controls 文件内豁免） ---- */
for (const f of lumenWebFiles) {
  if (f === 'web-lumen-controls.css') continue;
  doesNotMatch(css[f], /\.qa-[a-z-]+[^;{]*\{/, `${f}: Web layer must not style App qa-* classes`);
}

/* ---- 11. 路由与壳结构 ---- */
const appSource = await read('./src/App.jsx');
match(appSource, /path="\/discover" element=\{isAppMode\(\) \? <Navigate to="\/" replace \/> : P\(<DiscoverFeed \/>\)\}/, 'web /discover must render the immersive feed while App redirects home');
match(appSource, /path="\/today" element=\{isAppMode\(\) \? P\(<AppHome \/>\) : <Navigate to="\/" replace \/>\}/, 'web /today must redirect home (AppHome inside the web shell is a style collapse)');
match(appSource, /path="\/me" element=\{isAppMode\(\) \? P\(<AppProfile \/>\) : <Navigate to="\/profile" replace \/>\}/, 'web /me must redirect to the merged /profile');
match(appSource, /isAppMode\(\) \? <DiscoverFeed \/> : <WebHome \/>/, 'the web home route must render the WebHome dashboard');
match(appSource, /RouteErrorBoundary/, 'web routes must be wrapped in a per-route error boundary');
const layoutSource = await read('./src/components/Layout.jsx');
for (const to of ['/discover', '/messages', '/vip']) {
  ok(layoutSource.includes(`'${to}'`) || layoutSource.includes(`"${to}"`), `the web sidebar must link ${to}`);
}
const themeSource = await read('./src/theme.js');
// App 侧浅色启动色已随 P4 色缝修复统一到 #EFF8FD（= rainbow 页底渐变起点）；
// 本断言只守 Web 分支的 Lumen 画布值不动。
match(themeSource, /app \? '#0F1312' : '#0A0C12'[\s\S]*app \? '#EFF8FD' : '#EDEFF6'/,
  'the Web branch of the dual-shell meta theme-color must retain the Lumen canvas');
doesNotMatch(themeSource, /#f4f2ec|#15120e/, 'the retired warm meta colors must not linger');
const indexHtml = await read('../client/index.html');
match(indexHtml, /<meta name="theme-color" content="#EDEFF6" \/>/, 'index.html must boot on the Lumen canvas color');

/* ---- 12. 控件三态 dispatch 与涟漪豁免 ---- */
const controlsSource = await read('./src/components/AppControls.jsx');
match(controlsSource, /isWebChrome\(\)[\s\S]*'lgw-button'/, 'AppButton must render .lgw-* on the web shell');
match(controlsSource, /isWebChrome\(\)[\s\S]*'lgw-icon-button'/, 'AppIconButton must render .lgw-* on the web shell');
match(controlsSource, /<LegacyControl/, 'the LegacyControl escape hatch must survive');
const appmodeSource = await read('./src/appmode.js');
match(appmodeSource, /dataset\.lumenWeb = '1'/, 'appmode must stamp the removable data-lumen-web boot flag');
const fxSource = await read('./src/fx.js');
match(fxSource, /\.lgw-button, \.lgw-icon-button, \.lgw-tab-button/, 'fx ripples must skip Lumen Web controls');

/* ---- 13. 首页/沉浸流/Profile 功能契约 ---- */
const sharedHome = await read('./src/pages/home/shared.js');
match(sharedHome, /ALREADY_CHECKED_IN/, 'the shared check-in hook must keep the duplicate check-in contract');
match(sharedHome, /签到失败，请稍后重试/, 'the shared check-in hook must keep the failure copy');
const webHome = await read('./src/pages/WebHome.jsx');
match(webHome, /from '\.\/home\/shared\.js'/, 'WebHome must consume the shared home data layer');
const discoverSource = await read('./src/pages/DiscoverFeed.jsx');
match(discoverSource, /role="feed"|role=\{[^}]*'feed'/, 'the web immersive feed must expose feed semantics');
match(discoverSource, /ArrowDown/, 'the web immersive feed must support keyboard navigation');
const profileSource = await read('./src/pages/Profile.jsx');
const appProfileSource = await read('./src/pages/AppProfile.jsx');
ok(/components\/profile\//.test(profileSource) && /components\/profile\//.test(appProfileSource),
  'both shells must consume the shared profile modules (no re-fork)');

/* ---- 13b. 桌面去 App 化重布局契约（D1-D3） ---- */
match(webHome, /<Spotlight/, 'the web home must lead with the spotlight carousel (community-shelf shape)');
doesNotMatch(webHome, /lgwh-quick|每日任务/, 'the web home must stay de-gamified — no quick grid or task card creep-back');
match(layoutSource, /\/chat\/conversations/, 'the web sidebar must surface recent conversations (two-tier layout)');
const chatSource = await read('./src/pages/Chat.jsx');
match(chatSource, /chat-side/, 'web chat must dock the character panel at wide widths');

/* ---- 14. CSS 按模式分包 + 性能自适应 ---- */
const mainSource = await read('./src/main.jsx');
doesNotMatch(mainSource, /import '\.\/styles\/app-[a-z0-9-]+\.css'/, 'main.jsx must not statically import App-layer CSS');
match(mainSource, /import '\.\/styles\/web-lumen-tokens\.css';[\s\S]*import '\.\/styles\/web-lumen-bridge\.css';[\s\S]*import '\.\/styles\/web-lumen-materials\.css';/, 'the Lumen Web trio must load in token → bridge → material order');
const perfSource = await read('./src/perf.js');
doesNotMatch(perfSource, /if \(!isAppMode\(\) \|\| getPerfPref/, 'adaptive perf degradation must cover the web shell too');

// 运行时由 JS setProperty 写入的令牌集合：第 15 与第 16 条共用，只收集一次。
let runtimeSet = new Set();

/* ---- 15. 不得引用从未定义的自定义属性 ---- */
// 未定义的自定义属性在**计算期**失效：`background: var(--nope)` 不是「忽略这条声明」，
// 而是整条属性回落到初始值 —— background 变透明、border 塌成 0px none。
// 于是一个拼错的令牌名不会报错、不会警告，只会让一整块 UI 悄悄消失。
// 实际发生过：失败分型卡与对话内调试台写了 var(--bg-1) / var(--line)（正确的名字是
// --panel / --border），线上一直是「深色遮罩上飘着几行字、按钮没有描边」；
// 同期还有 var(--shadow-md)（正确的是 --shadow-lg）。三处都是肉眼可见的缺陷，
// 却躲过了当时的全部断言与像素比对（因为基线是带着 bug 一起录的）。
//
// 只查**没有 fallback** 的引用：`var(--x, 12px)` 是有意的可选令牌，不算问题。
// 运行时由 JS 写进行内样式的令牌（动画索引 --i / 坐标 --dx --dy / 玻璃配色
// --hy-cg-* 等）也不算 —— 它们本来就不该出现在样式表的定义位。
{
  // CSS 分散在三个目录，必须全扫 —— 只扫 styles/ 会把 chat/chat-app.css 里定义的
  // --hy-cg-* 误判成未定义。
  const cssDirs = ['./src/', './src/chat/', './src/styles/'];
  const defined = new Set();
  const usedWithoutFallback = new Map();
  for (const d of cssDirs) {
    const base = new URL(d, import.meta.url);
    const cssFiles = (await readdir(base)).filter((f) => f.endsWith('.css'));
    for (const f of cssFiles) {
      // 先剥注释：解释「这里曾经错写成 var(--bg-1)」的说明文字不该被当成真引用。
      const src = (await readFile(new URL(f, base), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) defined.add(m[1]);
      for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (!usedWithoutFallback.has(m[1])) usedWithoutFallback.set(m[1], new Set());
        usedWithoutFallback.get(m[1]).add(d.replace('./src/', '') + f);
      }
    }
  }
  // JS 在运行时 setProperty 的令牌：从源码里实测收集，不写死名单（免得清单腐烂）。
  const jsDirs = ['./src/', './src/components/', './src/pages/', './src/chat/'];
  for (const d of jsDirs) {
    const base = new URL(d, import.meta.url);
    let entries = [];
    try { entries = await readdir(base); } catch { continue; }
    for (const f of entries.filter((x) => /\.(js|jsx)$/.test(x))) {
      const src = await readFile(new URL(f, base), 'utf8');
      for (const m of src.matchAll(/['"`](--[\w-]+)['"`]/g)) runtimeSet.add(m[1]);
      for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) runtimeSet.add(m[1]);
    }
  }
  const dangling = [...usedWithoutFallback.keys()]
    .filter((k) => !defined.has(k) && !runtimeSet.has(k))
    .sort();
  ok(dangling.length === 0,
    `stylesheets must not reference undefined custom properties without a fallback (a typo silently renders the element transparent): ${dangling.map((k) => `${k} in ${[...usedWithoutFallback.get(k)].join('/')}`).join(', ')}`);
}

/* ---- 16. 令牌必须在**它所在的壳里**有定义（按壳分区） ---- */
// 第 15 条把全部 CSS 的定义汇成一个池，于是有一整类缺陷它天生看不见：
// 令牌确实「在某个文件里定义过」，但那个文件**在这个壳里根本不加载**。
//
// 双壳的加载链是不对称的：
//   · client/src/styles.css 的 @import 链 —— 两个壳都加载；
//   · client/src/styles/app-entry.js 的 import 链 —— 只有 App 壳（动态引入）。
// 而 app-shell / app-elevated / app-renov / app-motion 四个文件挂在**前者**，
// 也就是说它们在 Web 壳里也生效，可它们大量引用只在 app-entry 链里定义的 --ix-*。
// 未定义的自定义属性在计算期让整条声明回落到初始值 —— background 变透明、
// border 塌成 0px none，不报错不警告。这正是第 15 条给不出答案的那一类。
//
// 判定按「文件在哪个壳加载」× 「选择器在哪个壳能命中」求交：
//   选择器含 [data-app="1"] ⇒ 只在 App 命中；含 :not([data-app="1"]) ⇒ 只在 Web；
//   两者都没有 ⇒ 两壳都命中。定义与引用各自算一次，引用的壳位必须被定义的壳位盖住。
// 两条链都从源文件解析，不写死清单 —— 写死的清单迟早跟真实 import 顺序脱节。
{
  const APP = 1, WEB = 2, BOTH = APP | WEB;
  const shellName = (m) => (m === BOTH ? '两壳' : m === APP ? 'App 壳' : 'Web 壳');

  // —— 两条加载链：从源文件解析 ——
  // 两壳链其实有**两条**入口，第一版只解析了 styles.css 就把 web-lumen-* 全判成
  // 未定义 —— main.jsx 直接 import 的那九个 lumen 文件也是两壳都加载的。
  const stylesCss = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8');
  const mainJsx = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8');
  const entryJs = await readFile(new URL('./src/styles/app-entry.js', import.meta.url), 'utf8');
  const bothChain = [
    ...[...stylesCss.matchAll(/@import\s+'\.\/styles\/([\w-]+\.css)'/g)].map((m) => m[1]),
    ...[...mainJsx.matchAll(/^\s*import\s+'\.\/styles\/([\w-]+\.css)'/gm)].map((m) => m[1]),
  ];
  const appChain = [...entryJs.matchAll(/^\s*import\s+'\.(?:\/|\.\/chat\/)([\w/-]+\.css)'/gm)].map((m) => m[1].replace(/^\//, ''));
  ok(bothChain.length >= 15, `shell partition: 两壳加载链没解析全（拿到 ${bothChain.length} 个，应含 styles.css 的 8 个 + main.jsx 的 9 个 lumen）`);
  ok(bothChain.includes('web-lumen-tokens.css'), 'shell partition: main.jsx 直接 import 的 lumen 令牌文件必须算进两壳链');
  ok(appChain.length >= 12, `shell partition: app-entry.js 的 import 链没解析出来（拿到 ${appChain.length} 个）`);
  // 这四个文件挂在两壳链上却是 app-* 命名 —— 泄漏面的本体，钉住它免得悄悄挪走
  for (const f of ['app-shell.css', 'app-elevated.css', 'app-renov.css', 'app-motion.css']) {
    ok(bothChain.includes(f), `shell partition: ${f} 应当仍在 styles.css 链上（本条守卫的前提）`);
  }

  const fileMask = new Map();
  for (const f of bothChain) fileMask.set('styles/' + f, BOTH);
  for (const f of appChain) fileMask.set(f.includes('/') ? f : 'styles/' + f, APP);

  // —— 选择器上下文扫描：剥注释后按花括号配对，记住每处声明所在的选择器 ——
  // [data-theme="dark"] 也是 Web 专属，但不是靠 data-app 围栏 —— 是运行时不变量：
  // theme.js 的 resolveTheme() 在 App 壳里无条件返回 'light'，所以 App 的
  // <html> 上永远不会出现 data-theme="dark"。下面把这个前提**断言住**，
  // 免得哪天 App 重开深色而这里还在按「深色规则 App 命中不了」放行。
  const themeJs = await readFile(new URL('./src/theme.js', import.meta.url), 'utf8');
  ok(/if\s*\(\s*isAppMode\(\)\s*\)\s*return\s*'light'/.test(themeJs),
    'shell partition: theme.js 必须仍然让 App 壳恒定浅色 —— 第 16 条把 [data-theme="dark"] 当作 Web 专属正是基于这一条；App 重开深色时必须回来重算');
  const selMask = (sel) => {
    if (/:not\(\s*\[data-app="1"\]\s*\)/.test(sel)) return WEB;
    if (/\[data-app="1"\]/.test(sel)) return APP;
    if (/\[data-theme="dark"\]/.test(sel)) return WEB;
    return BOTH;
  };
  const scan = (src) => {
    const out = [];                        // { name, kind: 'def'|'use', mask }
    const ctx = [];
    let buf = '';
    let pos = 0;
    const marks = [];                      // [offset, maskAtThatPoint]
    while (pos < src.length) {
      const c = src[pos];
      if (c === '{') { ctx.push(buf.trim()); buf = ''; marks.push([pos, ctx.slice()]); }
      else if (c === '}') { ctx.pop(); buf = ''; marks.push([pos, ctx.slice()]); }
      else if (c === ';') buf = '';
      else buf += c;
      pos += 1;
    }
    const maskAt = (off) => {
      let cur = [];
      for (const [o, st] of marks) { if (o > off) break; cur = st; }
      let m = BOTH;
      for (const sel of cur) { if (sel.startsWith('@')) continue; m &= selMask(sel); }
      return m || BOTH;                     // 交出 0 说明选择器自相矛盾，按两壳保守处理
    };
    for (const m of src.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) out.push({ name: m[1], kind: 'def', mask: maskAt(m.index) });
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) out.push({ name: m[1], kind: 'use', mask: maskAt(m.index) });
    return out;
  };

  const defMask = new Map();
  const useMask = new Map();
  const useWhere = new Map();
  for (const [rel, fmask] of fileMask) {
    let src;
    try { src = await readFile(new URL('./src/' + rel, import.meta.url), 'utf8'); } catch { continue; }
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const it of scan(src)) {
      const m = it.mask & fmask;
      if (!m) continue;
      const bag = it.kind === 'def' ? defMask : useMask;
      bag.set(it.name, (bag.get(it.name) || 0) | m);
      if (it.kind === 'use') {
        // 记到「文件 → 壳位」而不是一个扁平集合：报错时只列**真的在缺失那个壳里**
        // 用到它的文件，否则会把 App 专属文件也列进 Web 壳的定位里，误导排查。
        if (!useWhere.has(it.name)) useWhere.set(it.name, new Map());
        const w = useWhere.get(it.name);
        w.set(rel, (w.get(rel) || 0) | m);
      }
    }
  }

  // 运行时由 JS 写进行内样式的令牌沿用第 15 条的口径（那一段已经实测收集过）
  const leaks = [];
  for (const [name, um] of useMask) {
    if (runtimeSet.has(name)) continue;
    const dm = defMask.get(name) || 0;
    const missing = um & ~dm;
    if (!missing) continue;
    const where = [...useWhere.get(name)].filter(([, fm]) => fm & missing).map(([f]) => f);
    leaks.push(`${name}（在${shellName(missing)}用到但那个壳里没定义：${where.slice(0, 3).join(' / ')}${where.length > 3 ? ` 等 ${where.length} 处` : ''}）`);
  }
  // —— 存量基线：只许减，不许增 ——
  // 这条守卫刚立起来时仓里有 6 笔存量泄漏，全部是双壳加载的 app-* 样式表引用了
  // App 专属链里定义的令牌。它们是真缺陷（对应声明在 Web 壳里静默回落到初始值），
  // 但不能靠一次提交全修完 —— 修法是把规则围到正确的壳里，属于逐页迁移的活。
  // 所以这里冻成基线：**新增一笔就报错**，存量随每一页的迁移逐条销账。
  // 销账时直接从这张表里删名字；表清空了就把这段和 KNOWN_LEAKS 一起删掉。
  const KNOWN_LEAKS = new Set([
    // app-shell.css 在无围栏选择器里读 --app-top（定义在 App 专属的 app-runtime.css）
    '--app-top',
    // app-elevated / app-renov 在无围栏选择器里读 --hy-spring（定义在 App 专属层）
    '--hy-spring',
    // app-renov 读 chat/chat-app.css 定义的玻璃配色四件套（同为 App 专属链）
    '--hy-cg-bg', '--hy-cg-blur', '--hy-cg-brd', '--hy-cg-sh',
  ]);
  const fresh = leaks.filter((l) => !KNOWN_LEAKS.has(l.slice(0, l.indexOf('（'))));
  const fixed = [...KNOWN_LEAKS].filter((n) => !leaks.some((l) => l.startsWith(n + '（')));
  ok(fresh.length === 0,
    `custom properties must be defined in EVERY shell that can reach them — a stylesheet loaded in both shells referencing a shell-exclusive token renders that declaration as its initial value (transparent background, collapsed border), silently: ${fresh.sort().join('; ')}`);
  ok(fixed.length === 0,
    `shell partition: 这些令牌已经不再泄漏，请从 KNOWN_LEAKS 里删掉（基线只许减，留着会让它慢慢变成一张免检名单）：${fixed.join(', ')}`);
}

console.log(`web invariants: ${passed}/${passed} passed`);
