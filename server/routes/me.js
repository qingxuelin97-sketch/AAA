import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, notify } from '../wallet.js';
import { creatorWorks } from '../creator.js';

const router = Router();

// ---- creator revenue-share program (创作者收益分成计划) ----
// 分成基数 = 其他用户在该创作者作品上真实花掉的金币（平台对话费 + 语音费，按 ref_owner 归属）。
const REV_TIERS = [
  { id: 'seed', name: '萌新创作者', min: 0, rate: 0.50 },
  { id: 'bronze', name: '铜牌创作者', min: 500, rate: 0.55 },
  { id: 'silver', name: '银牌创作者', min: 2000, rate: 0.60 },
  { id: 'gold', name: '金牌创作者', min: 8000, rate: 0.65 },
  { id: 'hall', name: '殿堂创作者', min: 30000, rate: 0.70 },
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
function incomeSeries(uid, days = 14) {
  const txs = db.prepare('SELECT gold, created_at FROM transactions WHERE user_id = ? AND gold > 0').all(uid);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d.slice(5), gold: txs.filter(t => (t.created_at || '').slice(0, 10) === d).reduce((s, t) => s + t.gold, 0) });
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
  res.json({ ok: true, reward: amount, wallet: w, plan: revenuePlan(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

export default router;
