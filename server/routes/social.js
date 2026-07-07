import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';
import { notify } from '../wallet.js';
import { log } from '../logger.js';

const router = Router();

// ---- presence heartbeat (powers online status for friends/DM) ----
router.post('/heartbeat', authRequired, (req, res) => {
  db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(Date.now(), req.user.id);
  res.json({ ok: true });
});

// ---- Moments feed ----
router.get('/moments', authOptional, (req, res) => {
  const scope = req.query.scope; // 'following' for followed users only
  let sql = `SELECT m.*, u.display_name AS author_name, u.avatar AS author_avatar,
    (SELECT COUNT(*) FROM comments c WHERE c.moment_id = m.id) AS comment_count
    FROM moments m JOIN users u ON u.id = m.user_id`;
  const args = [];
  if (scope === 'following' && req.user) {
    sql += ' WHERE m.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)';
    args.push(req.user.id);
  }
  sql += ' ORDER BY m.created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...args);
  if (req.user) {
    const liked = new Set(db.prepare('SELECT moment_id FROM moment_likes WHERE user_id = ?').all(req.user.id).map(r => r.moment_id));
    rows.forEach(r => (r.liked = liked.has(r.id)));
  }
  res.json({ moments: rows });
});

router.post('/moments', authRequired, contentLimiter, (req, res) => {
  const { text, image } = req.body || {};
  if (!text && !image) return res.status(400).json({ error: '说点什么或配张图吧' });
  const info = db.prepare('INSERT INTO moments (user_id, text, image) VALUES (?,?,?)').run(req.user.id, text || '', image || null);
  log({
    level: 'info', category: 'social', event: 'moment_post',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { moment_id: Number(info.lastInsertRowid), has_image: !!image, text_length: (text || '').length },
    message: `用户 ${req.user.id} 发布动态 ${info.lastInsertRowid}`,
  });
  res.json({ moment: db.prepare('SELECT * FROM moments WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/moments/:id', authRequired, (req, res) => {
  const m = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!m || m.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM moments WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

router.post('/moments/:id/like', authRequired, (req, res) => {
  const m = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '动态不存在' });
  const has = db.prepare('SELECT 1 FROM moment_likes WHERE moment_id = ? AND user_id = ?').get(m.id, req.user.id);
  if (has) {
    db.prepare('DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?').run(m.id, req.user.id);
    db.prepare('UPDATE moments SET likes = MAX(0, likes - 1) WHERE id = ?').run(m.id);
    log({
      level: 'info', category: 'social', event: 'moment_like',
      user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { moment_id: m.id, author_id: m.user_id, liked: false },
      message: `用户 ${req.user.id} 取消点赞动态 ${m.id}`,
    });
    return res.json({ liked: false, likes: m.likes - 1 });
  }
  db.prepare('INSERT INTO moment_likes (moment_id, user_id) VALUES (?,?)').run(m.id, req.user.id);
  db.prepare('UPDATE moments SET likes = likes + 1 WHERE id = ?').run(m.id);
  if (m.user_id !== req.user.id) notify(m.user_id, `${req.user.display_name || req.user.username} 赞了你的动态`, '/community');
  log({
    level: 'info', category: 'social', event: 'moment_like',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { moment_id: m.id, author_id: m.user_id, liked: true },
    message: `用户 ${req.user.id} 点赞动态 ${m.id}`,
  });
  res.json({ liked: true, likes: m.likes + 1 });
});

router.get('/moments/:id/comments', (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.moment_id = ? ORDER BY c.id`).all(req.params.id);
  res.json({ comments: rows });
});

router.post('/moments/:id/comments', authRequired, contentLimiter, (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: '评论不能为空' });
  const m = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '动态不存在' });
  const info = db.prepare('INSERT INTO comments (moment_id, user_id, text) VALUES (?,?,?)').run(m.id, req.user.id, text);
  if (m.user_id !== req.user.id) notify(m.user_id, `${req.user.display_name || req.user.username} 评论了你的动态：${text.slice(0, 20)}`, '/community');
  const c = db.prepare(`SELECT c.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(info.lastInsertRowid);
  res.json({ comment: c });
});

// ---- Suggested users (你可能感兴趣的人) ----
router.get('/suggested', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.bio,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers,
      (SELECT COUNT(*) FROM characters c WHERE c.owner_id = u.id AND c.is_public = 1) AS chars
    FROM users u
    WHERE u.id != ? AND u.is_banned = 0
      AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
    ORDER BY followers DESC, chars DESC, RANDOM() LIMIT 8`).all(req.user.id, req.user.id);
  res.json({ users: rows });
});

// ---- Follow ----
router.post('/follow/:id', authRequired, (req, res) => {
  const target = parseInt(req.params.id, 10);
  if (target === req.user.id) return res.status(400).json({ error: '不能关注自己' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, target);
  if (has) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target);
    log({
      level: 'info', category: 'social', event: 'follow',
      user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { target_user_id: target, following: false },
      message: `用户 ${req.user.id} 取消关注用户 ${target}`,
    });
    return res.json({ following: false });
  }
  db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?,?)').run(req.user.id, target);
  notify(target, `${req.user.display_name || req.user.username} 关注了你`, '/user/' + req.user.id);
  log({
    level: 'info', category: 'social', event: 'follow',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { target_user_id: target, following: true },
    message: `用户 ${req.user.id} 关注用户 ${target}`,
  });
  res.json({ following: true });
});

router.get('/follow-state/:id', authRequired, (req, res) => {
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.id);
  res.json({ following: !!has });
});

// ---- Notifications ----
router.get('/notifications', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
  res.json({ notifications: rows, unread });
});

router.post('/notifications/read', authRequired, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
