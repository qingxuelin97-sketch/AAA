import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx } from '../wallet.js';
import { getPlatform, imageReady, featureFee, IMAGE_FEE } from '../platform.js';

const router = Router();
const SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512', '768x1024', '1024x768'];

// Text-to-image via the platform image service — billed per image (VIP discount).
router.post('/image', authRequired, async (req, res) => {
  const cfg = getPlatform().image;
  if (!imageReady()) return res.status(503).json({ error: '平台 AI 生图服务尚未开启，请联系管理员配置生图 API。' });
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: '请先输入画面描述' });
  if (prompt.length > 1500) return res.status(400).json({ error: '画面描述过长（上限 1500 字）' });
  const fee = featureFee(me, IMAGE_FEE);
  if (me.gold < fee) return res.status(402).json({ error: `金币不足，生成一张图需 ${fee} 金币（当前 ${me.gold}）。` });
  const size = SIZES.includes(req.body?.size) ? req.body.size : (cfg.size || '1024x1024');
  try {
    const up = await fetch(cfg.base_url.replace(/\/$/, '') + '/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, prompt, size, n: 1 }),
    });
    if (!up.ok) { const t = await up.text().catch(() => ''); return res.status(502).json({ error: `生图服务返回 ${up.status}：${t.slice(0, 240)}` }); }
    const d = await up.json().catch(() => null); const item = d?.data?.[0] || {};
    const image = item.b64_json ? 'data:image/png;base64,' + item.b64_json : item.url;
    if (!image) return res.status(502).json({ error: '生图服务未返回图片' });
    let w; try { w = applyTx(me.id, { kind: 'image_fee', gold: -fee, memo: `AI 生图 · ${prompt.slice(0, 18)}` }); } catch (e) { return res.status(402).json({ error: e.message }); }
    const r = db.prepare('INSERT INTO ai_images (user_id, prompt, size, url) VALUES (?,?,?,?)').run(me.id, prompt, size, image);
    res.json({ image, id: r.lastInsertRowid, fee, size, prompt, wallet: w });
  } catch (e) { res.status(502).json({ error: '生图服务连接失败：' + e.message }); }
});

router.get('/images', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM ai_images WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(req.user.id);
  const me = db.prepare('SELECT vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  res.json({ images: rows, fee: featureFee(me, IMAGE_FEE), base_fee: IMAGE_FEE, ready: imageReady() });
});

router.delete('/images/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM ai_images WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
