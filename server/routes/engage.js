import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { applyTx } from '../wallet.js';

const router = Router();
const TT = (t) => (t === 'script' ? 'script' : 'character');

// ---- views ----
router.post('/view', authOptional, (req, res) => {
  const { type, id } = req.body || {};
  const tbl = TT(type) === 'script' ? 'scripts' : 'characters';
  db.prepare(`UPDATE ${tbl} SET views = views + 1 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ---- reviews / ratings ----
router.get('/reviews/:type/:id', authOptional, (req, res) => {
  const type = TT(req.params.type), id = +req.params.id;
  const rows = db.prepare(`SELECT r.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.id DESC`).all(type, id);
  const agg = db.prepare('SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE target_type=? AND target_id=?').get(type, id);
  const mine = req.user ? db.prepare('SELECT * FROM reviews WHERE target_type=? AND target_id=? AND user_id=?').get(type, id, req.user.id) : null;
  res.json({ reviews: rows, avg: agg.avg || 0, count: agg.n || 0, mine });
});
router.post('/reviews/:type/:id', authRequired, (req, res) => {
  const type = TT(req.params.type), id = +req.params.id;
  const rating = Math.min(5, Math.max(1, parseInt(req.body?.rating, 10) || 5));
  const text = (req.body?.text || '').slice(0, 500);
  const ex = db.prepare('SELECT id FROM reviews WHERE target_type=? AND target_id=? AND user_id=?').get(type, id, req.user.id);
  if (ex) db.prepare('UPDATE reviews SET rating=?, text=?, created_at=datetime(\'now\') WHERE id=?').run(rating, text, ex.id);
  else db.prepare('INSERT INTO reviews (target_type, target_id, user_id, rating, text) VALUES (?,?,?,?,?)').run(type, id, req.user.id, rating, text);
  res.json({ ok: true });
});
router.delete('/reviews/:id', authRequired, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r || r.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// ---- reports ----
router.post('/report', authRequired, (req, res) => {
  const { type, id, reason } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: '参数不全' });
  db.prepare('INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES (?,?,?,?)').run(type, id, req.user.id, reason || '');
  res.json({ ok: true });
});

// ---- leaderboard ----
router.get('/leaderboard', authOptional, (req, res) => {
  const characters = db.prepare(`SELECT c.id, c.name, c.avatar, c.likes, c.uses, c.views, u.display_name owner_name
    FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.is_public=1 ORDER BY c.likes DESC, c.uses DESC LIMIT 20`).all();
  const scripts = db.prepare(`SELECT s.id, s.title, s.cover, s.plays, s.likes, s.price_gold, u.display_name author_name
    FROM scripts s JOIN users u ON u.id=s.author_id ORDER BY s.plays DESC, s.likes DESC LIMIT 20`).all();
  const authors = db.prepare(`SELECT u.id, u.display_name, u.avatar,
      (SELECT COALESCE(SUM(likes),0) FROM characters WHERE owner_id=u.id) +
      (SELECT COALESCE(SUM(likes),0) FROM scripts WHERE author_id=u.id) AS score,
      (SELECT COUNT(*) FROM characters WHERE owner_id=u.id AND is_public=1) AS chars
    FROM users u WHERE u.is_banned=0 ORDER BY score DESC LIMIT 20`).all();
  res.json({ characters, scripts, authors });
});

// ---- gacha (spend diamonds to draw a public character into favorites) ----
const GACHA_COST = 50;
router.post('/gacha', authRequired, (req, res) => {
  const pool = db.prepare('SELECT * FROM characters WHERE is_public = 1').all();
  if (!pool.length) return res.status(400).json({ error: '暂无可抽取的角色' });
  try { applyTx(req.user.id, { kind: 'reward', diamond: -GACHA_COST, memo: '抽卡' }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const already = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND character_id=?').get(req.user.id, pick.id);
  if (!already) { db.prepare('INSERT INTO favorites (user_id, character_id) VALUES (?,?)').run(req.user.id, pick.id); db.prepare('UPDATE characters SET likes=likes+1 WHERE id=?').run(pick.id); }
  // small gold consolation
  const w = applyTx(req.user.id, { kind: 'reward', gold: 20, memo: '抽卡返利' });
  res.json({ character: { id: pick.id, name: pick.name, avatar: pick.avatar, tagline: pick.tagline }, already: !!already, cost: GACHA_COST, wallet: w });
});

export default router;
