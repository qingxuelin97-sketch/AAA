import { Router } from'express';
import rateLimit from 'express-rate-limit';
import db from'../db.js';
import { authRequired } from'../auth.js';
import { applyTx, isVip, publicUser, GOLD_PER_DIAMOND, VIP_COST_GOLD, VIP_DAYS, notify } from'../wallet.js';
import { bumpDaily, cnToday } from '../daily.js';
import { log } from '../logger.js';

const router = Router();

// VIP 档位：周卡 / 月卡（特惠推荐）/ 季卡。金币计价，越长越划算。
// month 档保持与旧常量一致（VIP_COST_GOLD / VIP_DAYS），无 plan 参数时回退到 month，
// 老调用（钱包页 /economy/vip 无 body）行为不变。
export const VIP_PLANS = {
  week:   { id: 'week',   label: '周卡', days: 7,        gold: 8000 },
  month:  { id: 'month',  label: '月卡', days: VIP_DAYS, gold: VIP_COST_GOLD },
  season: { id: 'season', label: '季卡', days: 90,       gold: 78000 }
};

// 兑换码：每分钟最多 5 次/IP，防爆破。
const redeemLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: '兑换尝试过于频繁，请稍后再试' } });

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
    rates: { gold_per_diamond: GOLD_PER_DIAMOND, vip_cost: VIP_COST_GOLD, vip_days: VIP_DAYS,
      vip_plans: Object.values(VIP_PLANS) } });
});

router.get('/packages', (req, res) => res.json({ packages: PACKAGES }));

// Simulated recharge — credits diamonds immediately.
router.post('/recharge', authRequired, (req, res) => {
  const pkg = PACKAGES.find(p => p.id === (req.body || {}).package_id);
  if (!pkg) return res.status(400).json({ error:'套餐不存在' });
  // 模拟支付门控：生产环境必须显式开启 PAYMENT_ENABLED=true 才能充值，避免白嫖。
  if (process.env.PAYMENT_ENABLED !== 'true') {
    return res.status(503).json({ error: '在线支付尚未开启，演示环境充值已禁用' });
  }
  const total = pkg.diamond + pkg.bonus;
  const w = applyTx(req.user.id, { kind:'recharge', diamond: total, memo:`充值 ¥${pkg.cny} 获得 ${total} 钻石` });
  log({ level: 'info', category: 'economy', event: 'recharge',
    message: `用户充值 ${total} 钻石`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { package_id: pkg.id, cny: pkg.cny, diamond: pkg.diamond, bonus: pkg.bonus, total } });
  res.json({ wallet: w });
});

// Exchange diamonds -> gold (1 : 100)
router.post('/exchange', authRequired, (req, res) => {
  const n = parseInt((req.body || {}).diamond, 10);
  if (!n || n <= 0) return res.status(400).json({ error:'请输入有效的钻石数量' });
  if (n > 1_000_000) return res.status(400).json({ error:'单次兑换上限 100 万钻石' });
  try {
    const w = applyTx(req.user.id, { kind:'exchange', diamond: -n, gold: n * GOLD_PER_DIAMOND, memo:`${n} 钻石兑换为 ${n * GOLD_PER_DIAMOND} 金币` });
    log({ level: 'info', category: 'economy', event: 'exchange',
      message: `用户兑换 ${n} 钻石为 ${n * GOLD_PER_DIAMOND} 金币`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { diamond: n, gold: n * GOLD_PER_DIAMOND } });
    res.json({ wallet: w });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Buy VIP with gold. 可选 plan（week/month/season）；缺省 month（向后兼容）。
router.post('/vip', authRequired, (req, res) => {
  const plan = VIP_PLANS[(req.body || {}).plan] || VIP_PLANS.month;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  try {
    applyTx(req.user.id, { kind:'vip', gold: -plan.gold, memo:`购买 ${plan.days} 天 VIP（${plan.label}）` });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
  const until = new Date(base + plan.days * 86400000).toISOString();
  db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(until, req.user.id);
  notify(req.user.id,`VIP 已开通，有效期至 ${until.slice(0, 10)}`);
  log({ level: 'info', category: 'economy', event: 'vip',
    message: `用户购买 VIP ${plan.label}（${plan.days} 天）`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { plan: plan.id, gold: plan.gold, vip_days: plan.days, vip_until: until } });
  res.json({ wallet: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Daily check-in — VIP earns double, streak bonus. 用条件 UPDATE 原子化防并发重复签到。
router.post('/checkin', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const today = cnToday();
  if (u.last_checkin === today) return res.status(400).json({ error:'今天已经签到过啦' });
  const yesterday = cnToday(new Date(Date.now() - 86400000));
  const streak = u.last_checkin === yesterday ? (u.checkin_streak || 0) + 1 : 1;
  // 每日签到金币：50 / 100 / 200，概率 33% / 50% / 17%（VIP 翻倍）
  const roll = Math.random(); let reward = roll < 0.33 ? 50 : roll < 0.83 ? 100 : 200;
  if (isVip(u)) reward *= 2;
  // 仅当今天尚未签到时才更新；并发请求只有一个能成功。
  const upd = db.prepare('UPDATE users SET last_checkin = ?, checkin_streak = ? WHERE id = ? AND last_checkin != ?').run(today, streak, req.user.id, today);
  if (upd.changes === 0) return res.status(400).json({ error:'今天已经签到过啦' });
  const w = applyTx(req.user.id, { kind:'checkin', gold: reward, memo:`第 ${streak} 天签到` });
  bumpDaily(req.user.id, 'checkin');
  log({ level: 'info', category: 'economy', event: 'checkin',
    message: `用户签到 第 ${streak} 天 奖励 ${reward} 金币`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { gold: reward, streak, vip: isVip(u) } });
  res.json({ wallet: w, reward, streak });
});

router.get('/transactions', authRequired, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ transactions: txs });
});

// Redeem a gift / invite code for an existing user. 用条件 UPDATE 原子扣减，防并发超额。
router.post('/redeem', authRequired, redeemLimiter, (req, res) => {
  const code = String((req.body || {}).code ||'').trim();
  const key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code);
  if (!key) return res.status(400).json({ error:'密钥无效' });
  const upd = db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ? AND used < max_uses').run(code);
  if (upd.changes === 0) return res.status(400).json({ error:'该密钥已用完' });
  if (key.grant_gold || key.grant_diamond)
    applyTx(req.user.id, { kind:'reward', gold: key.grant_gold, diamond: key.grant_diamond, memo:`兑换码 ${code}` });
  if (key.grant_vip_days) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + key.grant_vip_days * 86400000).toISOString(), req.user.id);
  }
  log({ level: 'warn', category: 'economy', event: 'redeem',
    message: `用户兑换码 ${code}`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { code, grant_gold: key.grant_gold, grant_diamond: key.grant_diamond, grant_vip_days: key.grant_vip_days } });
  res.json({ wallet: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default router;
