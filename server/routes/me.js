import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, notify } from '../wallet.js';
import { creatorScore, creatorWorks } from '../creator.js';

const router = Router();

// ---- creator revenue-share program (创作者收益分成计划) ----
const REV_TIERS = [
  { id: 'seed', name: '萌新创作者', min: 0, rate: 0.15 },
  { id: 'bronze', name: '铜牌创作者', min: 500, rate: 0.18 },
  { id: 'silver', name: '银牌创作者', min: 1500, rate: 0.22 },
  { id: 'gold', name: '金牌创作者', min: 5000, rate: 0.26 },
  { id: 'hall', name: '殿堂创作者', min: 15000, rate: 0.30 },
];
const REV_CAP = 5000;
const revTierOf = (score) => [...REV_TIERS].reverse().find(t => score >= t.min) || REV_TIERS[0];
function revenuePlan(u) {
  const score = creatorScore(u.id);
  const tier = revTierOf(score);
  const estimate = Math.min(REV_CAP, Math.round(score * tier.rate));
  const month = new Date().toISOString().slice(0, 7);
  const claimed = u.rev_claim_month === month;
  return { score, works: creatorWorks(u.id), tier: tier.id, tier_name: tier.name, rate: tier.rate,
    estimate, cap: REV_CAP, month, claimed, claimable: estimate > 0 && !claimed, tiers: REV_TIERS, next: REV_TIERS.find(t => t.min > score) || null };
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
  if (!plan.claimable) return res.status(400).json({ error: plan.claimed ? '本月激励已领取，下月再来' : '当前暂无可领取的激励，多创作高人气作品吧' });
  db.prepare('UPDATE users SET rev_claim_month = ? WHERE id = ?').run(plan.month, u.id);
  const w = applyTx(u.id, { kind: 'revenue_share', gold: plan.estimate, memo: `创作者分成 · ${plan.month}（${plan.tier_name}）` });
  notify(u.id, `💰 创作者收益分成 ${plan.estimate} 金币已到账（${plan.tier_name}）`, '/studio');
  res.json({ ok: true, reward: plan.estimate, wallet: w, plan: revenuePlan(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

export default router;
