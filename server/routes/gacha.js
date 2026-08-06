import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, assertEconomicAccess } from '../wallet.js';
import { dailyOf, bumpDaily } from '../daily.js';
import { contentLimiter } from '../limiters.js';
import { log } from '../logger.js';

// 幸运转盘（原扭蛋机，产品定案：奖品只发聊天次数卡与数字资产，不再产出角色卡）。
//   - 每日 1 次免费转（daily_progress.counts.gacha_free，北京时间自然日重置）；
//     付费转 100 金（kind='gacha' 扣款，奖品同 kind 正向入账，账本可对轧）。
//   - 摇号只在服务端发生：客户端拿 index 播落点动画，无法自选奖品。
//   - 保底：users.gacha_pity 计数，连续 GUARANTEE-1 次未中稀有档后强制从
//     稀有档内按权重取（中稀有即归零）。
//   - 聊天次数卡（users.chat_credits）：平台对话计费时优先抵扣（1 卡 = 1 次
//     平台 AI 回复免金币），只作用于对话线，见 platform.js chargePlatformFee。
//   - 每次真实转动 bumpDaily('gacha') + gacha_pulls+1：每日任务与成就
//     「欧皇之路」沿用原度量。
// 经济口径（供调参）：免费转期望 ≈ 42 金 + 0.46 卡 + 1.0 钻/天（约一档每日
// 任务的量级）；付费转 100 金回收期望 ≈ 58 金/次净回收，钻石/大额金币档
// 提供拉动力。调整只动 PRIZES 权重与金额即可，客户端从 /state 取数渲染。
const router = Router();

const PAID_PRICE = 100;
const GUARANTEE = 10;
const PRIZES = [
  { id: 'gold20',    kind: 'gold',    amount: 20,  weight: 26, label: '金币 ×20' },
  { id: 'gold50',    kind: 'gold',    amount: 50,  weight: 20, label: '金币 ×50' },
  { id: 'credit1',   kind: 'credit',  amount: 1,   weight: 16, label: '聊天卡 ×1' },
  { id: 'gold100',   kind: 'gold',    amount: 100, weight: 12, label: '金币 ×100' },
  { id: 'credit3',   kind: 'credit',  amount: 3,   weight: 10, label: '聊天卡 ×3' },
  { id: 'diamond5',  kind: 'diamond', amount: 5,   weight: 8,  label: '钻石 ×5' },
  { id: 'gold300',   kind: 'gold',    amount: 300, weight: 5,  label: '金币 ×300' },
  { id: 'diamond20', kind: 'diamond', amount: 20,  weight: 3,  label: '钻石 ×20', jackpot: true },
];
// 稀有档（保底池）：钻石与大额金币
const RARE_IDS = new Set(['diamond5', 'gold300', 'diamond20']);

const rollFrom = (pool) => {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) { if ((r -= p.weight) < 0) return p; }
  return pool[pool.length - 1];
};

const freeUsedToday = (uid) => (dailyOf(uid).counts.gacha_free || 0) >= 1;
const publicPrizes = () => PRIZES.map(p => ({ id: p.id, kind: p.kind, amount: p.amount, weight: p.weight, label: p.label, jackpot: !!p.jackpot }));

router.get('/state', authRequired, (req, res) => {
  const u = db.prepare('SELECT COALESCE(gacha_pity,0) pity, COALESCE(gacha_pulls,0) pulls, COALESCE(chat_credits,0) credits, gold FROM users WHERE id = ?').get(req.user.id);
  res.json({
    free_available: !freeUsedToday(req.user.id), paid_price: PAID_PRICE,
    prizes: publicPrizes(), guarantee: GUARANTEE, pity: u.pity,
    chat_credits: u.credits, total_spins: u.pulls, gold: u.gold,
  });
});

router.post('/spin', authRequired, contentLimiter, (req, res) => {
  const use = req.body?.use === 'paid' ? 'paid' : 'free';
  let out = {};
  try {
    // 免费额度标记 / 扣款 / 摇号 / 发奖 / 保底推进同事务：并发重复领免费转、
    // 扣了款没出奖都被原子拒绝或整体回滚。
    db.transaction(() => {
      const d = dailyOf(req.user.id);
      if (use === 'free') {
        if ((d.counts.gacha_free || 0) >= 1) {
          const e = new Error(`今日免费转动已用完，可花 ${PAID_PRICE} 金币继续转`); e.status = 400; e.expose = true; throw e;
        }
        d.counts.gacha_free = 1;
        db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), req.user.id);
      } else {
        assertEconomicAccess(req.user.id);
        applyTx(req.user.id, { kind: 'gacha', gold: -PAID_PRICE, memo: '幸运转盘 · 付费转动' });
      }
      const pity = db.prepare('SELECT COALESCE(gacha_pity,0) p FROM users WHERE id = ?').get(req.user.id).p;
      // 保底：达到 GUARANTEE-1 次未中稀有后，本次强制从稀有档内按权重取
      const pool = pity + 1 >= GUARANTEE ? PRIZES.filter(p => RARE_IDS.has(p.id)) : PRIZES;
      const prize = rollFrom(pool);
      const index = PRIZES.findIndex(p => p.id === prize.id);
      let wallet = null, credits = null;
      if (prize.kind === 'gold') wallet = applyTx(req.user.id, { kind: 'gacha', gold: prize.amount, memo: `转盘奖品 · ${prize.label}` });
      else if (prize.kind === 'diamond') wallet = applyTx(req.user.id, { kind: 'gacha', diamond: prize.amount, memo: `转盘奖品 · ${prize.label}` });
      else {
        db.prepare('UPDATE users SET chat_credits = COALESCE(chat_credits,0) + ? WHERE id = ?').run(prize.amount, req.user.id);
      }
      credits = db.prepare('SELECT COALESCE(chat_credits,0) c FROM users WHERE id = ?').get(req.user.id).c;
      const pityAfter = RARE_IDS.has(prize.id) ? 0 : pity + 1;
      db.prepare('UPDATE users SET gacha_pity = ?, gacha_pulls = COALESCE(gacha_pulls,0) + 1 WHERE id = ?').run(pityAfter, req.user.id);
      out = { prize: { id: prize.id, kind: prize.kind, amount: prize.amount, label: prize.label, jackpot: !!prize.jackpot },
        index, used: use, pity: pityAfter, guarantee: GUARANTEE, chat_credits: credits, wallet };
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
  bumpDaily(req.user.id, 'gacha');   // 每日任务「转盘」与成就「欧皇之路」沿用原度量
  log({ level: 'info', source: 'server', category: 'economy', event: 'wheel_spin',
    message: `转盘（${use === 'paid' ? '付费' : '免费'}）中「${out.prize.label}」`, user_id: req.user.id, ip: req.ip,
    ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { prize: out.prize.id, used: use, gold_fee: use === 'paid' ? PAID_PRICE : 0, pity_after: out.pity } });
  res.json({ ...out, free_available: !freeUsedToday(req.user.id) });
});

export default router;
