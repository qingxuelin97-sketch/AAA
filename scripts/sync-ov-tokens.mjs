#!/usr/bin/env node
/*
 * 叠印 Overprint · 令牌孪生同步
 *
 * 冻结原件 docs/design/overprint/design-tokens.css 是 :root 作用域的设计交付件；
 * 运行时孪生 client/src/styles/app-ov-tokens.css 必须与它逐字节相同，唯一差异
 * 是把 :root 改写成 App 围栏 html[data-app="1"]。client/app-test.mjs 会做反向改
 * 写并断言两者相等，所以孪生**必须由本脚本生成，不要手抄**。
 *
 *   node scripts/sync-ov-tokens.mjs           写入孪生
 *   node scripts/sync-ov-tokens.mjs --check   只校验，不写（CI 用）
 */
import { readFile, writeFile } from 'node:fs/promises';

const FROZEN = new URL('../docs/design/overprint/design-tokens.css', import.meta.url);
const TWIN = new URL('../client/src/styles/app-ov-tokens.css', import.meta.url);

/** 冻结原件 → 运行时孪生。与 app-test.mjs 的反向改写严格互逆。 */
export function fenceOverprintTokens(frozen) {
  return frozen
    .replaceAll(':root[data-theme="dark"]', 'html[data-app="1"][data-theme="dark"]')
    .replaceAll(':root[data-surface="immersive"]', 'html[data-app="1"][data-surface="immersive"]')
    .replaceAll(':root[data-perf="lite"]', 'html[data-app="1"][data-perf="lite"]')
    .replace(/:root(\s*\{)/g, 'html[data-app="1"]$1');
}

const frozen = await readFile(FROZEN, 'utf8');
const fenced = fenceOverprintTokens(frozen);

if (process.argv.includes('--check')) {
  const current = await readFile(TWIN, 'utf8').catch(() => null);
  if (current !== fenced) {
    console.error('叠印令牌孪生已过期：请运行 node scripts/sync-ov-tokens.mjs');
    process.exit(1);
  }
  console.log('叠印令牌孪生与冻结件一致');
} else {
  await writeFile(TWIN, fenced);
  console.log('已写入 client/src/styles/app-ov-tokens.css');
}
