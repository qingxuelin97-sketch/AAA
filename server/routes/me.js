import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, assertEconomicAccess, notify } from '../wallet.js';
import { creatorWorks } from '../creator.js';
import { log } from '../logger.js';
import { cnToday } from '../daily.js';

// 剧本自动生成的「主持人」卡不算用户自己的角色。
// scripts.js 的 /play 会为每个剧本建一张 tags = 'script:<id>' 的私有角色作为 GM，
// 那是实现细节，不是用户创作 —— 但「我的角色库」「创作中心」「成就计数」此前都
// 没有排除它，于是每玩一个剧本，角色库里就多一张幽灵卡，创作数与成就也跟着虚高。
// mock 一直用 from_script 字段过滤，可真后端根本没有这一列（全仓 grep 为 0），
// 照 mock 的写法搬过来会直接失效 —— 真后端只能按 tags 前缀判。
const NOT_SCRIPT_CARD = "AND (tags IS NULL OR tags NOT LIKE 'script:%')";

const router = Router();

// ---- creator revenue-share program (创作者收益分成计划) ----
// 分成基数 = 其他用户在该创作者作品上真实花掉的金币（平台对话费 + 语音费，按 ref_owner 归属）。
const REV_TIERS = [
  { id: 'seed', name: '萌新创作者', min: 0, rate: 0.20 },
  { id: 'bronze', name: '铜牌创作者', min: 500, rate: 0.28 },
  { id: 'silver', name: '银牌创作者', min: 2000, rate: 0.35 },
  { id: 'gold', name: '金牌创作者', min: 8000, rate: 0.43 },
  { id: 'hall', name: '殿堂创作者', min: 30000, rate: 0.50 },
];
const revTierOf = (pool) => [...REV_TIERS].reverse().find(t => pool >= t.min) || REV_TIERS[0];
function creatorSpendPool(uid) {
  const month = new Date().toISOString().slice(0, 7);
  // Failed AI/TTS calls leave a linked fee/refund pair with the same ref_owner.
  // Reserved fees are hidden via share_eligible until success; a refund makes
  // both sides visible atomically, so a creator can never claim during the
  // temporary charge window or grow the pool with zero-net failures.
  const kinds = "('ai_fee','voice_fee','ai_refund','voice_refund')";
  const total = db.prepare(`SELECT COALESCE(SUM(-gold),0) n FROM transactions
    WHERE ref_owner = ? AND share_eligible = 1 AND kind IN ${kinds}`).get(uid).n;
  const mo = db.prepare(`SELECT COALESCE(SUM(-gold),0) n FROM transactions
    WHERE ref_owner = ? AND share_eligible = 1 AND kind IN ${kinds} AND substr(created_at,1,7) = ?`).get(uid, month).n;
  return { total: Math.max(0, total), month: Math.max(0, mo) };
}
function revenuePlan(u) {
  const pool = creatorSpendPool(u.id);
  const tier = revTierOf(pool.total);
  const entitled = Math.floor(pool.total * tier.rate);
  const claimed = u.rev_claimed_total || 0;
  const claimable_amount = Math.max(0, entitled - claimed);
  return { pool_total: pool.total, pool_month: pool.month, works: creatorWorks(u.id),
    tier: tier.id, tier_name: tier.name, rate: tier.rate, entitled, claimed, claimable_amount,
    claimable: claimable_amount > 0, tiers: REV_TIERS, next: REV_TIERS.find(t => t.min > pool.total) || null };
}
// 创作者收入明细序列：按天 + 按来源拆分，供创作中心展示「每段情况」。
// 来源分类：sell_script 剧本销售 / revenue_share 分成领取 / other 其他（签到/任务/成就/活动等）。
// 日期口径统一走北京日（cnToday）。
// 原来这里按 UTC 日切桶，而同一个响应体里的 /weekly 走的是北京日 —— 用户在
// 00:00–08:00（北京）产生的记录会被算进「昨天」，于是收入曲线与周报对不上，
// 且没有任何报错。created_at 是 SQLite 的 datetime('now')，即 UTC 串。
function incomeSeries(uid, days = 14) {
  const txs = db.prepare('SELECT gold, kind, created_at FROM transactions WHERE user_id = ? AND gold > 0').all(uid);
  const cnDayOf = (ts) => (ts ? cnToday(new Date(String(ts).replace(' ', 'T') + 'Z')) : '');
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = cnToday(new Date(Date.now() - i * 86400000));
    const dayTxs = txs.filter(t => cnDayOf(t.created_at) === d);
    const sell = dayTxs.filter(t => t.kind === 'sell_script').reduce((s, t) => s + t.gold, 0);
    const share = dayTxs.filter(t => t.kind === 'revenue_share').reduce((s, t) => s + t.gold, 0);
    const other = dayTxs.filter(t => t.kind !== 'sell_script' && t.kind !== 'revenue_share').reduce((s, t) => s + t.gold, 0);
    out.push({ date: d.slice(5), gold: sell + share + other, sell_script: sell, revenue_share: share, other });
  }
  return out;
}

