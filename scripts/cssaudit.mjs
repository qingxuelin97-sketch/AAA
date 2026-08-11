// 级联判决普查（cssaudit）—— 「打架清除」工程的测量端。
//
// 用 CDP CSS.getMatchedStylesForNode 在 55 帧探测矩阵（11 路由 × 5 状态档，
// 与 scripts/appdiff.mjs 同一张网）上遍历每个元素，对每个属性算出实际获胜声明，
// 归因回源文件，产出三类证据：
//   1. 死规则：匹配过元素、但从未在任何元素任何属性上获胜 → 删除候选。
//      （从未匹配的规则不判死 —— 可能属于未探测到的动态面。）
//   2. 非承重 !important：把它模拟降级后每一处获胜元素上的胜者都不变 → 摘除候选。
//   3. 打架对：降级后胜者变成另一条声明 → 记录谁在压谁，供定向删除前代。
//
// ⚠ 报告有效期 = 生成它的那棵源码树。任何一批删除落地后，报告立即过期 ——
// 同值遮蔽链（A 赢，B 同值垫后，C 异值再后）里删掉 A 是零像素的，但报告里
// B 仍标「从未获胜」；拿旧报告再删 B，C 就浮出来了（P1 批次 B 实翻过这个车：
// 设置行 56px 的三连遮蔽，删到第三层露出 68px）。每批删除之间必须重跑本工具。
//
// 用法：npm run audit:css（普通压缩构建 + 普查）
//   ⚠ 必须在**与发布完全相同的压缩构建**上普查。曾用 --minify false 求归因方便，
//   结果压缩器的规则合并/去重会改变级联 —— 同一棵树两种构建的设置页差 6 万像素，
//   普查在未压缩世界判的「从未获胜」在压缩世界里是承重的（P1 批次 B 实翻车）。
//   压缩产物的选择器用 normSel() 规范化后与源链对齐；合并产物对不上号则记未归因
//   （保守：未归因规则永不进候选）。
// 输出：client/cssaudit.tmp/report.json（不入库）+ 终端汇总表。
//
// 已知保守面（宁可漏报不误报）：
//   · :hover/:active/:focus 等交互态规则平时不进 matched 列表 → 永远不会成为候选；
//   · 归因失败（offset 对不上）的规则整条跳过并计数；
//   · 简写/全写冲突用静态展开表对齐（background ↔ background-image 等）。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'client/cssaudit.tmp');
const SRC = join(ROOT, 'client/src');

/* ── 1. 源文件解析：递归解 import 链，得到「链 → 有序 (file, rule)」 ── */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
// 压缩器会去掉组合器/逗号旁空白、把 ::before 缩成 :before、去掉可省的属性引号。
// 两侧选择器都过这个规范化再比对。
const normSel = (s) => s.replace(/\s+/g, ' ')
  .replace(/\s*([,>+~])\s*/g, '$1')
  .replace(/::/g, ':')
  .replace(/\[([-\w]+)([~^$*|]?=)["']?([^"'\]]*)["']?\]/g, '[$1$2$3]')
  .trim();
