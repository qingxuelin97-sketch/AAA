import { Router } from'express';
import rateLimit from 'express-rate-limit';
import db from'../db.js';
import { authRequired } from'../auth.js';
import { applyTx, assertEconomicAccess, isVip, publicUser, GOLD_PER_DIAMOND, VIP_COST_GOLD, VIP_DAYS, notify } from'../wallet.js';
import { bumpDaily, cnToday, dailyOf } from '../daily.js';
import { log } from '../logger.js';
import { createPaymentOrder, getPaymentOrder, paymentAvailability, PAYMENT_PACKAGES } from '../payment.js';

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

// Server-authoritative recharge package snapshots (diamonds).
export const PACKAGES = PAYMENT_PACKAGES;

router.get('/wallet', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ wallet: publicUser(u), transactions: txs, packages: PACKAGES,
    rates: { gold_per_diamond: GOLD_PER_DIAMOND, vip_cost: VIP_COST_GOLD, vip_days: VIP_DAYS,
      vip_plans: Object.values(VIP_PLANS) } });
});

router.get('/packages', (req, res) => res.json({ packages: PACKAGES, payment: paymentAvailability() }));

// Removed compatibility endpoint. A client request must never mint currency;
// only a verified provider webhook may credit a persisted payment order.
router.post('/recharge', authRequired, (req, res) => {
  res.status(410).json({ error: '旧充值接口已停用，请创建充值订单', code: 'PAYMENT_ORDER_REQUIRED' });
});

router.post('/recharge/orders', authRequired, (req, res, next) => {
  const pkg = PACKAGES.find(p => p.id === (req.body || {}).package_id);
  if (!pkg) return res.status(400).json({ error: '套餐不存在' });
  const idempotencyKey = req.header('Idempotency-Key') || req.body?.idempotency_key || null;
  try {
    const order = createPaymentOrder(req.user.id, pkg, idempotencyKey);
    log({ level: 'info', category: 'payment', event: 'order_created',
      message: `创建充值订单 ${order.id}`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 201, request_id: req.requestId || '',
      extra: { order_id: order.id, package_id: pkg.id, amount_cents: order.amount_cents } });
    res.status(201).json({ order });
  } catch (err) { next(err); }
});

router.get('/recharge/orders/:id', authRequired, (req, res) => {
  const order = getPaymentOrder(req.user.id, String(req.params.id || ''));
  if (!order) return res.status(404).json({ error: '充值订单不存在' });
  res.json({ order });
});

// Exchange diamonds -> gold (1 : 100)
//
// 兑换口是硬通货转软通货的唯一闸门，也是任何「钻石被超发」事故的放大器：
// 超发的钻石只有经过这里才会变成能在站内消费的金币。此前这个端点
//   · 没有任何路由级限流（整个文件里只有 /redeem 挂了 redeemLimiter）
//   · 单次上限 100 万钻，而最大充值档 ¥648 只给 9360 钻——上限是它的 107 倍，
//     等于没有上限
//   · 没有每日累计上限
// 现在三样都补上。按真实充值档位标定：单次 20000 钻（≈2 个最大档），
// 每日 50000 钻（≈5 个最大档），对任何真实用户都绰绰有余，
// 而事故时的爆炸半径缩小约 50 倍。
const EXCHANGE_MAX_PER_CALL = 20_000;
const EXCHANGE_MAX_PER_DAY = 50_000;
const exchangeLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : req.ip),
  handler: (req, res) => res.status(429).json({ error: '兑换过于频繁，请稍后再试' }) });

router.post('/exchange', authRequired, exchangeLimiter, (req, res) => {
  const n = parseInt((req.body || {}).diamond, 10);
  if (!n || n <= 0) return res.status(400).json({ error:'请输入有效的钻石数量' });
  if (n > EXCHANGE_MAX_PER_CALL) return res.status(400).json({ error:`单次兑换上限 ${EXCHANGE_MAX_PER_CALL} 钻石` });
  try {
    assertEconomicAccess(req.user.id);
    // 每日累计额度与扣款同事务：并发兑换不能各自读到同一份「今日已兑」快照
    // 后双双通过（否则日上限形同虚设）。
    const w = db.transaction(() => {
      const used = dailyOf(req.user.id).counts.exchange_diamond || 0;
      if (used + n > EXCHANGE_MAX_PER_DAY) {
        const e = new Error(`今日兑换额度不足（上限 ${EXCHANGE_MAX_PER_DAY} 钻石，已兑 ${used}）`);
        e.status = 400; e.expose = true; throw e;
      }
      const wallet = applyTx(req.user.id, { kind:'exchange', diamond: -n, gold: n * GOLD_PER_DIAMOND, memo:`${n} 钻石兑换为 ${n * GOLD_PER_DIAMOND} 金币` });
      const d = dailyOf(req.user.id);
      d.counts.exchange_diamond = (d.counts.exchange_diamond || 0) + n;
      db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), req.user.id);
      return wallet;
    }).immediate();
    log({ level: 'info', category: 'economy', event: 'exchange',
      message: `用户兑换 ${n} 钻石为 ${n * GOLD_PER_DIAMOND} 金币`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { diamond: n, gold: n * GOLD_PER_DIAMOND } });
    res.json({ wallet: w });
  } catch (e) { res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
});

