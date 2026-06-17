import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';

const router = Router();
const isGm = (uid) => !!db.prepare('SELECT is_gm FROM users WHERE id = ?').get(uid)?.is_gm;

router.get('/', authOptional, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.display_name AS author_name FROM announcements a
    LEFT JOIN users u ON u.id = a.author_id ORDER BY a.pinned DESC, a.id DESC LIMIT 50`).all();
  res.json({ announcements: rows, is_gm: req.user ? isGm(req.user.id) : false });
});

router.post('/', authRequired, (req, res) => {
  if (!isGm(req.user.id)) return res.status(403).json({ error: '仅 GM 可发布公告' });
  const { title, body, pinned } = req.body || {};
  if (!title) return res.status(400).json({ error: '公告标题必填' });
  const info = db.prepare('INSERT INTO announcements (author_id, title, body, pinned) VALUES (?,?,?,?)')
    .run(req.user.id, title, body || '', pinned ? 1 : 0);
  res.json({ announcement: db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/:id', authRequired, (req, res) => {
  if (!isGm(req.user.id)) return res.status(403).json({ error: '仅 GM 可删除公告' });
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
