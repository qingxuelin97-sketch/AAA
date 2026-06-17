import { Router } from 'express';
import db from '../db.js';
import { authOptional } from '../auth.js';
import { isVip } from '../wallet.js';

const router = Router();

// Search users by numeric ID or username / display name.
router.get('/search', authOptional, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  let rows;
  if (/^\d+$/.test(q)) {
    rows = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE id = ?').all(Number(q));
  } else {
    const k = `%${q}%`;
    rows = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 30').all(k, k);
  }
  res.json({ users: rows });
});

// Public profile: user info + public characters + scripts + moments + stats
router.get('/:id', authOptional, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, avatar, banner, bio, vip_until, is_gm, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  u.vip = isVip(u);
  u.is_gm = !!u.is_gm;
  const characters = db.prepare('SELECT * FROM characters WHERE owner_id = ? AND is_public = 1 ORDER BY created_at DESC').all(u.id);
  const scripts = db.prepare('SELECT * FROM scripts WHERE author_id = ? ORDER BY created_at DESC').all(u.id);
  const moments = db.prepare('SELECT * FROM moments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(u.id);
  const stats = {
    characters: db.prepare('SELECT COUNT(*) n FROM characters WHERE owner_id = ?').get(u.id).n,
    scripts: scripts.length,
    followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE following_id = ?').get(u.id).n,
    following: db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(u.id).n
  };
  let following = false;
  if (req.user) following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, u.id);
  res.json({ user: u, characters, scripts, moments, stats, following });
});

export default router;
