// IX native resource renderer.
//
// App empty states, onboarding scenes, and milestone stamps are now shipped as
// reviewed light/dark SVGs in client/src/assets/illos. This script intentionally
// does not recreate the retired raster catalog. Use --native when Capacitor
// resources need to be refreshed.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESOURCE_DIR = join(ROOT, 'resources');
const CANVAS = '#E8EBE9';
const INK = '#0F1312';

const mark = ({ scale = 1, stroke = INK, moon = INK } = {}) => `
  <g transform="scale(${scale})">
    <mask id="ix-crescent">
      <rect width="320" height="320" fill="#ffffff"/>
      <circle cx="222" cy="100" r="46" fill="#000000"/>
    </mask>
    <circle cx="160" cy="160" r="118" fill="none" stroke="${stroke}" stroke-width="22"/>
    <circle cx="188" cy="124" r="54" fill="${moon}" mask="url(#ix-crescent)"/>
  </g>`;

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const NATIVE_JOBS = [
  {
    id: 'icon-background',
    body: `<rect width="1024" height="1024" fill="${CANVAS}"/>`,
  },
  {
    id: 'icon-foreground',
    body: `<g transform="translate(224 224)">${mark({ scale: 1.8, stroke: INK, moon: INK })}</g>`,
  },
  {
    id: 'icon-only',
    body: `<rect width="1024" height="1024" fill="${CANVAS}"/><g transform="translate(224 224)">${mark({ scale: 1.8 })}</g>`,
  },
  {
    id: 'logo',
    body: `<rect width="1024" height="1024" fill="${CANVAS}"/><g transform="translate(224 224)">${mark({ scale: 1.8, stroke: INK, moon: INK })}</g>`,
  },
];

if (!process.argv.includes('--native')) {
  console.log('IX SVG media is source-of-truth; no legacy App PNGs are rendered. Use --native for Capacitor resources.');
  process.exit(0);
}

await mkdir(RESOURCE_DIR, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });

for (const job of NATIVE_JOBS) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(1024, 1024, job.body)}</body></html>`);
  const body = await page.screenshot({ omitBackground: true });
  await writeFile(join(RESOURCE_DIR, `${job.id}.png`), body);
  console.log(`${job.id}.png ${(body.length / 1024).toFixed(1)}KB`);
}

await browser.close();
console.log('native IX resources written');