// Creator dashboard (创作中心) — aggregate stats + analytics series.
router.get('/studio', authRequired, (req, res) => {
  const uid = req.user.id;
  const chars = db.prepare(`SELECT * FROM characters WHERE owner_id = ? ${NOT_SCRIPT_CARD}`).all(uid);
  const charRows = chars.map(c => ({
    id: c.id, name: c.name, avatar: c.avatar, is_public: !!c.is_public, uses: c.uses || 0, likes: c.likes || 0,
    favs: db.prepare('SELECT COUNT(*) n FROM favorites WHERE character_id = ?').get(c.id).n,
  }));
  const scripts = db.prepare('SELECT * FROM scripts WHERE author_id = ? AND deleted_at IS NULL').all(uid);
  const scriptRows = scripts.map(s => {
    let purchases = [];
    try { purchases = db.prepare('SELECT price FROM script_purchases WHERE script_id = ? AND COALESCE(refunded,0) = 0').all(s.id); } catch { purchases = []; }
    return { id: s.id, title: s.title, cover: s.cover, price_gold: s.price_gold || 0, plays: s.plays || 0, likes: s.likes || 0,
      sales: purchases.filter(p => (p.price || 0) > 0).length, revenue: purchases.reduce((a, p) => a + (p.price || 0), 0) };
  });
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const totals = {
    char_count: charRows.length, char_uses: sum(charRows, 'uses'), char_likes: sum(charRows, 'likes'), char_favs: sum(charRows, 'favs'),
    script_count: scriptRows.length, script_plays: sum(scriptRows, 'plays'), script_sales: sum(scriptRows, 'sales'),
    gold_earned: sum(scriptRows, 'revenue'), followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE following_id = ?').get(uid).n,
  };
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ totals, characters: charRows.sort((a, b) => b.uses - a.uses), scripts: scriptRows.sort((a, b) => b.revenue - a.revenue), series: incomeSeries(uid, 14), revenue_plan: revenuePlan(u) });
});

