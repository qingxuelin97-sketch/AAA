// 仪与匣 IX share-card compositor.
//
// Cards are exported artifacts, not a second UI surface.  They therefore use
// one deterministic dark vault skeleton at every theme/performance tier.  The
// five public render functions and the 1080×1440 contract are intentionally
// stable so the ShareCardSheet fallback chain does not change.
import { streakSealUrl, streakSealForTier } from './art.jsx';
import { shareUrl } from './util.js';

export const CARD_W = 1080;
export const CARD_H = 1440;

const P = {
  vault: '#182028',
  vaultRaise: '#202B31',
  vaultInset: '#11191E',
  ink: '#EDF3F4',
  ink2: '#A7B8BD',
  ink3: '#71818A',
  act: '#3FD2B4',
  actSoft: '#243E3C',
  dia: '#8FBCE8',
  gold: '#E0A83E',
  goldSoft: '#3A3324',
  line: 'rgba(237,243,244,.14)',
};

const UI_FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// CJK can break between any two glyphs; ASCII words stay together where they
// fit.  The final ellipsis is drawn by the compositor, never baked into data.
export function wrapText(ctx, text, maxWidth, maxLines) {
  const units = [];
  let ascii = '';
  for (const ch of String(text || '')) {
    if (/[\x21-\x7E]/.test(ch)) {
      ascii += ch;
      continue;
    }
    if (ascii) {
      units.push(ascii);
      ascii = '';
    }
    if (ch !== ' ') units.push(ch);
  }
  if (ascii) units.push(ascii);

  const lines = [];
  let line = '';
  for (const unit of units) {
    const candidate = line + unit;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      if (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    } else {
      lines.push(line);
      line = unit;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join('');
  if (units.join('').length > consumed.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(0, lines[last].length - 1))}…`;
  }
  return lines;
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

function paintFrame(ctx, tone = 'act') {
  const accent = tone === 'gold' ? P.gold : tone === 'dia' ? P.dia : P.act;
  ctx.fillStyle = P.vault;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // A static instrument plate: no ambient wash, shimmer, or theme-dependent
  // material.  The small rules are useful in compressed social previews.
  ctx.fillStyle = P.vaultInset;
  ctx.fillRect(0, 0, CARD_W, 112);
  ctx.fillStyle = accent;
  ctx.fillRect(84, 76, 112, 4);
  ctx.fillStyle = P.ink3;
  ctx.font = `600 24px ${UI_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('HUANYU / FIELD INSTRUMENT', 84, 56);

  const panel = { x: 72, y: 144, w: CARD_W - 144, h: CARD_H - 344, r: 34 };
  ctx.fillStyle = P.vaultRaise;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, panel.r);
  ctx.fill();
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 2;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, panel.r);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  for (let y = panel.y + 48; y < panel.y + panel.h; y += 96) {
    ctx.beginPath();
    ctx.moveTo(panel.x + 32, y);
    ctx.lineTo(panel.x + panel.w - 32, y);
    ctx.stroke();
  }
  ctx.restore();
  return panel;
}

