// S7-G8 · qa→lg 令牌一次性 codemod（入库留档，幂等可重跑）。
// 纯别名判定：某 --qa-* 名字在 shim 的全部定义点（base/dark/lite）都恒等于
// 同一 `var(--lg-X)` 时才可机械改名；任何字面值 / color-mix / calc / 条件
// 重映射（如 lite 下 --qa-chrome→grouped）一律保留在残余 shim。
// 用法：node scripts/migrate-qa-tokens.mjs [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHIM = join(ROOT, 'client/src/styles/app-quiet-aqua-tokens.css');
const TARGETS = [
  'client/src/styles/app-pages-quiet-aqua.css',
  'client/src/styles/app-controls.css',
  'client/src/styles/app-hig-v5.css',
  'client/src/styles/app-experience-v3.css',
  'client/src/styles/app-runtime.css',
  'client/src/styles/app-elevated.css',
  'client/src/styles/app-lumen-s3.css',
  'client/src/styles/app-lumen-s4.css',
  'client/src/styles/app-lumen-s5.css',
  'client/src/styles/app-lumen-s6.css',
  'client/src/styles/app-shell.css',
  'client/src/styles/app-renov.css',
  'client/src/styles/app-motion.css',
  'client/src/chat/chat-app.css',
  'client/src/ui.jsx',
].map((p) => join(ROOT, p));

const DRY = process.argv.includes('--dry');

const shim = await readFile(SHIM, 'utf8');
const defs = new Map(); // name -> Set(values)
for (const [, name, value] of shim.matchAll(/(--qa-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  if (!defs.has(name)) defs.set(name, new Set());
  defs.get(name).add(value.trim());
}

const pure = new Map(); // qa name -> lg target
for (const [name, values] of defs) {
  if (values.size !== 1) continue;
  const only = [...values][0];
  const m = only.match(/^var\((--lg-[a-z0-9-]+)\)$/);
  if (m) pure.set(name, m[1]);
}

console.log(`pure aliases: ${pure.size} / defined: ${defs.size}`);
const names = [...pure.keys()].sort((a, b) => b.length - a.length);

let total = 0;
for (const file of TARGETS) {
  let src;
  try { src = await readFile(file, 'utf8'); } catch { continue; }
  let out = src;
  let count = 0;
  for (const name of names) {
    const target = pure.get(name);
    const re = new RegExp(`var\\(\\s*${name}\\s*([,)])`, 'g');
    out = out.replace(re, (_, delim) => { count += 1; return `var(${target}${delim}`; });
  }
  if (count > 0) {
    total += count;
    console.log(`${file.replace(ROOT + '/', '')}: ${count}`);
    if (!DRY) await writeFile(file, out);
  }
}
console.log(`total replaced: ${total}${DRY ? ' (dry run, nothing written)' : ''}`);
