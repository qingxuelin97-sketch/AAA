import { Router } from 'express';
import db from '../db.js';
import { authOptional } from '../auth.js';
import { isVip } from '../wallet.js';

const router = Router();

// Public profile: user info + public characters + scripts + moments + stats
router.get('/:id', authOptional, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, avatar, banner, bio, vip_until, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  u.vip = isVip(u);
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
