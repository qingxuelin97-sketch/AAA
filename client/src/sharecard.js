// S7 · 分享卡合成器（纯 canvas，零依赖，动态 import 不进首屏包）。
// 设计边界（ORACLE 附录）：分享卡是运行时由活数据合成的「用户导出内容」，
// 不是入库 UI 素材；入库 PNG 目录继续零文字零按钮。卡面底与徽记来自
// Lumen 内容媒体调色板与既有月门/印章资产；文字全部运行时绘制。
// 分辨率固定 1080×1440（3:4），与 devicePixelRatio 解耦——同一数据在任何
// 设备导出同一张图；预览 <img> 由 CSS 缩放。
import bootMarkUrl from './assets/app/qa5-boot-mark@2x.png?url';
import { streakSealUrl, streakSealForTier } from './art.jsx';
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

  // 里程碑分档印章：30/100 天有专属环饰，普通连签用基础焰章
  const seal = await loadImage(streakSealForTier(Number(streak) || 0) || streakSealUrl);
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

// 台词卡：引号 + 自适应字号的台词正文 + 出场角色署名行
// text 是会话现场的活台词（用户导出内容）；长文降字号多行，超限截 …。
export async function renderQuoteCard({ text, speaker, avatar, date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'iris');

  // 装饰引号（字形即内容，不属于 UI 控件）
  ctx.textAlign = 'left';
  ctx.fillStyle = P.blueMist;
  ctx.font = `700 220px Georgia, ${UI_FONT}`;
  ctx.fillText('“', panel.x + 60, panel.y + 260);

  // 台词正文：短句大字居中，长文降档多行
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  const tiers = [
    { size: 72, lines: 5, lh: 108 },
    { size: 56, lines: 7, lh: 86 },
    { size: 44, lines: 9, lh: 68 },
  ];
  let picked = tiers[tiers.length - 1];
  let lines = [];
  for (const tier of tiers) {
    ctx.font = `600 ${tier.size}px ${UI_FONT}`;
    const wrapped = wrapText(ctx, body, panel.w - 200, tier.lines);
    const consumed = wrapped.join('').replace(/…$/, '');
    if (body.startsWith(consumed) && consumed.length >= body.length) {
      picked = tier;
      lines = wrapped;
      break;
    }
    picked = tier;
    lines = wrapped;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `600 ${picked.size}px ${UI_FONT}`;
  const blockH = lines.length * picked.lh;
  let y = panel.y + 330 + Math.max(0, (620 - blockH) / 2) + picked.size / 2;
  for (const line of lines) {
    ctx.fillText(line, CARD_W / 2, y);
    y += picked.lh;
  }

  // 署名行：小头像 + 「—— 角色名」
  const avatarImg = avatar ? await loadImage(avatar) : null;
  const sigY = panel.y + panel.h - 130;
  const sig = `—— ${String(speaker || '').slice(0, 14)}`;
  ctx.font = `600 40px ${UI_FONT}`;
  const sigW = ctx.measureText(sig).width;
  const avR = 44;
  const total = avR * 2 + 24 + sigW;
  paintAvatar(ctx, avatarImg, CARD_W / 2 - total / 2 + avR, sigY, avR);
  ctx.textAlign = 'left';
  ctx.fillStyle = P.ink2;
  ctx.fillText(sig, CARD_W / 2 - total / 2 + avR * 2 + 24, sigY + 14);

  if (date) {
    ctx.textAlign = 'center';
    ctx.fillStyle = P.ink3;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(`拾于 ${date}`, CARD_W / 2, panel.y + panel.h - 44);
  }

  await paintFooter(ctx, path);
  return canvas;
}

// 星轨年鉴卡：轨道环 + 旅程大数 + 羁绊署名。全部由 /me/insights 活数据合成。
export async function renderInsightsCard({ since, streak, conversations, messages, activeDays, companion, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'iris');

  // 轨道环（静态内容图形：三圈椭圆 + 若干星点）
  const cx = CARD_W / 2;
  const cy = panel.y + 300;
  ctx.save();
  ctx.strokeStyle = P.blueMist;
  ctx.lineWidth = 3;
  for (const [rx, ry, rot] of [[300, 104, -0.16], [222, 76, 0.12], [150, 50, -0.05]]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = P.blue;
  for (const [sx, sy, r] of [[cx - 264, cy - 46, 7], [cx + 210, cy + 62, 9], [cx + 96, cy - 84, 6], [cx - 60, cy + 96, 5]]) {
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = P.gold;
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 68px ${UI_FONT}`;
  ctx.fillText('我的幻域星轨', cx, panel.y + 520);
  if (since) {
    ctx.fillStyle = P.ink3;
    ctx.font = `32px ${UI_FONT}`;
    ctx.fillText(`自 ${since} 启程`, cx, panel.y + 578);
  }

  // 2×2 旅程数字
  const stats = [
    [String(conversations || 0), '段对话'],
    [String(messages || 0), '条消息'],
    [String(activeDays || 0), '个活跃日'],
    [String(streak || 0), '天连签'],
  ];
  const gridTop = panel.y + 650;
  stats.forEach(([num, label], i) => {
    const gx = cx + (i % 2 === 0 ? -190 : 190);
    const gy = gridTop + Math.floor(i / 2) * 150;
    ctx.fillStyle = P.blueDeep;
    ctx.font = `700 64px ${UI_FONT}`;
    ctx.fillText(num, gx, gy);
    ctx.fillStyle = P.ink2;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(label, gx, gy + 46);
  });

  if (companion) {
    ctx.fillStyle = P.ink2;
    ctx.font = `600 34px ${UI_FONT}`;
    ctx.fillText(`羁绊最深 · ${String(companion).slice(0, 12)}`, cx, panel.y + panel.h - 60);
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
