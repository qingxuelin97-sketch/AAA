import { Router } from 'express';
import db from '../db.js';
import { authOptional } from '../auth.js';

const router = Router();

// Public profile page: user info + their public characters + their posts
router.get('/:id', authOptional, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, avatar, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const characters = db.prepare('SELECT * FROM characters WHERE owner_id = ? AND is_public = 1 ORDER BY created_at DESC').all(u.id);
  const posts = db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC').all(u.id);
  const stats = {
    characters: db.prepare('SELECT COUNT(*) n FROM characters WHERE owner_id = ?').get(u.id).n,
    posts: posts.length,
    likes: db.prepare('SELECT COALESCE(SUM(likes),0) n FROM posts WHERE author_id = ?').get(u.id).n
  };
  res.json({ user: u, characters, posts, stats });
});

export default router;