// Buy VIP with gold. 可选 plan（week/month/season）；缺省 month（向后兼容）。
router.post('/vip', authRequired, (req, res) => {
  const plan = VIP_PLANS[(req.body || {}).plan] || VIP_PLANS.month;
  let until;
  try {
    // 扣金币 + 续期一并原子提交：崩溃或并发不再出现「扣了币没开通 / 付两次只续一次」。
    db.transaction(() => {
      const u = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(req.user.id);
      applyTx(req.user.id, { kind: 'vip', gold: -plan.gold, memo: `购买 ${plan.days} 天 VIP（${plan.label}）` });
      const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
      until = new Date(base + plan.days * 86400000).toISOString();
      db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(until, req.user.id);
    }).immediate();
  } catch (e) { return res.status(400).json({ error: e.message }); }
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
  if (u.last_checkin === today) return res.status(409).json({
    error: '今天已经签到过啦',
    code: 'ALREADY_CHECKED_IN',
  });
  const yesterday = cnToday(new Date(Date.now() - 86400000));
  const streak = u.last_checkin === yesterday ? (u.checkin_streak || 0) + 1 : 1;
  // 每日签到金币：50 / 100 / 200，概率 33% / 50% / 17%（VIP 翻倍）
  const roll = Math.random(); let reward = roll < 0.33 ? 50 : roll < 0.83 ? 100 : 200;
  if (isVip(u)) reward *= 2;
  // 连签里程碑（7/30/100 天 → +100/500/2000 金）：与签到同事务发放。
  // 刻意不吃 VIP 翻倍——里程碑是「坚持」的奖励，非会员权益；账本 kind=
  // 'milestone' 与日常 'checkin' 区分。幂等键按用户+日期唯一，重放不重发；
  // 断签重新累到同一档会再次发放（新的坚持周期，语义上应得）。
  const MILESTONES = { 7: 100, 30: 500, 100: 2000 };
  const milestone = MILESTONES[streak] || 0;
  // 条件 UPDATE 防并发重复签到 + 发奖 + 每日任务一并原子提交（崩溃不再「标记已签到却没发币」）。
  let w;
  try {
    db.transaction(() => {
      const upd = db.prepare('UPDATE users SET last_checkin = ?, checkin_streak = ? WHERE id = ? AND (last_checkin IS NULL OR last_checkin != ?)').run(today, streak, req.user.id, today);
      if (upd.changes === 0) throw Object.assign(new Error('今天已经签到过啦'), {
        status: 409,
        code: 'ALREADY_CHECKED_IN',
        expose: true,
      });
      w = applyTx(req.user.id, { kind: 'checkin', gold: reward, memo: `第 ${streak} 天签到` });
      if (milestone) {
        // 幂等键带 streak 档位：同日重放由条件 UPDATE 拦截，幂等键兜崩溃重试；
        // 键含档位保证「不同里程碑」永不共键（防 kind/金额不一致的幂等冲突）。
        w = applyTx(req.user.id, { kind: 'milestone', gold: milestone, memo: `连签 ${streak} 天里程碑`,
          idempotency_key: `checkin-milestone:${req.user.id}:${today}:${streak}` });
      }
      bumpDaily(req.user.id, 'checkin');
    }).immediate();
  } catch (e) {
    return res.status(e.status || 400).json({
      error: e.message,
      ...(e.code ? { code: e.code } : {}),
    });
  }
  log({ level: 'info', category: 'economy', event: 'checkin',
    message: `用户签到 第 ${streak} 天 奖励 ${reward} 金币${milestone ? `（里程碑 +${milestone}）` : ''}`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { gold: reward, streak, vip: isVip(u), milestone } });
  res.json({ wallet: w, reward, streak, milestone });
});