function parseRules(text, file) {
  // 括号深度游走；@media/@supports 递归进 body；@keyframes/@font-face 整块跳过。
  const rules = [];
  const walk = (start, end, media) => {
    let i = start;
    while (i < end) {
      const brace = text.indexOf('{', i);
      if (brace === -1 || brace >= end) break;
      const header = text.slice(i, brace).trim();
      // 找配对的 }
      let depth = 1, j = brace + 1;
      while (j < end && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const bodyEnd = j - 1;
      if (/^@(media|supports|container)/.test(header)) walk(brace + 1, bodyEnd, header);
      else if (header.startsWith('@')) { /* keyframes/font-face/import：跳过 */ }
      else if (header) {
        rules.push({ file, selector: header.replace(/\s+/g, ' '), media: media || null, bodyStart: brace + 1, line: text.slice(0, brace).split('\n').length });
      }
      i = j;
    }
  };
  walk(0, text.length, null);
  return rules;
}
async function loadChain(entry) {
  // entry: css（解 @import）或 js（解 import './x.css'）
  const files = [];
  const visit = async (p) => {
    const text = await readFile(p, 'utf8');
    if (p.endsWith('.js')) {
      for (const m of text.matchAll(/import\s+'([^']+\.css)'/g)) await visit(resolve(dirname(p), m[1]));
      return;
    }
    for (const m of text.matchAll(/@import\s+'([^']+)';/g)) await visit(resolve(dirname(p), m[1]));
    files.push({ path: p, text: stripComments(text) });
  };
  await visit(entry);
  return files;
}

/* ── 2. 简写 → 覆盖键集合（冲突判定用；不求全，求常用面） ── */
const SHORTHANDS = {
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-clip', 'background-origin'],
  border: ['border-width', 'border-style', 'border-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
};
const keysOf = (name) => SHORTHANDS[name] || [name];

/* ── 3. 探测矩阵（与 appdiff 同网） ── */
const ROUTES = ['#/today', '#/', '#/messages', '#/chats/1', '#/me', '#/wallet', '#/achievements', '#/events', '#/insights', '#/settings', '#/app-controls'];
const MODES = [
  { name: 'light', pref: 'high' },
  { name: 'balanced', pref: null, cores: 8 },
  { name: 'lite', pref: 'lite' },
  { name: 'glassoff', pref: 'high', extra: { huanyu_glass: '0' } },
  { name: 'accentdusk', pref: 'high', extra: { huanyu_accent: 'dusk' } },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg' };
const serve = () => new Promise((r) => {
  const s = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    try { const b = await readFile(join(DIST, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { try { const b = await readFile(join(DIST, 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); } catch { res.writeHead(404); res.end(); } }
  });
  s.listen(4277, () => r(s));
});

/* ── 4. 主流程 ── */
const chains = [await loadChain(join(SRC, 'styles.css')), await loadChain(join(SRC, 'styles/app-entry.js'))];
const chainRules = chains.map((files) => files.flatMap((f) => parseRules(f.text, f.path.slice(ROOT.length + 1))));
for (const r of chainRules.flat()) r.nsel = normSel(r.selector);

// 规则全集登记表：key = file + ' ' + line
const ledger = new Map();
for (const r of chainRules.flat()) ledger.set(r.file + ' ' + r.line, { ...r, matched: 0, won: 0, wonImp: 0, impDecls: new Map() });

const QUICK = !!process.env.CSSAUDIT_QUICK;
if (QUICK) { MODES.length = 1; ROUTES.length = 1; }
const srv = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let unattributed = 0, attributed = 0;
const fighters = new Map();   // '压者 → 被压者' 对：key = winnerKey + ' >> ' + loserKey + ' [' + prop + ']'

for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript((m) => {
    try {
      localStorage.setItem('huanyu_app', '1');
      localStorage.setItem('huanyu_welcome_seen', new Date().toISOString().slice(0, 10));
      localStorage.setItem('huanyu_onboard_done', new Date().toISOString().slice(0, 10));
      localStorage.setItem('huanyu_token', 'tok.1');
      if (m.pref) localStorage.setItem('huanyu_perf', m.pref); else localStorage.removeItem('huanyu_perf');
      for (const [k, v] of Object.entries(m.extra || {})) localStorage.setItem(k, v);
    } catch { /* */ }
    if (m.cores) {
      try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => m.cores, configurable: true }); } catch { /* */ }
      try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); } catch { /* */ }
    }
  }, mode);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const sheets = new Map();   // styleSheetId → { map: Map(bodyStartOffset → ledgerKey), lineStarts }
  const pendingSheets = [];
  cdp.on('CSS.styleSheetAdded', ({ header }) => { pendingSheets.push(onSheet(header)); });
  async function onSheet(header) {
    if (header.origin !== 'regular' || !header.sourceURL) return;
    try {
      const { text } = await cdp.send('CSS.getStyleSheetText', { styleSheetId: header.styleSheetId });
      const parsed = parseRules(stripComments(text), '');
      for (const r of parsed) r.nsel = normSel(r.selector);   // 预计算，别在 O(n²) 循环里跑正则
      // 与两条链逐一对齐：按选择器序列前向匹配，取命中率高的链
      let best = null;
      for (const chain of chainRules) {
        const map = new Map(); let ci = 0, hit = 0;
        for (const r of parsed) {
          // 可恢复搜索：miss 不吞指针（否则一条对不上会让后面整链失配）
          let j = ci;
          while (j < chain.length && chain[j].nsel !== r.nsel) j++;
          if (j < chain.length) { map.set(r.bodyStart, chain[j].file + ' ' + chain[j].line); hit++; ci = j + 1; }
        }
        if (!best || hit > best.hit) best = { map, hit, total: parsed.length, chainLen: chain.length };
      }
      // 分母用链长：index 主包会混入其它入口的 CSS（实测 5343 条里只有 4432 条
      // 属于 styles 链且全部命中）——用产物规则数当分母会把正确对齐拒之门外。
      const denom = Math.min(best?.total || 0, best?.chainLen || 0);
      console.log(`  sheet ${header.styleSheetId} parsed=${best?.total} hit=${best?.hit} chainLen=${best?.chainLen}`);
      if (best && denom && best.hit / denom > 0.9) {
        // CDP SourceRange 只有行/列，没有绝对偏移 —— 建行首索引表换算
        const lineStarts = [0];
        for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
        sheets.set(header.styleSheetId, { map: best.map, lineStarts });
      }
    } catch { /* sheet 已卸载等 */ }
  }
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');

  for (const route of ROUTES) {
    await page.goto(`http://127.0.0.1:4277/?app=1${route}`);
    await page.waitForTimeout(2000);
    await Promise.all(pendingSheets);   // sheet 归因表建完再遍历节点
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const nodeIds = [];
    (function walk(n) { if (n.nodeType === 1) nodeIds.push(n.nodeId); (n.children || []).forEach(walk); })(root);
    for (const nodeId of nodeIds) {
      let ms; try { ms = await cdp.send('CSS.getMatchedStylesForNode', { nodeId }); } catch { continue; }
      const groups = [{ matched: ms.matchedCSSRules || [], inline: ms.inlineStyle }];
      for (const pe of ms.pseudoElements || []) groups.push({ matched: pe.matches || [], inline: null });
      for (const g of groups) {
        // 收集声明（升序 = 级联优先级升序）
        const decls = [];
        g.matched.forEach((m, i) => {
          if (m.rule.origin !== 'regular') return;
          const sheet = sheets.get(m.rule.style.styleSheetId);
          const rg = m.rule.style.range;
          const key = (sheet && rg) ? sheet.map.get(sheet.lineStarts[rg.startLine] + rg.startColumn) : undefined;
          const ledgerRule = key ? ledger.get(key) : null;
          if (key) { attributed++; if (ledgerRule) ledgerRule.matched++; } else unattributed++;
          for (const p of m.rule.style.cssProperties) {
            if (!p.name || p.value == null || p.disabled || p.parsedOk === false) continue;
            if (!p.text) continue;   // 展开产物（longhand 派生）跳过，只记原文声明
            decls.push({ i, imp: !!p.important, name: p.name, keys: keysOf(p.name), key, ledgerRule });
          }
        });
        const inlineKeys = new Set((g.inline?.cssProperties || []).filter((p) => p.text && !p.disabled).flatMap((p) => keysOf(p.name)));
        // 每个覆盖键：最后一个非 important 与最后一个 important
        const byKey = new Map();
        for (const d of decls) for (const k of d.keys) {
          const slot = byKey.get(k) || {};
          if (d.imp) slot.imp = d; else slot.norm = d;
          byKey.set(k, slot);
        }
        for (const [k, slot] of byKey) {
          const winner = slot.imp || (inlineKeys.has(k) ? null : slot.norm);
          if (!winner || !winner.ledgerRule) continue;
          winner.ledgerRule.won++;
          if (winner.imp) {
            winner.ledgerRule.wonImp++;
            // 模拟降级：没有 important 时的胜者
            const alt = inlineKeys.has(k) ? { key: 'inline' } : slot.norm;
            const rec = winner.ledgerRule.impDecls.get(winner.name) || { won: 0, loadBearing: 0 };
            rec.won++;
            if (alt && alt !== winner && alt.i > winner.i) {
              rec.loadBearing++;
              const loser = alt.key ? (ledger.get(alt.key) ? `${ledger.get(alt.key).file}:${ledger.get(alt.key).line}` : 'inline') : 'inline';
              const fk = `${winner.ledgerRule.file}:${winner.ledgerRule.line} [${winner.name}] >> ${loser}`;
              fighters.set(fk, (fighters.get(fk) || 0) + 1);
            }
            winner.ledgerRule.impDecls.set(winner.name, rec);
          }
        }
      }
    }
  }
  await ctx.close();
}
await browser.close();
srv.close();

