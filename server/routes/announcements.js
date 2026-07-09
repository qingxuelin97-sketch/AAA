import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional, requireGm } from '../auth.js';

const router = Router();

router.get('/', authOptional, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.display_name AS author_name FROM announcements a
    LEFT JOIN users u ON u.id = a.author_id ORDER BY a.pinned DESC, a.id DESC LIMIT 50`).all();
  res.json({ announcements: rows, is_gm: !!req.user?.is_gm });
});

router.post('/', authRequired, requireGm, (req, res) => {
  const { title, body, pinned } = req.body || {};
  if (!title) return res.status(400).json({ error: '公告标题必填' });
  const info = db.prepare('INSERT INTO announcements (author_id, title, body, pinned) VALUES (?,?,?,?)')
    .run(req.user.id, title, body || '', pinned ? 1 : 0);
  res.json({ announcement: db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/:id', authRequired, requireGm, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
