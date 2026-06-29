import { Router } from'express';
import db from'../db.js';
import { authRequired, authOptional } from'../auth.js';
import { applyTx, notify } from'../wallet.js';

const router = Router();
const REFUND_WINDOW_MS = 30 * 60 * 1000; // 30 分钟内可退款

function owns(scriptId, userId) {
  if (!userId) return false;
  const s = db.prepare('SELECT author_id FROM scripts WHERE id = ?').get(scriptId);
  if (s && s.author_id === userId) return true;
  const p = db.prepare('SELECT id FROM script_purchases WHERE script_id = ? AND user_id = ? AND refunded = 0').get(scriptId, userId);
  return !!p;
}

router.get('/', authOptional, (req, res) => {
  const { category, q, sort } = req.query;
  let sql =`SELECT s.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM scripts s JOIN users u ON u.id = s.author_id WHERE 1=1`;
  const args = [];
  if (category && category !=='all') { sql +=' AND s.category = ?'; args.push(category); }
  if (q) { sql +=' AND (s.title LIKE ? OR s.tags LIKE ? OR s.summary LIKE ?)'; const k =`%${q}%`; args.push(k, k, k); }
  sql += sort ==='new' ?' ORDER BY s.created_at DESC' :' ORDER BY s.plays DESC, s.likes DESC';
  sql +=' LIMIT 100';
  res.json({ scripts: db.prepare(sql).all(...args) });
});

router.get('/mine', authRequired, (req, res) => {
  const created = db.prepare('SELECT * FROM scripts WHERE author_id = ? ORDER BY created_at DESC').all(req.user.id);
  const purchased = db.prepare(`SELECT s.*, sp.created_at AS bought_at, sp.refunded, sp.price AS paid
    FROM script_purchases sp JOIN scripts s ON s.id = sp.script_id
    WHERE sp.user_id = ? ORDER BY sp.id DESC`).all(req.user.id);
  res.json({ created, purchased });
});

