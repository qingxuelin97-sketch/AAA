import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourceDir = path.join(root, 'docs', 'ui-reference', 'pink-v1', 'source');
const outputDir = path.join(root, 'client', 'public', 'app-pink-v1', 'baked');
const baselineDir = path.join(root, 'docs', 'ui-reference', 'pink-v1', 'baseline');
const WIDTH = 390;
const HEIGHT = 844;

const screens = {
  today: {
    source: 'today-source.png',
    parts: [
      ['header', 0, 126],
      ['hero', 126, 511],
      ['companions-task', 511, 771],
      ['dock', 771, 844],
    ],
  },
  discover: {
    source: 'discover-source.png',
    parts: [
      ['header', 0, 88],
      ['story', 88, 548],
      ['actions-copy', 548, 760],
      ['dock', 760, 844],
    ],
  },
  messages: {
    source: 'messages-source.png',
    parts: [
      ['header-entry', 0, 273],
      ['conversations', 273, 708],
      ['waiting-banner', 708, 771],
      ['dock', 771, 844],
    ],
  },
  profile: {
    source: 'profile-source.png',
    parts: [
      ['identity', 0, 219],
      ['benefits', 219, 486],
      ['characters-settings', 486, 780],
      ['dock', 780, 844],
    ],
  },
};

// Standalone raster glyphs for future dynamic/interactive overlays. The first
// round keeps the reviewed full partition as the visible source, while these
// crops guarantee that the light App never has to fall back to SVG/Lucide when
// a glyph needs to be moved out of a partition.
const iconSpecs = {
  today: [
    ['search', 282, 39, 44, 44], ['notification', 332, 39, 44, 44],
    ['tab-today', 8, 772, 68, 72], ['tab-discover', 83, 772, 68, 72],
    ['tab-create', 161, 770, 68, 74], ['tab-messages', 239, 772, 68, 72], ['tab-profile', 314, 772, 68, 72],
  ],
  discover: [
    ['search', 341, 34, 42, 46], ['heart', 330, 390, 52, 60], ['comment', 330, 462, 52, 60],
    ['favorite', 330, 532, 52, 60], ['share', 330, 600, 52, 60], ['voice', 320, 699, 60, 60],
    ['tab-today', 18, 761, 66, 83], ['tab-discover', 91, 761, 66, 83],
    ['tab-create', 164, 760, 66, 84], ['tab-messages', 237, 761, 66, 83], ['tab-profile', 310, 761, 66, 83],
  ],
  messages: [
    ['search', 337, 36, 44, 44], ['interactions', 42, 156, 72, 72],
    ['friends', 159, 156, 72, 72], ['groups', 276, 156, 72, 72],
    ['tab-today', 8, 772, 68, 72], ['tab-discover', 83, 772, 68, 72],
    ['tab-create', 161, 770, 68, 74], ['tab-messages', 239, 772, 68, 72], ['tab-profile', 314, 772, 68, 72],
  ],
  profile: [
    ['notification', 298, 23, 44, 44], ['settings', 344, 23, 44, 44],
    ['coin', 30, 334, 54, 54], ['diamond', 149, 334, 54, 54], ['wallet', 269, 334, 54, 54],
    ['achievements', 31, 408, 55, 55], ['orbit', 105, 408, 55, 55], ['events', 179, 408, 55, 55],
    ['gacha', 253, 408, 55, 55], ['favorites', 327, 408, 55, 55],
    ['tab-today', 8, 781, 68, 63], ['tab-discover', 83, 781, 68, 63],
    ['tab-create', 161, 780, 68, 64], ['tab-messages', 239, 781, 68, 63], ['tab-profile', 314, 781, 68, 63],
  ],
};

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writePng(file, png) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = PNG.sync.write(png, { colorType: 6, inputColorType: 6 });
  fs.writeFileSync(file, buffer);
  return sha256(buffer);
}

function sample(png, x, y, channel) {
  const cx = Math.max(0, Math.min(png.width - 1, x));
  const cy = Math.max(0, Math.min(png.height - 1, y));
  return png.data[(cy * png.width + cx) * 4 + channel];
}

function resizeBilinear(source, width, height) {
  const target = new PNG({ width, height, colorType: 6 });
  for (let y = 0; y < height; y += 1) {
    const sy = (y + 0.5) * source.height / height - 0.5;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1;
    const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = (x + 0.5) * source.width / width - 0.5;
      const x0 = Math.floor(sx);
      const x1 = x0 + 1;
      const fx = sx - x0;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const a = sample(source, x0, y0, channel) * (1 - fx) + sample(source, x1, y0, channel) * fx;
        const b = sample(source, x0, y1, channel) * (1 - fx) + sample(source, x1, y1, channel) * fx;
        target.data[offset + channel] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return target;
}

function crop(source, x, y, width, height) {
  const target = new PNG({ width, height, colorType: 6 });
  PNG.bitblt(source, target, x, y, width, height, 0, 0);
  return target;
}

const manifest = { version: 'pink-v1', width: WIDTH, height: HEIGHT, screens: {}, generated_art: {}, icons: {} };
const artDir = path.join(root, 'client', 'public', 'app-pink-v1', 'art');
if (fs.existsSync(artDir)) {
  for (const file of fs.readdirSync(artDir).filter(name => name.endsWith('.png')).sort()) {
    const artPath = path.join(artDir, file);
    // Image generators commonly emit opaque RGB PNGs. Normalize every source
    // to RGBA so downstream compositing can introduce transparency without a
    // format conversion and the asset contract stays uniform.
    manifest.generated_art[file] = { sha256: writePng(artPath, readPng(artPath)), color_type: 6 };
  }
}
for (const [screen, spec] of Object.entries(screens)) {
  const sourcePath = path.join(sourceDir, spec.source);
  const source = readPng(sourcePath);
  const canonical = resizeBilinear(source, WIDTH, HEIGHT);
  const baselineSha256 = writePng(path.join(baselineDir, `${screen}-390x844.png`), canonical);
  manifest.screens[screen] = {
    source: spec.source,
    source_sha256: sha256(fs.readFileSync(sourcePath)),
    baseline: `${screen}-390x844.png`,
    baseline_sha256: baselineSha256,
    parts: [],
  };
  spec.parts.forEach(([name, top, bottom], index) => {
    const filename = `${String(index + 1).padStart(2, '0')}-${name}.png`;
    const partSha256 = writePng(path.join(outputDir, screen, filename), crop(canonical, 0, top, WIDTH, bottom - top));
    manifest.screens[screen].parts.push({ name, file: `${screen}/${filename}`, top, height: bottom - top, sha256: partSha256 });
  });
  manifest.icons[screen] = [];
  for (const [name, x, y, width, height] of iconSpecs[screen]) {
    const filename = `${name}.png`;
    const iconPath = path.join(root, 'client', 'public', 'app-pink-v1', 'icons', screen, filename);
    const iconSha256 = writePng(iconPath, crop(canonical, x, y, width, height));
    manifest.icons[screen].push({ name, file: `icons/${screen}/${filename}`, x, y, width, height, sha256: iconSha256 });
  }
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Baked ${Object.keys(screens).length} reference screens at ${WIDTH}x${HEIGHT}.`);
