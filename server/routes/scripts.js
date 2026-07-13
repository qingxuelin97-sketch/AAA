import { Router } from'express';
import db from'../db.js';
import { authRequired, authOptional } from'../auth.js';
import { applyTx, notify } from'../wallet.js';

const router = Router();
const REFUND_WINDOW_MS = 30 * 60 * 1000; // 30 分钟内可退款
const MAX_SCRIPT_PRICE = Number(process.env.MAX_SCRIPT_PRICE_GOLD) || 1_000_000;
function scriptPrice(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const price = Number(value);
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_SCRIPT_PRICE) {
    throw Object.assign(new Error(`剧本价格必须是 0 至 ${MAX_SCRIPT_PRICE} 的整数`), { status: 400, expose: true });
  }
  return price;
}

// Funds stay in platform escrow throughout the refund window. Settlement is
// demand-driven by marketplace traffic and remains exactly-once transactionally.
const settleDuePurchases = db.transaction(() => {
  const due = db.prepare(`SELECT sp.*, s.author_id, s.title FROM script_purchases sp
    JOIN scripts s ON s.id = sp.script_id
    WHERE sp.refunded = 0 AND sp.settled_at IS NULL AND sp.settlement_due_at IS NOT NULL AND sp.settlement_due_at <= ?
    ORDER BY sp.id LIMIT 100`).all(Date.now());
  for (const purchase of due) {
    const claimed = db.prepare('UPDATE script_purchases SET settled_at = ? WHERE id = ? AND settled_at IS NULL AND refunded = 0')
      .run(Date.now(), purchase.id);
    if (claimed.changes !== 1) continue;
    applyTx(purchase.author_id, { kind: 'sell_script', gold: purchase.price, memo: `售出剧本《${purchase.title}》` });
  }
  return due.length;
});

function owns(scriptId, userId) {
  if (!userId) return false;
  const s = db.prepare('SELECT author_id FROM scripts WHERE id = ?').get(scriptId);
  if (s && s.author_id === userId) return true;
  const p = db.prepare('SELECT id FROM script_purchases WHERE script_id = ? AND user_id = ? AND refunded = 0').get(scriptId, userId);
  return !!p;
}

router.get('/', authOptional, (req, res) => {
  settleDuePurchases();
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
  settleDuePurchases();
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
  let price;
  try { price = scriptPrice(b.price_gold); } catch (err) { return res.status(err.status || 400).json({ error: err.message }); }
  const info = db.prepare(`INSERT INTO scripts (author_id,title,summary,cover,content,category,tags,price_gold,nsfw)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, b.title, b.summary ||'', b.cover || null, b.content ||'',
    b.category ||'', b.tags ||'', price, b.nsfw ? 1 : 0);
  res.json({ script: db.prepare('SELECT * FROM scripts WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', authRequired, (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s || s.author_id !== req.user.id) return res.status(403).json({ error:'无权编辑' });
  const b = req.body || {};
  let price;
  try { price = scriptPrice(b.price_gold, s.price_gold); } catch (err) { return res.status(err.status || 400).json({ error: err.message }); }
  db.prepare(`UPDATE scripts SET title=?, summary=?, cover=?, content=?, category=?, tags=?, price_gold=?, nsfw=? WHERE id=?`)
    .run(b.title ?? s.title, b.summary ?? s.summary, b.cover ?? s.cover, b.content ?? s.content,
      b.category ?? s.category, b.tags ?? s.tags, price, b.nsfw === undefined ? s.nsfw : (b.nsfw ? 1 : 0), s.id);
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
  const dueAt = Date.now() + REFUND_WINDOW_MS;
  const info = db.prepare(`INSERT INTO script_purchases
    (script_id, user_id, price, settlement_due_at, settled_at) VALUES (?,?,?,?,NULL)`)
    .run(script.id, buyer, script.price_gold, dueAt);
  applyTx(buyer, { kind:'buy_script', gold: -script.price_gold, memo:`购买剧本《${script.title}》` });
  db.prepare('UPDATE scripts SET plays = plays + 1 WHERE id = ?').run(script.id);
  return { id: info.lastInsertRowid, dueAt };
});

router.post('/:id/buy', authRequired, (req, res) => {
  settleDuePurchases();
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error:'剧本不存在' });
  if (s.author_id === req.user.id) return res.status(400).json({ error:'这是你自己的剧本' });
  if (owns(s.id, req.user.id)) return res.status(400).json({ error:'你已拥有该剧本' });
  if (s.price_gold === 0) {
    db.prepare('INSERT INTO script_purchases (script_id, user_id, price, settled_at) VALUES (?,?,0,?)').run(s.id, req.user.id, Date.now());
    return res.json({ ok: true, free: true });
  }
  // 反刷币冷静期：付费购买是全站唯一「金币在用户间流动」的通道 —— 批量小号
  // 领完新手金币/活动礼包立刻购买同伙的付费剧本即可汇币。注册未满 24h 只封
  // 这一个动作：免费剧本、对话、抽卡等平台内消费一律不受影响。
  const me = db.prepare('SELECT created_at FROM users WHERE id = ?').get(req.user.id);
  if (me && Date.now() - new Date(me.created_at + 'Z').getTime() < 86_400_000) {
    return res.status(403).json({ error: '新注册账号需满 24 小时才能购买付费剧本（平台防刷策略）' });
  }
  try {
    const purchase = buyTx(req.user.id, s);
    notify(s.author_id, `有人购买了你的剧本《${s.title}》，款项将在退款期结束后结算`);
    res.json({ ok: true, refundable_until: purchase.dueAt });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Refund within 30 minutes — reverses the gold flow.
const refundTx = db.transaction((p, script) => {
  const claimed = db.prepare('UPDATE script_purchases SET refunded = 1 WHERE id = ? AND refunded = 0 AND settled_at IS NULL').run(p.id);
  if (claimed.changes !== 1) throw Object.assign(new Error('该订单已结算或已退款'), { status: 409, expose: true });
  applyTx(p.user_id, { kind:'refund', gold: p.price, memo:`退款剧本《${script.title}》` });
});

router.post('/:id/refund', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM script_purchases WHERE script_id = ? AND user_id = ? AND refunded = 0 ORDER BY id DESC')
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error:'未找到可退款的购买记录' });
  if (p.price === 0) return res.status(400).json({ error:'免费剧本无需退款' });
  const age = Date.now() - new Date(p.created_at +'Z').getTime();
  if (age > REFUND_WINDOW_MS) return res.status(400).json({ error:'已超过 30 分钟退款时限' });
  const s = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  try {
    refundTx(p, s);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
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
