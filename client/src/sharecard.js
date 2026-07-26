// S7 · 分享卡合成器（纯 canvas，零依赖，动态 import 不进首屏包）。
// 设计边界（ORACLE 附录）：分享卡是运行时由活数据合成的「用户导出内容」，
// 不是入库 UI 素材；入库 PNG 目录继续零文字零按钮。卡面底与徽记来自
// Lumen 内容媒体调色板与既有月门/印章资产；文字全部运行时绘制。
// 分辨率固定 1080×1440（3:4），与 devicePixelRatio 解耦——同一数据在任何
// 设备导出同一张图；预览 <img> 由 CSS 缩放。
import bootMarkUrl from './assets/app/qa5-boot-mark@2x.png?url';
import { streakSealUrl } from './art.jsx';
import { shareUrl } from './util.js';

export const CARD_W = 1080;
export const CARD_H = 1440;

// Lumen 内容媒体近似色（与 scripts/render-app-assets.mjs 的 P 调色板同源）
const P = {
  canvas: '#EDEFF6', ink: '#12151E', ink2: '#525A6E', ink3: '#7C8497',
  blue: '#5658c8', blueDeep: '#4547ad', blueSoft: '#e9eafb', blueMist: '#c9cdf7',
  gold: '#a07100', goldSoft: '#f0e9d3', rose: '#b04a76',
};

const UI_FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 图层缺失可降级：跳过该层
    img.src = src;
  });
}

// CJK 逐簇换行：CJK 码位后任意可断；ASCII 单词整体不拆（词过长再硬断）。
// 超 maxLines 行以 … 截断。返回行数组。
export function wrapText(ctx, text, maxWidth, maxLines) {
  const clusters = [];
  let ascii = '';
  for (const ch of String(text || '')) {
    if (/[\x21-\x7E]/.test(ch)) { ascii += ch; continue; }
    if (ascii) { clusters.push(ascii); ascii = ''; }
    if (ch === ' ') continue;
    clusters.push(ch);
  }
  if (ascii) clusters.push(ascii);

  const lines = [];
  let line = '';
  for (const unit of clusters) {
    const candidate = line + unit;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      // 单簇（超长 ASCII 词）超宽：硬断
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
        if (lines.length >= maxLines) break;
      }
    } else {
      lines.push(line);
      line = unit;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  const overflow = lines.length === maxLines
    && ctx.measureText(lines[maxLines - 1]).width > maxWidth - 40;
  if (overflow || clusters.join('').length > lines.join('').length) {
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }
  return lines;
}