router.get('/:id', authOptional, (req, res) => {
  const s = db.prepare(`SELECT s.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM scripts s JOIN users u ON u.id = s.author_id WHERE s.id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error:'剧本不存在' });
  const unlocked = s.price_gold === 0 || owns(s.id, req.user?.id);
  if (!unlocked) s.content =''; // hide paid content until purchased
  s.unlocked = unlocked;
  s.purchases = db.prepare('SELECT COUNT(*) n FROM script_purchases WHERE script_id = ? AND refunded = 0').get(s.id).n;
  res.json({ script: s });
});

router.post('/', authRequired, (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error:'标题必填' });
  const info = db.prepare(`INSERT INTO scripts (author_id,title,summary,cover,content,category,tags,price_gold,nsfw)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, b.title, b.summary ||'', b.cover || null, b.content ||'',
    b.category ||'', b.tags ||'', Math.max(0, parseInt(b.price_gold, 10) || 0), b.nsfw ? 1 : 0);
  res.json({ script: db.prepare('SELECT * FROM scripts WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', authRequired, (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s || s.author_id !== req.user.id) return res.status(403).json({ error:'无权编辑' });
  const b = req.body || {};
  db.prepare(`UPDATE scripts SET title=?, summary=?, cover=?, content=?, category=?, tags=?, price_gold=?, nsfw=? WHERE id=?`)
    .run(b.title ?? s.title, b.summary ?? s.summary, b.cover ?? s.cover, b.content ?? s.content,
      b.category ?? s.category, b.tags ?? s.tags, b.price_gold ?? s.price_gold, b.nsfw ? 1 : 0, s.id);
  res.json({ script: db.prepare('SELECT * FROM scripts WHERE id = ?').get(s.id) });
});

router.delete('/:id', authRequired, (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s || s.author_id !== req.user.id) return res.status(403).json({ error:'无权删除' });
  db.prepare('DELETE FROM scripts WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

// Purchase a paid script — gold flows from buyer to author.
const buyTx = db.transaction((buyer, script) => {
  applyTx(buyer, { kind:'buy_script', gold: -script.price_gold, memo:`购买剧本《${script.title}》` });
  applyTx(script.author_id, { kind:'sell_script', gold: script.price_gold, memo:`售出剧本《${script.title}》` });
  const info = db.prepare('INSERT INTO script_purchases (script_id, user_id, price) VALUES (?,?,?)').run(script.id, buyer, script.price_gold);
  db.prepare('UPDATE scripts SET plays = plays + 1 WHERE id = ?').run(script.id);
  return info.lastInsertRowid;
});

router.post('/:id/buy', authRequired, (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error:'剧本不存在' });
  if (s.author_id === req.user.id) return res.status(400).json({ error:'这是你自己的剧本' });
  if (owns(s.id, req.user.id)) return res.status(400).json({ error:'你已拥有该剧本' });
  if (s.price_gold === 0) { db.prepare('INSERT INTO script_purchases (script_id, user_id, price) VALUES (?,?,0)').run(s.id, req.user.id); return res.json({ ok: true, free: true }); }
  try {
    buyTx(req.user.id, s);
    notify(s.author_id,`有人购买了你的剧本《${s.title}》，+${s.price_gold} 金币`);
    res.json({ ok: true, refundable_until: Date.now() + REFUND_WINDOW_MS });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Refund within 30 minutes — reverses the gold flow.
const refundTx = db.transaction((p, script) => {
  applyTx(p.user_id, { kind:'refund', gold: p.price, memo:`退款剧本《${script.title}》` });
  applyTx(script.author_id, { kind:'refund', gold: -p.price, memo:`剧本《${script.title}》被退款` });
  db.prepare('UPDATE script_purchases SET refunded = 1 WHERE id = ?').run(p.id);
});

router.post('/:id/refund', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM script_purchases WHERE script_id = ? AND user_id = ? AND refunded = 0 ORDER BY id DESC')
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error:'未找到可退款的购买记录' });
  if (p.price === 0) return res.status(400).json({ error:'免费剧本无需退款' });
  const age = Date.now() - new Date(p.created_at +'Z').getTime();
  if (age > REFUND_WINDOW_MS) return res.status(400).json({ error:'已超过 30 分钟退款时限' });
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  refundTx(p, s);
  res.json({ ok: true });
});

router.post('/:id/like', authRequired, (req, res) => {
  const id = +req.params.id;
  const s = db.prepare('SELECT id FROM scripts WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: '剧本不存在' });
  // toggle 去重：已点赞则取消，未点赞则新增，PRIMARY KEY 原子防重复刷数。
  const exist = db.prepare('SELECT 1 FROM script_likes WHERE script_id = ? AND user_id = ?').get(id, req.user.id);
  if (exist) {
    db.prepare('DELETE FROM script_likes WHERE script_id = ? AND user_id = ?').run(id, req.user.id);
    db.prepare('UPDATE scripts SET likes = MAX(0, likes - 1) WHERE id = ?').run(id);
    res.json({ ok: true, liked: false });
  } else {
    db.prepare('INSERT OR IGNORE INTO script_likes (script_id, user_id) VALUES (?,?)').run(id, req.user.id);
    db.prepare('UPDATE scripts SET likes = likes + 1 WHERE id = ?').run(id);
    res.json({ ok: true, liked: true });
  }
});

// 进入剧本 · 开始互动扮演：以剧本内容作为主持人设定，开一条对话。
// 访问权限与「解锁」逻辑一致：作者 / 已购买者可进入；免费剧本人人可进。
// 复用调用者名下、按 tags=script:<id> 标记的私人「主持人」角色，避免每次进入都新建角色。
router.post('/:id/play', authRequired, (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '剧本不存在' });
  const isAuthor = s.author_id === req.user.id;
  const hasPurchased = !!db.prepare('SELECT 1 FROM script_purchases WHERE script_id = ? AND user_id = ? AND refunded = 0').get(s.id, req.user.id);
  if (!isAuthor && !hasPurchased && s.price_gold > 0) return res.status(403).json({ error: '请先购买该剧本' });

  const tag = `script:${s.id}`;
  let ch = db.prepare('SELECT * FROM characters WHERE owner_id = ? AND tags = ? AND is_public = 0 ORDER BY id DESC LIMIT 1').get(req.user.id, tag);
  if (!ch) {
    const info = db.prepare('INSERT INTO characters (owner_id, name, avatar, persona, greeting, tags, is_public, category) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.user.id, `剧本《${s.title}》`, s.cover || null,
        `你是一款互动剧本的主持人（Game Master）。请严格依据以下剧本设定引导玩家进行沉浸式角色扮演，推进剧情、描写场景、扮演除玩家以外的所有 NPC，不要替玩家发言：\n\n${s.content || s.summary || ''}`,
        s.summary ? `（剧本《${s.title}》开始）\n${s.summary}` : `（剧本《${s.title}》开始，请告诉我你的角色与行动。）`,
        tag, 0, s.category || '剧本');
    ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  }
  const info = db.prepare('INSERT INTO conversations (user_id, character_id, title) VALUES (?,?,?)').run(req.user.id, ch.id, s.title);
  if (ch.greeting) db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(info.lastInsertRowid, 'assistant', ch.greeting);
  db.prepare('UPDATE characters SET uses = uses + 1 WHERE id = ?').run(ch.id);
  db.prepare('UPDATE scripts SET plays = plays + 1 WHERE id = ?').run(s.id);
  res.json({ conversation: db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid) });
});

export default router;