/* ── 5. 汇总 ── */
const INTERACTIVE = /:(hover|active|focus|target|checked)|\.open\b|\.active\b|\[aria-|\[data-(?!app|theme|perf|glass|accent|tone|compact)/;
const perFile = new Map();
for (const r of ledger.values()) {
  const f = perFile.get(r.file) || { rules: 0, matched: 0, dead: [], strippable: [], loadBearing: [] };
  f.rules++;
  if (r.matched) f.matched++;
  const safe = !INTERACTIVE.test(r.selector) && !r.media;
  if (r.matched && !r.won && safe) f.dead.push({ line: r.line, selector: r.selector.slice(0, 120) });
  for (const [prop, rec] of r.impDecls) {
    if (rec.loadBearing === 0 && safe) f.strippable.push({ line: r.line, prop, selector: r.selector.slice(0, 80) });
    else if (rec.loadBearing > 0) f.loadBearing.push({ line: r.line, prop, hits: rec.loadBearing });
  }
  perFile.set(r.file, f);
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'report.json'), JSON.stringify({
  attributed, unattributed,
  files: Object.fromEntries([...perFile].sort()),
  fighters: [...fighters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200),
}, null, 1));
console.log(`归因 ${attributed} / 未归因 ${unattributed}`);
console.log('file'.padEnd(44), 'rules matched dead strip loadB');
for (const [file, f] of [...perFile].sort((a, b) => b[1].dead.length + b[1].strippable.length - a[1].dead.length - a[1].strippable.length)) {
  if (!file.includes('app') && !file.includes('chat')) continue;
  console.log(file.padEnd(44), String(f.rules).padStart(5), String(f.matched).padStart(7), String(f.dead.length).padStart(4), String(f.strippable.length).padStart(5), String(f.loadBearing.length).padStart(5));
}
console.log(`报告 → ${join(OUT, 'report.json')}`);