function paintFrame(ctx, tone = 'iris') {
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.55, P.canvas);
  bg.addColorStop(1, tone === 'gold' ? P.goldSoft : P.blueSoft);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // 环境光晕（低透明椭圆两层，同空态舞台语言）
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = tone === 'gold' ? P.gold : P.blueMist;
  ctx.beginPath();
  ctx.ellipse(CARD_W / 2, 430, 430, 300, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(CARD_W / 2, 420, 300, 214, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 内容面板（浮起白面 + 发丝边）
  const panel = { x: 84, y: 120, w: CARD_W - 168, h: CARD_H - 320, r: 48 };
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(18,21,30,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, panel.r);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  return panel;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintAvatar(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = P.blueSoft;
  ctx.fill();
  if (img) {
    ctx.clip();
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

async function paintFooter(ctx, path) {
  const mark = await loadImage(bootMarkUrl);
  if (mark) ctx.drawImage(mark, CARD_W / 2 - 44, CARD_H - 172, 88, 88);
  ctx.fillStyle = P.ink2;
  ctx.font = `600 30px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('幻域 · HUANYU', CARD_W / 2, CARD_H - 52);
  if (path) {
    ctx.fillStyle = P.ink3;
    ctx.font = `26px ${UI_FONT}`;
    ctx.fillText(shareUrl(path).replace(/^https?:\/\//, ''), CARD_W / 2, CARD_H - 16);
  }
}

async function fontsReady() {
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await Promise.allSettled([
      document.fonts.load(`700 72px ${UI_FONT}`, '幻域'),
      document.fonts.load(`600 36px ${UI_FONT}`, '幻域'),
    ]);
  } catch { /* 字体接口缺失时用回退栈直接绘制 */ }
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  return canvas;
}

// 角色卡：封面 + 名字 + tagline + 分类章
export async function renderCharacterCard({ name, tagline, category, avatar, cover, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'iris');

  const coverImg = cover ? await loadImage(cover) : null;
  const avatarImg = avatar ? await loadImage(avatar) : null;
  if (coverImg) {
    ctx.save();
    roundRect(ctx, panel.x + 36, panel.y + 36, panel.w - 72, 620, 36);
    ctx.clip();
    const scale = Math.max((panel.w - 72) / coverImg.width, 620 / coverImg.height);
    const w = coverImg.width * scale;
    const h = coverImg.height * scale;
    ctx.drawImage(coverImg, panel.x + 36 + (panel.w - 72 - w) / 2, panel.y + 36 + (620 - h) / 2, w, h);
    const scrim = ctx.createLinearGradient(0, panel.y + 380, 0, panel.y + 656);
    scrim.addColorStop(0, 'rgba(10,12,20,0)');
    scrim.addColorStop(1, 'rgba(10,12,20,0.55)');
    ctx.fillStyle = scrim;
    ctx.fillRect(panel.x + 36, panel.y + 36, panel.w - 72, 620);
    ctx.restore();
  } else {
    paintAvatar(ctx, avatarImg, CARD_W / 2, panel.y + 320, 220);
  }

  let cursorY = panel.y + (coverImg ? 760 : 640);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 84px ${UI_FONT}`;
  ctx.fillText(String(name || '').slice(0, 12), CARD_W / 2, cursorY);
  cursorY += 34;

  if (category) {
    ctx.font = `600 30px ${UI_FONT}`;
    const label = String(category);
    const w = ctx.measureText(label).width + 56;
    ctx.fillStyle = P.blueSoft;
    roundRect(ctx, CARD_W / 2 - w / 2, cursorY, w, 56, 28);
    ctx.fill();
    ctx.fillStyle = P.blueDeep;
    ctx.fillText(label, CARD_W / 2, cursorY + 40);
    cursorY += 106;
  } else {
    cursorY += 40;
  }

  ctx.fillStyle = P.ink2;
  ctx.font = `36px ${UI_FONT}`;
  for (const line of wrapText(ctx, tagline || '一个等待被开启的故事', panel.w - 160, 2)) {
    ctx.fillText(line, CARD_W / 2, cursorY);
    cursorY += 56;
  }

  await paintFooter(ctx, path);
  return canvas;
}

// 成就卡：奖章环 + 成就名 + 描述 + 达成日期
export async function renderAchievementCard({ name, desc, medal = 'bronze', date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, medal === 'gold' ? 'gold' : 'iris');

  const ringColor = medal === 'gold' ? P.gold : medal === 'silver' ? P.ink3 : '#8a6b2f';
  ctx.save();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, panel.y + 330, 200, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = medal === 'gold' ? P.goldSoft : P.blueSoft;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, panel.y + 330, 172, 0, Math.PI * 2);
  ctx.fill();
  // 五角星（内容图形）
  ctx.fillStyle = ringColor;
  starPath(ctx, CARD_W / 2, panel.y + 330, 96, 44);
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 76px ${UI_FONT}`;
  ctx.fillText(String(name || '').slice(0, 10), CARD_W / 2, panel.y + 700);

  ctx.fillStyle = P.ink2;
  ctx.font = `36px ${UI_FONT}`;
  let y = panel.y + 780;
  for (const line of wrapText(ctx, desc || '', panel.w - 160, 2)) {
    ctx.fillText(line, CARD_W / 2, y);
    y += 56;
  }

  if (date) {
    ctx.fillStyle = P.ink3;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(`达成于 ${date}`, CARD_W / 2, panel.y + 930);
  }

  await paintFooter(ctx, path);
  return canvas;
}

// 连签里程碑卡：印章 + 大字天数 + 起讫说明
export async function renderStreakCard({ streak, date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'gold');

  const seal = await loadImage(streakSealUrl);
  if (seal) ctx.drawImage(seal, CARD_W / 2 - 210, panel.y + 90, 420, 420);

  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 160px ${UI_FONT}`;
  ctx.fillText(String(streak || 0), CARD_W / 2, panel.y + 700);
  ctx.font = `600 48px ${UI_FONT}`;
  ctx.fillText('天连续签到', CARD_W / 2, panel.y + 780);

  ctx.fillStyle = P.ink2;
  ctx.font = `34px ${UI_FONT}`;
  ctx.fillText('日拱一卒，故事不辍', CARD_W / 2, panel.y + 866);
  if (date) {
    ctx.fillStyle = P.ink3;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(`记于 ${date}`, CARD_W / 2, panel.y + 930);
  }

  await paintFooter(ctx, path);
  return canvas;
}

function starPath(ctx, cx, cy, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('卡片编码失败'))), 'image/png');
  });
}
