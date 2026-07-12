import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx } from '../wallet.js';
import { getPlatform, imageReady, featureFee, IMAGE_FEE } from '../platform.js';
import { assertPublicUrl, safeFetch } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';
import { generateTencentImage } from '../tencentImage.js';

const router = Router();
const SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512', '768x1024', '1024x768'];

// Text-to-image via the platform image service — billed per image (VIP discount).
// 按 provider 分发：腾讯云走 AIrtist ImageGeneration（TC3 签名），其他走 OpenAI 兼容 /images/generations。
router.post('/image', authRequired, aiLimiter, async (req, res) => {
  const cfg = getPlatform().image;
  if (!imageReady()) return res.status(503).json({ error: '平台 AI 生图服务尚未开启，请联系管理员配置生图 API。' });
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: '请先输入画面描述' });
  if (prompt.length > 1500) return res.status(400).json({ error: '画面描述过长（上限 1500 字）' });
  const fee = featureFee(me, IMAGE_FEE);
  // 预扣 + 失败退款：老写法先出图后扣费，多请求并发通过同一份余额快照的预检后
  // 各自免费出图（上游成本已花掉）。applyTx 事务内校验余额，并发第二笔当场原子拒绝。
  try { applyTx(me.id, { kind: 'image_fee', gold: -fee, memo: `AI 生图 · ${prompt.slice(0, 18)}` }); }
  catch { return res.status(402).json({ error: `金币不足，生成一张图需 ${fee} 金币（当前 ${me.gold}）。` }); }
  let charged = true;
  const refundFee = (reason) => {
    if (!charged) return;
    charged = false;
    try { applyTx(me.id, { kind: 'ai_refund', gold: fee, memo: `退款（${reason}）· AI 生图 · ${prompt.slice(0, 18)}` }); }
    catch (e) { console.error('[ai] 生图预扣退款失败', e.message); }
  };
  const size = SIZES.includes(req.body?.size) ? req.body.size : (cfg.size || '1024x1024');
  try {
    let image;
    if (cfg.provider === 'tencent') {
      // 腾讯云 AIrtist：TC3 签名直连 aiart.tencentcloudapi.com，无需 SSRF 校验（固定官方域名）
      image = (await generateTencentImage(cfg, { prompt, size })).image;
    } else if (cfg.provider === 'hunyuan') {
      // 腾讯混元 TokenHub：OpenAI 兼容 /images/generations，size 需转成冒号格式
      assertPublicUrl(cfg.base_url);
      const hySize = String(size).replace('x', ':'); // 1024x1024 -> 1024:1024
      const up = await safeFetch(cfg.base_url.replace(/\/$/, '') + '/images/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model || 'hy-image-v3.0', prompt, size: hySize, n: 1 }),
      });
      if (!up.ok) {
        const t = await up.text().catch(() => '');
        console.error('[ai] 混元生图上游错误', up.status, t.slice(0, 400));
        refundFee('上游错误');
        return res.status(502).json({ error: '混元生图服务暂不可用：' + t.slice(0, 200) });
      }
      const d = await up.json().catch(() => null);
      const item = d?.data?.[0] || {};
      image = item.b64_json ? 'data:image/png;base64,' + item.b64_json : (item.url || item.image);
    } else {
      // OpenAI 兼容协议：base_url + Bearer key 调 /images/generations
      assertPublicUrl(cfg.base_url);
      const up = await safeFetch(cfg.base_url.replace(/\/$/, '') + '/images/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, prompt, size, n: 1 }),
      });
      if (!up.ok) {
        const t = await up.text().catch(() => '');
        console.error('[ai] 生图上游错误', up.status, t.slice(0, 300));
        refundFee('上游错误');
        return res.status(502).json({ error: '生图服务暂不可用，请稍后再试' });
      }
      const d = await up.json().catch(() => null); const item = d?.data?.[0] || {};
      image = item.b64_json ? 'data:image/png;base64,' + item.b64_json : item.url;
    }
    if (!image) { refundFee('空产出'); return res.status(502).json({ error: '生图服务未返回图片' }); }
    const r = db.prepare('INSERT INTO ai_images (user_id, prompt, size, url) VALUES (?,?,?,?)').run(me.id, prompt, size, image);
    // 余额现查现报：预扣与出图之间可能有其他消费，别把过期快照报给前端。
    const w = db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(me.id);
    res.json({ image, id: r.lastInsertRowid, fee, size, prompt, wallet: w });
  } catch (e) {
    console.error('[ai] 生图失败', e.message);
    refundFee('生图失败');
    // 腾讯云返回的错误信息含错误码，对用户可见以利排查；其他协议返回通用提示
    const msg = cfg.provider === 'tencent' ? (e.message || '生图服务暂不可用') : '生图服务暂不可用，请稍后再试';
    res.status(502).json({ error: msg });
  }
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
