import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';
import { str, clampInt, jsonText } from '../validate.js';
import { bumpDaily } from '../daily.js';
import { broadcast } from '../realtime.js';
import { creatorTier } from '../creator.js';

const router = Router();

// Public feed of shared scripts / character cards
router.get('/feed', authOptional, (req, res) => {
  const type = req.query.type;
  const q = req.query.q ? `%${req.query.q}%` : null;
  let sql = `SELECT p.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM posts p JOIN users u ON u.id = p.author_id WHERE 1=1`;
  const args = [];
  if (type && type !== 'all') { sql += ' AND p.type = ?'; args.push(type); }
  if (q) { sql += ' AND (p.title LIKE ? OR p.tags LIKE ? OR p.body LIKE ?)'; args.push(q, q, q); }
  sql += ' ORDER BY p.created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...args);
  if (req.user) {
    const liked = new Set(db.prepare('SELECT post_id FROM post_likes WHERE user_id = ?').all(req.user.id).map(r => r.post_id));
    rows.forEach(r => (r.liked = liked.has(r.id)));
  }
  res.json({ posts: rows });
});

router.get('/posts/:id', authOptional, (req, res) => {
  const p = db.prepare(`SELECT p.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: '内容不存在' });
  res.json({ post: p });
});

// Publish a card/script to the homepage
router.post('/posts', authRequired, contentLimiter, (req, res) => {
  const b = req.body || {};
  // 防呆：此前只判 truthy，title: {} 能过关再到 better-sqlite3 抛 TypeError → 500。
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 120) {
    return res.status(400).json({ error: '标题必填（120字内）' });
  }
  // payload 走 jsonText：裸 JSON.stringify 对深层嵌套会抛 RangeError（V8 约 2 万层）
  // → 未捕获即 500。约 40KB 的 {"payload":[[[[…]]]]} 就能触发。
  const payload = b.payload ? jsonText(b.payload, 32768) : '';
  const info = db.prepare(`INSERT INTO posts (author_id, type, title, body, cover, character_id, payload, tags)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    req.user.id, b.type === 'script' ? 'script' : 'card', b.title.trim(), str(b.body, 20000),
    str(b.cover, 500) || null, clampInt(b.character_id, 1, Number.MAX_SAFE_INTEGER, null), payload, str(b.tags, 200)
  );
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.json({ post: p });
});

// Quick-publish an existing character as a card
router.post('/publish-character/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权发布' });
  const world = db.prepare('SELECT keys, content, enabled, position FROM world_entries WHERE character_id = ?').all(c.id);
  const payload = { name: c.name, avatar: c.avatar, background: c.background, background_type: c.background_type,
    tagline: c.tagline, intro: c.intro, greeting: c.greeting, persona: c.persona, tags: c.tags, world };
  db.prepare('UPDATE characters SET is_public = 1 WHERE id = ?').run(c.id);
  const info = db.prepare(`INSERT INTO posts (author_id, type, title, body, cover, character_id, payload, tags)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    req.user.id, 'card', c.name, c.tagline || c.intro.slice(0, 120), c.avatar, c.id, JSON.stringify(payload), c.tags
  );
  // 秒级广播给所有在线用户：有人发布新角色卡，第一时间在广场/角色库收到提示。
  broadcast('character_new', {
    character: {
      id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline || '',
      category: c.category || '', tags: c.tags || '', nsfw: !!c.nsfw, featured: !!c.featured,
      owner_id: c.owner_id, owner_name: req.user.display_name, owner_avatar: req.user.avatar || '',
      owner_tier: creatorTier(req.user.id), created_at: c.created_at,
    }
  }, req.user.id);
  res.json({ post: db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/posts/:id', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p || p.author_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.post('/posts/:id/like', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '内容不存在' });
  const exists = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(p.id, req.user.id);
  if (exists) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(p.id, req.user.id);
    db.prepare('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(p.id);
    return res.json({ liked: false, likes: p.likes - 1 });
  }
  db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').run(p.id, req.user.id);
  db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(p.id);
  bumpDaily(req.user.id, 'like');
  res.json({ liked: true, likes: p.likes + 1 });
});

// Import a published card into my own character library
router.post('/posts/:id/import', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '内容不存在' });
  let data = {};
  try { data = JSON.parse(p.payload || '{}'); } catch { /* payload 非法则落回帖子标题 */ }
  // 字段钳制对齐 characters.js /import：payload 来自公开帖子、可被作者构造，
  // 不能裸插入。名称必填、长度上限一致，世界书条目数封顶。
  const name = str(data.name, 60).trim() || str(p.title, 60).trim();
  if (!name) return res.status(400).json({ error: '角色卡缺少名称' });
  const world = Array.isArray(data.world) ? data.world.filter(w => w && typeof w === 'object').slice(0, 1000) : [];
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, tagline, intro, greeting, persona, tags, is_public)
    VALUES (?,?,?,?,?,?,?,?,?,?,0)`).run(
    req.user.id, name, str(data.avatar, 500) || null, str(data.background, 500) || null,
    ['image', 'color', 'video'].includes(data.background_type) ? data.background_type : 'image',
    str(data.tagline, 200), str(data.intro, 8000), str(data.greeting, 24000), str(data.persona, 24000), str(data.tags, 200)
  );
  if (world.length) {
    const stmt = db.prepare('INSERT INTO world_entries (character_id, keys, content, enabled, position) VALUES (?,?,?,?,?)');
    world.forEach((w, i) => stmt.run(info.lastInsertRowid, str(w.keys, 500), str(w.content, 24000), w.enabled === false ? 0 : 1, clampInt(i, 0, 100000, i)));
  }
  res.json({ character_id: info.lastInsertRowid });
});

// "Push to other players" — directed share into a user's inbox
router.post('/push', authRequired, contentLimiter, (req, res) => {
  const { post_id, to_username, note } = req.body || {};
  // 防呆：post_id / to_username 此前原样进查询 —— 传对象会被 better-sqlite3
  // 当成具名参数、传数组当成参数列表，两者都是 500。先收敛类型再查库。
  const postId = clampInt(post_id, 1, Number.MAX_SAFE_INTEGER, 0);
  const uname = str(to_username, 60);
  if (!postId || !uname) return res.status(400).json({ error: '参数无效' });
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: '内容不存在' });
  const target = db.prepare('SELECT id FROM users WHERE username = ? OR display_name = ?').get(uname, uname);
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  // 防呆：note 此前无长度上限（同文件其余写入都走 str(v,max)）—— 2MB 的备注可直接入库。
  db.prepare('INSERT INTO shares (post_id, from_user, to_user, note) VALUES (?,?,?,?)')
    .run(postId, req.user.id, target.id, str(note, 500));
  res.json({ ok: true });
});

// My inbox of received pushes
router.get('/inbox', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, p.title, p.type, p.cover, u.display_name AS from_name
    FROM shares s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = s.from_user
    WHERE s.to_user = ? ORDER BY s.created_at DESC`).all(req.user.id);
  res.json({ shares: rows });
});

router.post('/inbox/seen', authRequired, (req, res) => {
  db.prepare('UPDATE shares SET seen = 1 WHERE to_user = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