router.get('/revenue-plan', authRequired, (req, res) => {
  res.json({ plan: revenuePlan(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});
router.post('/revenue-plan/claim', authRequired, (req, res) => {
  let amount, plan, w;
  try {
    // IMMEDIATE 事务内重读并重算分成：并发/多进程下第二次领取读到更新后的 rev_claimed_total
    // → claimable 为假而拒绝，杜绝重复领取；累计与发奖一并原子提交。
    db.transaction(() => {
      assertEconomicAccess(req.user.id);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      plan = revenuePlan(u);
      if (!plan.claimable) throw Object.assign(new Error('暂无可领取的分成；当用户在你的作品上消费金币后即可分成'), { status: 400, expose: true });
      amount = plan.claimable_amount;
      db.prepare('UPDATE users SET rev_claimed_total = COALESCE(rev_claimed_total,0) + ? WHERE id = ?').run(amount, u.id);
      w = applyTx(u.id, { kind: 'revenue_share', gold: amount, memo: `创作者分成（${plan.tier_name} · ${Math.round(plan.rate * 100)}%）` });
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
  notify(req.user.id, `💰 创作者收益分成 ${amount} 金币已到账（${plan.tier_name}）`, '/studio');
  log({
    level: 'info', category: 'economy', event: 'revenue_claim',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { amount, tier: plan.tier, tier_name: plan.tier_name, rate: plan.rate, pool_total: plan.pool_total },
    message: `用户 ${req.user.id} 领取创作者分成 ${amount} 金币（${plan.tier_name}）`,
  });
  res.json({ ok: true, reward: amount, wallet: w, plan: revenuePlan(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// 星轨 · 个人旅程数据（/insights 页）——聊天足迹、羁绊角色、创作与经济全景。
// 全部由现有表聚合而来，只读不写；任何一项查询失败都不该拖垮整页，故逐项兜底。
router.get('/insights', authRequired, (req, res) => {
  const uid = req.user.id;
  const one = (sql, ...args) => { try { return db.prepare(sql).get(...args) || {}; } catch { return {}; } };
  const all = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch { return []; } };

  const u = one('SELECT created_at, gold, diamond, checkin_streak FROM users WHERE id = ?', uid);

  // —— 聊天足迹 ——
  const msg = one(`SELECT COUNT(*) n,
      SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN m.role != 'user' THEN 1 ELSE 0 END) received
    FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ?`, uid);
  const convCount = one('SELECT COUNT(*) n FROM conversations WHERE user_id = ?', uid).n || 0;
  const activeDays = one(`SELECT COUNT(DISTINCT substr(m.created_at, 1, 10)) n
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.role = 'user'`, uid).n || 0;

  // 近 14 天逐日消息量（含 0 的日子，前端画条形图）。
  // 同样按北京日分桶（date(..., '+8 hours')），与 /weekly、签到日历、收入曲线一致。
  const perDay = Object.fromEntries(all(`SELECT date(m.created_at, '+8 hours') d, COUNT(*) n
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.created_at >= datetime('now', '-14 days')
    GROUP BY d`, uid).map(r => [r.d, r.n]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = cnToday(new Date(Date.now() - i * 86400000));
    days.push({ date: d.slice(5), n: perDay[d] || 0 });
  }

  // —— 羁绊最深的角色（按消息量 Top 5）——
  const companions = all(`SELECT ch.id, ch.name, ch.avatar, COUNT(m.id) n,
      MIN(m.created_at) first_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN characters ch ON ch.id = c.character_id
    WHERE c.user_id = ?
    GROUP BY ch.id ORDER BY n DESC LIMIT 5`, uid);

  // —— 创作全景 ——
  const creations = {
    characters: one(`SELECT COUNT(*) n FROM characters WHERE owner_id = ? ${NOT_SCRIPT_CARD}`, uid).n || 0,
    worldbooks: one('SELECT COUNT(*) n FROM worldbooks WHERE owner_id = ?', uid).n || 0,
    scripts: one('SELECT COUNT(*) n FROM scripts WHERE author_id = ? AND deleted_at IS NULL', uid).n || 0,
    novels: one('SELECT COUNT(*) n FROM novels WHERE owner_id = ?', uid).n || 0,
    images: one('SELECT COUNT(*) n FROM ai_images WHERE user_id = ?', uid).n || 0,
    favorites: one('SELECT COUNT(*) n FROM favorites WHERE user_id = ?', uid).n || 0,
  };

  // —— 经济脉络 ——
  const economy = {
    gold: u.gold || 0, diamond: u.diamond || 0,
    earned: one('SELECT COALESCE(SUM(gold),0) n FROM transactions WHERE user_id = ? AND gold > 0', uid).n || 0,
    spent: -(one('SELECT COALESCE(SUM(gold),0) n FROM transactions WHERE user_id = ? AND gold < 0', uid).n || 0),
  };

  // —— 社交 ——
  const social = {
    followers: one('SELECT COUNT(*) n FROM follows WHERE following_id = ?', uid).n || 0,
    following: one('SELECT COUNT(*) n FROM follows WHERE follower_id = ?', uid).n || 0,
    friends: one('SELECT COUNT(*) n FROM friendships WHERE a_id = ? OR b_id = ?', uid, uid).n || 0,
  };

  res.json({
    since: (u.created_at || '').slice(0, 10),
    streak: u.checkin_streak || 0,
    chat: { conversations: convCount, messages: msg.n || 0, sent: msg.sent || 0, received: msg.received || 0, active_days: activeDays },
    days, companions, creations, economy, social,
  });
});

// 本周回顾（今日页「本周与你相伴」卡）——北京周界（周一为一周之始），只读聚合。
// 与 /economy/checkin/calendar 同口径：created_at 是 sqlite datetime('now') 的
// 'YYYY-MM-DD HH:MM:SS' UTC 串，北京周界折 -8h 成同构边界串后字典序比较。
router.get('/weekly', authRequired, (req, res) => {
  const uid = req.user.id;
  const one = (sql, ...args) => { try { return db.prepare(sql).get(...args) || {}; } catch { return {}; } };
  const all = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch { return []; } };

  const today = cnToday();
  const t = new Date(today + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7; // 0 = 周一
  const weekStartMs = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - dow);
  const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
  const sqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const utcStart = sqliteUtc(weekStartMs - 8 * 3600e3);
  const utcEnd = sqliteUtc(weekStartMs + 7 * 86400000 - 8 * 3600e3);

  // 逐日消息量（自己会话内双向消息都算「相伴」），按北京日归桶；未来天保持 0。
  const msgRows = all(`SELECT m.created_at, m.role FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.created_at >= ? AND m.created_at < ?`, uid, utcStart, utcEnd);
  const perDay = {};
  let sent = 0;
  for (const r of msgRows) {
    const d = cnToday(new Date(String(r.created_at).replace(' ', 'T') + 'Z'));
    perDay[d] = (perDay[d] || 0) + 1;
    if (r.role === 'user') sent += 1;
  }
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs + i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d.slice(5), n: perDay[d] || 0 });
  }

  // 本周最相伴的角色（消息量第一名；并列取先创建的会话侧）。
  const companion = one(`SELECT ch.id, ch.name, ch.avatar, COUNT(m.id) n FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN characters ch ON ch.id = c.character_id
    WHERE c.user_id = ? AND m.created_at >= ? AND m.created_at < ?
    GROUP BY ch.id ORDER BY n DESC, ch.id ASC LIMIT 1`, uid, utcStart, utcEnd);

  const tx = one(`SELECT
      COALESCE(SUM(CASE WHEN gold > 0 THEN gold ELSE 0 END), 0) earned,
      COALESCE(SUM(CASE WHEN gold < 0 THEN -gold ELSE 0 END), 0) spent,
      COALESCE(SUM(CASE WHEN kind = 'checkin' THEN 1 ELSE 0 END), 0) checkins
    FROM transactions WHERE user_id = ? AND created_at >= ? AND created_at < ?`, uid, utcStart, utcEnd);
  const newFriends = one(`SELECT COUNT(*) n FROM friendships
    WHERE (a_id = ? OR b_id = ?) AND created_at >= ? AND created_at < ?`, uid, uid, utcStart, utcEnd).n || 0;
  const u = one('SELECT checkin_streak FROM users WHERE id = ?', uid);

  res.json({
    week_start: weekStart, today, days,
    messages: msgRows.length, sent, active_days: days.filter((d) => d.n > 0).length,
    checkins: tx.checkins || 0, streak: u.checkin_streak || 0,
    gold_earned: tx.earned || 0, gold_spent: tx.spent || 0,
    new_friends: newFriends,
    companion: companion.id ? companion : null,
  });
});

export default router;
