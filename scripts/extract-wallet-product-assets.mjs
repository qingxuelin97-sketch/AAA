import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.resolve(process.cwd());
const sourcePath = path.join(root, 'docs', 'ui-oracle', 'wallet-deep-pages-reference-v4.png');
const outputDir = path.join(root, 'client', 'src', 'assets', 'wallet-products');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
fs.mkdirSync(outputDir, { recursive: true });

// The source is a reviewed four-screen board. These six crops isolate only the
// product illustration from the recharge cards; text, selection chrome and
// navigation never enter the runtime asset.
const centers = [
  [540, 190], [718, 190],
  [540, 340], [718, 340],
  [540, 492], [718, 492],
];
const width = 104;
const height = 86;

for (let index = 0; index < centers.length; index += 1) {
  const [cx, cy] = centers[index];
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.max(0, Math.round(cx - width / 2 + x)));
      const sy = Math.min(source.height - 1, Math.max(0, Math.round(cy - height / 2 + y)));
      const si = (sy * source.width + sx) * 4;
      const oi = (y * width + x) * 4;
      const r = source.data[si];
      const g = source.data[si + 1];
      const b = source.data[si + 2];
      const nearPaper = Math.min(r, g, b) > 190 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
      out.data[oi] = r;
      out.data[oi + 1] = g;
      out.data[oi + 2] = b;
      out.data[oi + 3] = nearPaper ? 0 : 255;
    }
  }
  const name = `${['60', '300', '680', '1280', '3280', '6480'][index]}.png`;
  fs.writeFileSync(path.join(outputDir, name), PNG.sync.write(out));
}

// Currency marks are taken from the reviewed wallet ledger, where they already
// sit on a neutral surface. Keeping these as small transparent PNGs preserves
// the illustrated material and highlight language that does not survive a
// simplified path trace.
const currencyMarks = [
  { name: 'diamond-currency.png', cx: 52, cy: 506 },
  { name: 'coin-currency.png', cx: 52, cy: 570 },
];

for (const mark of currencyMarks) {
  const size = 48;
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(source.width - 1, Math.max(0, Math.round(mark.cx - size / 2 + x)));
      const sy = Math.min(source.height - 1, Math.max(0, Math.round(mark.cy - size / 2 + y)));
      const si = (sy * source.width + sx) * 4;
      const oi = (y * size + x) * 4;
      const r = source.data[si];
      const g = source.data[si + 1];
      const b = source.data[si + 2];
      const paperDistance = Math.max(r, g, b) - Math.min(r, g, b);
      const nearPaper = Math.min(r, g, b) > 188 && paperDistance < 30;
      out.data[oi] = r;
      out.data[oi + 1] = g;
      out.data[oi + 2] = b;
      out.data[oi + 3] = nearPaper ? 0 : 255;
    }
  }
  fs.writeFileSync(path.join(outputDir, mark.name), PNG.sync.write(out));
}