function paintAvatar(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = P.vaultInset;
  ctx.fill();
  if (img) {
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = P.act;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

async function paintFooter(ctx, path) {
  const x = CARD_W / 2;
  const y = CARD_H - 146;
  ctx.fillStyle = P.act;
  ctx.fillRect(x - 34, y - 24, 68, 8);
  ctx.strokeStyle = P.act;
  ctx.lineWidth = 5;
  ctx.strokeRect(x - 22, y - 8, 44, 34);
  ctx.fillStyle = P.ink2;
  ctx.font = `600 28px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('幻域 · HUANYU', x, CARD_H - 66);
  if (path) {
    ctx.fillStyle = P.ink3;
    ctx.font = `22px ${UI_FONT}`;
    ctx.fillText(shareUrl(path).replace(/^https?:\/\//, ''), x, CARD_H - 28);
  }
}

async function fontsReady() {
  try {
    if (!document.fonts) return;
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
    await Promise.allSettled([
      document.fonts.load(`700 72px ${UI_FONT}`, '幻域'),
      document.fonts.load(`600 36px ${UI_FONT}`, '幻域'),
    ]);
  } catch {
    // Canvas falls back to the system CJK stack when FontFaceSet is absent.
  }
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  return canvas;
}

export async function renderCharacterCard({ name, tagline, category, avatar, cover, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'act');
  const coverImg = cover ? await loadImage(cover) : null;
  const avatarImg = avatar ? await loadImage(avatar) : null;

  if (coverImg) {
    ctx.save();
    roundRect(ctx, panel.x + 36, panel.y + 36, panel.w - 72, 620, 28);
    ctx.clip();
    const scale = Math.max((panel.w - 72) / coverImg.width, 620 / coverImg.height);
    ctx.drawImage(
      coverImg,
      panel.x + 36 + (panel.w - 72 - coverImg.width * scale) / 2,
      panel.y + 36 + (620 - coverImg.height * scale) / 2,
      coverImg.width * scale,
      coverImg.height * scale,
    );
    ctx.fillStyle = 'rgba(17,25,30,.48)';
    ctx.fillRect(panel.x + 36, panel.y + 36, panel.w - 72, 620);
    ctx.restore();
  } else {
    paintAvatar(ctx, avatarImg, CARD_W / 2, panel.y + 330, 210);
  }

  let y = panel.y + (coverImg ? 780 : 650);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 82px ${UI_FONT}`;
  ctx.fillText(String(name || '未命名').slice(0, 12), CARD_W / 2, y);
  y += 52;
  if (category) {
    ctx.fillStyle = P.actSoft;
    const w = ctx.measureText(String(category)).width + 48;
    roundRect(ctx, CARD_W / 2 - w / 2, y - 34, w, 54, 27);
    ctx.fill();
    ctx.fillStyle = P.act;
    ctx.font = `600 28px ${UI_FONT}`;
    ctx.fillText(String(category), CARD_W / 2, y + 4);
    y += 88;
  }
  ctx.fillStyle = P.ink2;
  ctx.font = `36px ${UI_FONT}`;
  for (const line of wrapText(ctx, tagline || '一个等待被打开的故事', panel.w - 160, 2)) {
    ctx.fillText(line, CARD_W / 2, y);
    y += 56;
  }
  await paintFooter(ctx, path);
  return canvas;
}

export async function renderAchievementCard({ name, desc, medal = 'bronze', date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, medal === 'gold' ? 'gold' : 'act');
  const ringColor = medal === 'gold' ? P.gold : medal === 'silver' ? P.dia : P.act;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, panel.y + 330, 196, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = medal === 'gold' ? P.goldSoft : P.actSoft;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, panel.y + 330, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ringColor;
  starPath(ctx, CARD_W / 2, panel.y + 330, 94, 42);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 74px ${UI_FONT}`;
  ctx.fillText(String(name || '成就').slice(0, 10), CARD_W / 2, panel.y + 700);
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

export async function renderStreakCard({ streak, date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'gold');
  const seal = await loadImage(streakSealForTier(Number(streak) || 0) || streakSealUrl);
  if (seal) ctx.drawImage(seal, CARD_W / 2 - 210, panel.y + 92, 420, 420);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 160px ${UI_FONT}`;
  ctx.fillText(String(streak || 0), CARD_W / 2, panel.y + 700);
  ctx.fillStyle = P.gold;
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

export async function renderQuoteCard({ text, speaker, avatar, date, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'dia');
  ctx.textAlign = 'left';
  ctx.fillStyle = P.dia;
  ctx.font = `700 220px Georgia, ${UI_FONT}`;
  ctx.fillText('“', panel.x + 56, panel.y + 260);

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
    if (wrapped.join('').replace(/…$/, '').length >= body.length) {
      picked = tier;
      lines = wrapped;
      break;
    }
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

  const avatarImg = avatar ? await loadImage(avatar) : null;
  const sig = `— ${String(speaker || '匿名').slice(0, 14)}`;
  ctx.font = `600 40px ${UI_FONT}`;
  const sigW = ctx.measureText(sig).width;
  const avR = 44;
  const total = avR * 2 + 24 + sigW;
  const sx = CARD_W / 2 - total / 2;
  paintAvatar(ctx, avatarImg, sx + avR, panel.y + panel.h - 130, avR);
  ctx.textAlign = 'left';
  ctx.fillStyle = P.ink2;
  ctx.fillText(sig, sx + avR * 2 + 24, panel.y + panel.h - 116);
  if (date) {
    ctx.textAlign = 'center';
    ctx.fillStyle = P.ink3;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(`拾于 ${date}`, CARD_W / 2, panel.y + panel.h - 44);
  }
  await paintFooter(ctx, path);
  return canvas;
}

export async function renderInsightsCard({ since, streak, conversations, messages, activeDays, companion, path }) {
  await fontsReady();
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const panel = paintFrame(ctx, 'dia');
  const cx = CARD_W / 2;
  const cy = panel.y + 300;
  ctx.strokeStyle = P.dia;
  ctx.lineWidth = 3;
  for (const [rx, ry, rot] of [[300, 104, -0.16], [222, 76, 0.12], [150, 50, -0.05]]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = P.gold;
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = P.ink;
  ctx.font = `700 68px ${UI_FONT}`;
  ctx.fillText('我的幻域星轨', cx, panel.y + 520);
  if (since) {
    ctx.fillStyle = P.ink3;
    ctx.font = `32px ${UI_FONT}`;
    ctx.fillText(`自 ${since} 启程`, cx, panel.y + 578);
  }
  const stats = [
    [String(conversations || 0), '段对话'],
    [String(messages || 0), '条消息'],
    [String(activeDays || 0), '个活跃日'],
    [String(streak || 0), '天连续'],
  ];
  const gridTop = panel.y + 650;
  stats.forEach(([num, label], i) => {
    const gx = cx + (i % 2 === 0 ? -190 : 190);
    const gy = gridTop + Math.floor(i / 2) * 150;
    ctx.fillStyle = P.act;
    ctx.font = `700 64px ${UI_FONT}`;
    ctx.fillText(num, gx, gy);
    ctx.fillStyle = P.ink2;
    ctx.font = `30px ${UI_FONT}`;
    ctx.fillText(label, gx, gy + 46);
  });
  if (companion) {
    ctx.fillStyle = P.ink2;
    ctx.font = `600 34px ${UI_FONT}`;
    ctx.fillText(`最深羁绊 · ${String(companion).slice(0, 12)}`, cx, panel.y + panel.h - 60);
  }
  await paintFooter(ctx, path);
  return canvas;
}

function starPath(ctx, cx, cy, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
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
