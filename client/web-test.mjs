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
match(themeSource, /app \? '#0F1312' : '#0A0C12'[\s\S]*app \? '#E4F1F6' : '#EDEFF6'/,
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
  const runtimeSet = new Set();
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

console.log(`web invariants: ${passed}/${passed} passed`);
