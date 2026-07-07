import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, notify } from '../wallet.js';
import { creatorWorks } from '../creator.js';
import { log } from '../logger.js';

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
  const total = db.prepare("SELECT COALESCE(SUM(-gold),0) n FROM transactions WHERE ref_owner = ? AND kind IN ('ai_fee','voice_fee') AND gold < 0").get(uid).n;
  const mo = db.prepare("SELECT COALESCE(SUM(-gold),0) n FROM transactions WHERE ref_owner = ? AND kind IN ('ai_fee','voice_fee') AND gold < 0 AND substr(created_at,1,7) = ?").get(uid, month).n;
  return { total, month: mo };
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
function incomeSeries(uid, days = 14) {
  const txs = db.prepare('SELECT gold, kind, created_at FROM transactions WHERE user_id = ? AND gold > 0').all(uid);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const dayTxs = txs.filter(t => (t.created_at || '').slice(0, 10) === d);
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
  const chars = db.prepare('SELECT * FROM characters WHERE owner_id = ?').all(uid);
  const charRows = chars.map(c => ({
    id: c.id, name: c.name, avatar: c.avatar, is_public: !!c.is_public, uses: c.uses || 0, likes: c.likes || 0,
    favs: db.prepare('SELECT COUNT(*) n FROM favorites WHERE character_id = ?').get(c.id).n,
  }));
  const scripts = db.prepare('SELECT * FROM scripts WHERE author_id = ?').all(uid);
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
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const plan = revenuePlan(u);
  if (!plan.claimable) return res.status(400).json({ error: '暂无可领取的分成；当用户在你的作品上消费金币后即可分成' });
  const amount = plan.claimable_amount;
  db.prepare('UPDATE users SET rev_claimed_total = COALESCE(rev_claimed_total,0) + ? WHERE id = ?').run(amount, u.id);
  const w = applyTx(u.id, { kind: 'revenue_share', gold: amount, memo: `创作者分成（${plan.tier_name} · ${Math.round(plan.rate * 100)}%）` });
  notify(u.id, `💰 创作者收益分成 ${amount} 金币已到账（${plan.tier_name}）`, '/studio');
  log({
    level: 'info', category: 'economy', event: 'revenue_claim',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { amount, tier: plan.tier, tier_name: plan.tier_name, rate: plan.rate, pool_total: plan.pool_total },
    message: `用户 ${req.user.id} 领取创作者分成 ${amount} 金币（${plan.tier_name}）`,
  });
  res.json({ ok: true, reward: amount, wallet: w, plan: revenuePlan(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
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
  const perDay = Object.fromEntries(all(`SELECT substr(m.created_at, 1, 10) d, COUNT(*) n
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.created_at >= datetime('now', '-14 days')
    GROUP BY d`, uid).map(r => [r.d, r.n]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
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
    characters: one('SELECT COUNT(*) n FROM characters WHERE owner_id = ?', uid).n || 0,
    worldbooks: one('SELECT COUNT(*) n FROM worldbooks WHERE owner_id = ?', uid).n || 0,
    scripts: one('SELECT COUNT(*) n FROM scripts WHERE author_id = ?', uid).n || 0,
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

export default router;
