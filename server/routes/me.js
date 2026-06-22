import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

// Creator dashboard (创作中心) — aggregate stats for the caller's characters & scripts.
router.get('/studio', authRequired, (req, res) => {
  const uid = req.user.id;
  const chars = db.prepare('SELECT * FROM characters WHERE owner_id = ?').all(uid);
  const charRows = chars.map(c => ({
    id: c.id, name: c.name, avatar: c.avatar, is_public: !!c.is_public, uses: c.uses || 0, likes: c.likes || 0,
    favs: db.prepare('SELECT COUNT(*) n FROM favorites WHERE character_id = ?').get(c.id).n,
  }));
  const scripts = db.prepare('SELECT * FROM scripts WHERE author_id = ?').all(uid);
  const scriptRows = scripts.map(s => {
    let purchases = [];
    try { purchases = db.prepare('SELECT price FROM script_purchases WHERE script_id = ? AND COALESCE(refunded,0) = 0').all(s.id); } catch { purchases = []; }
    return { id: s.id, title: s.title, cover: s.cover, price_gold: s.price_gold || 0, plays: s.plays || 0, likes: s.likes || 0,
      sales: purchases.filter(p => (p.price || 0) > 0).length, revenue: purchases.reduce((a, p) => a + (p.price || 0), 0) };
  });
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const totals = {
    char_count: charRows.length, char_uses: sum(charRows, 'uses'), char_likes: sum(charRows, 'likes'), char_favs: sum(charRows, 'favs'),
    script_count: scriptRows.length, script_plays: sum(scriptRows, 'plays'), script_sales: sum(scriptRows, 'sales'),
    gold_earned: sum(scriptRows, 'revenue'), followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE following_id = ?').get(uid).n,
  };
  res.json({ totals, characters: charRows.sort((a, b) => b.uses - a.uses), scripts: scriptRows.sort((a, b) => b.revenue - a.revenue) });
});

export default router;
