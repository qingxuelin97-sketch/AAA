import { Router } from'express';
import db from'../db.js';
import { authRequired } from'../auth.js';
import { applyTx, isVip, publicUser, GOLD_PER_DIAMOND, VIP_COST_GOLD, VIP_DAYS, notify } from'../wallet.js';

const router = Router();

// Recharge packages (diamonds). Payment is simulated for the demo.
export const PACKAGES = [
  { id:'p1', cny: 6, diamond: 60, bonus: 0 },
  { id:'p2', cny: 30, diamond: 300, bonus: 30 },
  { id:'p3', cny: 68, diamond: 680, bonus: 120 },
  { id:'p4', cny: 128, diamond: 1280, bonus: 320 },
  { id:'p5', cny: 328, diamond: 3280, bonus: 1080 },
  { id:'p6', cny: 648, diamond: 6480, bonus: 2880 }
];

router.get('/wallet', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ wallet: publicUser(u), transactions: txs, packages: PACKAGES,
    rates: { gold_per_diamond: GOLD_PER_DIAMOND, vip_cost: VIP_COST_GOLD, vip_days: VIP_DAYS } });
});

router.get('/packages', (req, res) => res.json({ packages: PACKAGES }));

// Simulated recharge — credits diamonds immediately.
router.post('/recharge', authRequired, (req, res) => {
  const pkg = PACKAGES.find(p => p.id === (req.body || {}).package_id);
  if (!pkg) return res.status(400).json({ error:'套餐不存在' });
  const total = pkg.diamond + pkg.bonus;
  const w = applyTx(req.user.id, { kind:'recharge', diamond: total, memo:`充值 ¥${pkg.cny} 获得 ${total} 钻石` });
  res.json({ wallet: w });
});

// Exchange diamonds -> gold (1 : 100)
router.post('/exchange', authRequired, (req, res) => {
  const n = parseInt((req.body || {}).diamond, 10);
  if (!n || n <= 0) return res.status(400).json({ error:'请输入有效的钻石数量' });
  try {
    const w = applyTx(req.user.id, { kind:'exchange', diamond: -n, gold: n * GOLD_PER_DIAMOND, memo:`${n} 钻石兑换为 ${n * GOLD_PER_DIAMOND} 金币` });
    res.json({ wallet: w });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Buy VIP with gold
router.post('/vip', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  try {
    applyTx(req.user.id, { kind:'vip', gold: -VIP_COST_GOLD, memo:`购买 ${VIP_DAYS} 天 VIP` });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
  const until = new Date(base + VIP_DAYS * 86400000).toISOString();
  db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(until, req.user.id);
  notify(req.user.id,`VIP 已开通，有效期至 ${until.slice(0, 10)}`);
  res.json({ wallet: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Daily check-in — VIP earns double, streak bonus.
router.post('/checkin', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const today = new Date().toISOString().slice(0, 10);
  if (u.last_checkin === today) return res.status(400).json({ error:'今天已经签到过啦' });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = u.last_checkin === yesterday ? (u.checkin_streak || 0) + 1 : 1;
  let reward = 100 + Math.min(streak, 7) * 20;
  if (isVip(u)) reward *= 2;
  db.prepare('UPDATE users SET last_checkin = ?, checkin_streak = ? WHERE id = ?').run(today, streak, req.user.id);
  const w = applyTx(req.user.id, { kind:'checkin', gold: reward, memo:`第 ${streak} 天签到` });
  res.json({ wallet: w, reward, streak });
});

router.get('/transactions', authRequired, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ transactions: txs });
});

// Redeem a gift / invite code for an existing user
router.post('/redeem', authRequired, (req, res) => {
  const code = String((req.body || {}).code ||'').trim();
  const key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code);
  if (!key) return res.status(400).json({ error:'密钥无效' });
  if (key.used >= key.max_uses) return res.status(400).json({ error:'该密钥已用完' });
  db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ?').run(code);
  if (key.grant_gold || key.grant_diamond)
    applyTx(req.user.id, { kind:'reward', gold: key.grant_gold, diamond: key.grant_diamond, memo:`兑换码 ${code}` });
  if (key.grant_vip_days) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + key.grant_vip_days * 86400000).toISOString(), req.user.id);
  }
  res.json({ wallet: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default router;
