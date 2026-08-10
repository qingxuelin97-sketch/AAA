import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';
import { str } from '../validate.js';
import { broadcast } from '../realtime.js';
import { creatorTier } from '../creator.js';
import { notify } from '../wallet.js';

const router = Router();

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

// "Push to other players" — directed share into a user's inbox.
// 收 post_id（广场卡片）/ character_id（角色详情页入口）/ script_id（剧本
// 详情页入口）：后两者解析对应的最新卡片 post；从未有过卡片的公开内容就地
// 物化一张（作者=内容主人，不广播），保证收件箱 JOIN 恒成立。
router.post('/push', authRequired, contentLimiter, (req, res) => {
  const { post_id, character_id, script_id, to_username, note } = req.body || {};
  let post = null;
  if (post_id) {
    post = db.prepare('SELECT * FROM posts WHERE id = ?').get(post_id);
  } else if (script_id) {
    const sc = db.prepare('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL').get(script_id);
    if (!sc) return res.status(404).json({ error: '剧本不存在' });
    post = db.prepare('SELECT * FROM posts WHERE script_id = ? ORDER BY id DESC LIMIT 1').get(sc.id);
    if (!post) {
      const info = db.prepare(`INSERT INTO posts (author_id, type, title, body, cover, script_id, payload, tags)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        sc.author_id, 'script', sc.title, (sc.summary || '').slice(0, 120), sc.cover, sc.id, '', sc.tags || ''
      );
      post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
    }
  } else if (character_id) {
    const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(character_id);
    if (!c || !c.is_public) return res.status(404).json({ error: '角色不存在或未公开' });
    post = db.prepare('SELECT * FROM posts WHERE character_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
    if (!post) {
      const world = db.prepare('SELECT keys, content, enabled, position FROM world_entries WHERE character_id = ?').all(c.id);
      const payload = { name: c.name, avatar: c.avatar, background: c.background, background_type: c.background_type,
        tagline: c.tagline, intro: c.intro, greeting: c.greeting, persona: c.persona, tags: c.tags, world };
      const info = db.prepare(`INSERT INTO posts (author_id, type, title, body, cover, character_id, payload, tags)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        c.owner_id, 'card', c.name, c.tagline || (c.intro || '').slice(0, 120), c.avatar, c.id, JSON.stringify(payload), c.tags
      );
      post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
    }
  }
  if (!post) return res.status(404).json({ error: '内容不存在' });
  // 同 admin /gift：username 唯一，命中即用；display_name 重名要求用 id 消歧，
  // 否则推送会静默发给同名的另一个人。
  const key = String(to_username ?? '').trim();
  let target = db.prepare('SELECT id FROM users WHERE username = ?').get(key);
  if (!target) {
    const byDisplay = db.prepare('SELECT id FROM users WHERE display_name = ? LIMIT 2').all(key);
    if (byDisplay.length > 1) return res.status(409).json({ error: `有多个用户叫「${key}」，请改用用户 ID 指定` });
    target = byDisplay[0];
  }
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  db.prepare('INSERT INTO shares (post_id, from_user, to_user, note) VALUES (?,?,?,?)')
    .run(post.id, req.user.id, target.id, str(note, 200));
  // 收件人秒级得知：通知落库 + SSE，链接落到消息页收件箱 tab。
  if (target.id !== req.user.id) {
    const fromName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id)?.display_name || '有人';
    notify(target.id, `「${fromName}」向你推送了《${post.title}》`, '/messages');
  }
  res.json({ ok: true });
});

// My inbox of received pushes
router.get('/inbox', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, p.title, p.type, p.cover, p.character_id, p.script_id, u.display_name AS from_name
    FROM shares s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = s.from_user
    WHERE s.to_user = ? ORDER BY s.created_at DESC`).all(req.user.id);
  const unseen = db.prepare('SELECT COUNT(*) n FROM shares WHERE to_user = ? AND seen = 0').get(req.user.id).n;
  res.json({ shares: rows, unseen });
});

router.post('/inbox/seen', authRequired, (req, res) => {
  db.prepare('UPDATE shares SET seen = 1 WHERE to_user = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