router.get('/transactions', authRequired, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ transactions: txs });
});

// 签到日历：从 transactions(kind='checkin') 推导（每天恰一行，条件 UPDATE 保证），
// 不另建表。日界 = 北京时间（cnToday 同口径）；month 缺省当月，钳制在近 12 个月内。
router.get('/checkin/calendar', authRequired, (req, res) => {
  const today = cnToday();
  const month = String(req.query.month || today.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '月份格式应为 YYYY-MM' });
  const [y, m] = month.split('-').map(Number);
  if (!(m >= 1 && m <= 12)) return res.status(400).json({ error: '月份格式应为 YYYY-MM' });
  const monthIndex = y * 12 + (m - 1);
  const [ty, tm] = today.slice(0, 7).split('-').map(Number);
  const todayIndex = ty * 12 + (tm - 1);
  if (monthIndex > todayIndex || todayIndex - monthIndex > 11) {
    return res.status(400).json({ error: '仅支持查询近 12 个月' });
  }
  // 北京月界折回 UTC 存储时间：北京 [1 日 00:00, 次月 1 日 00:00) = UTC 各 -8h。
  // created_at 由 sqlite datetime('now') 写入（'YYYY-MM-DD HH:MM:SS' UTC），
  // 边界字符串必须同构才能字典序比较。
  const sqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const utcStart = sqliteUtc(Date.UTC(y, m - 1, 1) - 8 * 3600e3);
  const utcEnd = sqliteUtc(Date.UTC(y, m, 1) - 8 * 3600e3);
  const rows = db.prepare(`SELECT created_at FROM transactions
    WHERE user_id = ? AND kind = 'checkin' AND created_at >= ? AND created_at < ?`)
    .all(req.user.id, utcStart, utcEnd);
  const days = [...new Set(rows.map((r) => cnToday(new Date(String(r.created_at).replace(' ', 'T') + 'Z'))))]
    .filter((d) => d.startsWith(month))
    .map((d) => Number(d.slice(8)))
    .sort((a, b) => a - b);
  const u = db.prepare('SELECT last_checkin, checkin_streak FROM users WHERE id = ?').get(req.user.id);
  res.json({ month, days, today, last_checkin: u.last_checkin || null,
    streak: u.checkin_streak || 0, month_total: days.length });
});

// Redeem a gift / invite code for an existing user. 用条件 UPDATE 原子扣减，防并发超额。
router.post('/redeem', authRequired, redeemLimiter, (req, res) => {
  const code = String((req.body || {}).code ||'').trim();
  const key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code);
  if (!key) return res.status(400).json({ error:'密钥无效' });
  try {
    // 核销 + 发奖 + 续期一并原子提交：applyTx 抛错则整体回滚，兑换码不被白白消耗。
    db.transaction(() => {
      db.prepare('INSERT INTO code_redemptions (code, user_id) VALUES (?, ?)').run(code, req.user.id);
      const upd = db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ? AND used < max_uses').run(code);
      if (upd.changes === 0) throw Object.assign(new Error('该密钥已用完'), { status: 400, expose: true });
      if (key.grant_gold || key.grant_diamond)
        applyTx(req.user.id, { kind: 'reward', gold: key.grant_gold, diamond: key.grant_diamond, memo: `兑换码 ${code}` });
      if (key.grant_vip_days) {
        const u = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(req.user.id);
        const base = isVip(u) ? new Date(u.vip_until).getTime() : Date.now();
        db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + key.grant_vip_days * 86400000).toISOString(), req.user.id);
      }
    }).immediate();
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) return res.status(409).json({ error: '该兑换码每个账号只能使用一次', code: 'REDEEM_ALREADY_USED' });
    // applyTx 会抛带 code = 'ECONOMIC_HOLD' 的错（wallet.js:51/:86），此前这里丢掉了它，
    // 于是被经济冻结的用户在兑换口看到的是一句没有 code 的笼统报错，前端给不出对路的引导。
    return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
  log({ level: 'warn', category: 'economy', event: 'redeem',
    message: `用户兑换码 ${code}`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { code, grant_gold: key.grant_gold, grant_diamond: key.grant_diamond, grant_vip_days: key.grant_vip_days } });
  res.json({ wallet: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default router;
