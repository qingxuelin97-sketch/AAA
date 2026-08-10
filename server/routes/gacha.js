import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, assertEconomicAccess } from '../wallet.js';
import { dailyOf, bumpDaily } from '../daily.js';
import { contentLimiter } from '../limiters.js';
import { log } from '../logger.js';
import {
  PRIZES as DEFAULT_PRIZES, RARE_IDS as DEFAULT_RARE_IDS,
  GUARANTEE as DEFAULT_GUARANTEE, PAID_PRICE as DEFAULT_PAID_PRICE,
  validateGachaConfig,
} from '../gacha-rules.js';

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
// 经济口径：奖池与期望值核算见 ../gacha-rules.js。改造前奖池含钻石档，而钻石可按
// 1:100 兑金币，付费转的期望回收是 174.31 金 / 100 金售价（净印 74.3%，其中 121.20
// 来自钻石档）。现在奖池只发金币与聊天次数卡，期望回收 80.10 金（按聊天卡重会话
// 档 30 金的上限估价），且有 CI 硬闸与写入校验守着。
const router = Router();

// 奖池可由 GM 通过 app_config.gacha 覆盖（无需发版调参）。任何一份配置在生效前
// 都要过 validateGachaConfig：越界就退回默认池并落 error 日志——调参失误不该
// 变成静默的全站通胀。
function gachaConfig() {
  const row = db.prepare("SELECT value FROM app_config WHERE key='gacha'").get();
  const fallback = { prizes: DEFAULT_PRIZES, rareIds: DEFAULT_RARE_IDS, guarantee: DEFAULT_GUARANTEE, paidPrice: DEFAULT_PAID_PRICE };
  if (!row) return fallback;
  let cfg;
  try { cfg = JSON.parse(row.value); } catch { cfg = null; }
  const merged = { ...fallback, ...(cfg || {}) };
  const reason = validateGachaConfig(merged);
  if (!reason) return merged;
  log({ level: 'error', source: 'server', category: 'economy', event: 'gacha_config_rejected',
    message: `app_config.gacha 未通过经济校验，已退回默认奖池：${reason}` });
  return fallback;
}

const rollFrom = (pool) => {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) { if ((r -= p.weight) < 0) return p; }
  return pool[pool.length - 1];
};

const freeUsedToday = (uid) => (dailyOf(uid).counts.gacha_free || 0) >= 1;
const publicPrizes = (prizes) => prizes.map(p => ({ id: p.id, kind: p.kind, amount: p.amount, weight: p.weight, label: p.label, jackpot: !!p.jackpot }));

router.get('/state', authRequired, (req, res) => {
  const u = db.prepare('SELECT COALESCE(gacha_pity,0) pity, COALESCE(gacha_pulls,0) pulls, COALESCE(chat_credits,0) credits, gold FROM users WHERE id = ?').get(req.user.id);
  const cfg = gachaConfig();
  res.json({
    free_available: !freeUsedToday(req.user.id), paid_price: cfg.paidPrice,
    prizes: publicPrizes(cfg.prizes), guarantee: cfg.guarantee, pity: u.pity,
    chat_credits: u.credits, total_spins: u.pulls, gold: u.gold,
  });
});

router.post('/spin', authRequired, contentLimiter, (req, res) => {
  const use = req.body?.use === 'paid' ? 'paid' : 'free';
  const { prizes, rareIds, guarantee, paidPrice } = gachaConfig();
  const rareSet = new Set(rareIds);
  let out = {};
  try {
    // 免费额度标记 / 扣款 / 摇号 / 发奖 / 保底推进同事务：并发重复领免费转、
    // 扣了款没出奖都被原子拒绝或整体回滚。
    db.transaction(() => {
      const d = dailyOf(req.user.id);
      if (use === 'free') {
        if ((d.counts.gacha_free || 0) >= 1) {
          const e = new Error(`今日免费转动已用完，可花 ${paidPrice} 金币继续转`); e.status = 400; e.expose = true; throw e;
        }
        d.counts.gacha_free = 1;
        db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), req.user.id);
      } else {
        assertEconomicAccess(req.user.id);
        applyTx(req.user.id, { kind: 'gacha', gold: -paidPrice, memo: '幸运转盘 · 付费转动' });
      }
      const pity = db.prepare('SELECT COALESCE(gacha_pity,0) p FROM users WHERE id = ?').get(req.user.id).p;
      // 保底：达到 guarantee-1 次未中稀有后，本次强制从稀有档内按权重取
      const pool = pity + 1 >= guarantee ? prizes.filter(p => rareSet.has(p.id)) : prizes;
      const prize = rollFrom(pool);
      const index = prizes.findIndex(p => p.id === prize.id);
      let wallet = null, credits = null;
      // 只认 gold / credit 两种产出。钻石是充值硬通货，不得由转盘反向铸造
      // ——validateGachaConfig 已在配置层拦截，这里再兜一层，避免将来有人
      // 绕过配置直接改奖池常量时静默发出去。
      if (prize.kind === 'gold') wallet = applyTx(req.user.id, { kind: 'gacha', gold: prize.amount, memo: `转盘奖品 · ${prize.label}` });
      else if (prize.kind === 'credit') {
        db.prepare('UPDATE users SET chat_credits = COALESCE(chat_credits,0) + ? WHERE id = ?').run(prize.amount, req.user.id);
      } else {
        const e = new Error('奖池配置异常，请稍后再试'); e.status = 500; throw e;
      }
      credits = db.prepare('SELECT COALESCE(chat_credits,0) c FROM users WHERE id = ?').get(req.user.id).c;
      const pityAfter = rareSet.has(prize.id) ? 0 : pity + 1;
      db.prepare('UPDATE users SET gacha_pity = ?, gacha_pulls = COALESCE(gacha_pulls,0) + 1 WHERE id = ?').run(pityAfter, req.user.id);
      out = { prize: { id: prize.id, kind: prize.kind, amount: prize.amount, label: prize.label, jackpot: !!prize.jackpot },
        index, used: use, pity: pityAfter, guarantee, chat_credits: credits, wallet };
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
  bumpDaily(req.user.id, 'gacha');   // 每日任务「转盘」与成就「欧皇之路」沿用原度量
  log({ level: 'info', source: 'server', category: 'economy', event: 'wheel_spin',
    message: `转盘（${use === 'paid' ? '付费' : '免费'}）中「${out.prize.label}」`, user_id: req.user.id, ip: req.ip,
    ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { prize: out.prize.id, used: use, gold_fee: use === 'paid' ? paidPrice : 0, pity_after: out.pity } });
  res.json({ ...out, free_available: !freeUsedToday(req.user.id) });
});

// —— 存量清算快照（一次性，幂等）——
// 改造前的奖池每转一次净印 74.31 金等值，其中钻石档占 121.20。这些钻石已经发出去
// 且部分已兑成金币或消费掉，**不做追溯扣回**：wallet.js 的负向操作会把用户推进
// diamond_debt / economic_hold，正常玩游戏的人会被冻结，代价远大于收益。
// 这里只做一件事——在奖池改掉之前把「谁、拿了多少」固定成快照，
// 让将来无论选择公示补偿、定向发券还是就此认账，都还有基线可依。
function snapshotGachaIssuance() {
  const existing = db.prepare("SELECT 1 FROM app_config WHERE key='gacha_audit'").get();
  if (existing) return;                       // 已快照过，不覆盖
  try {
    const rows = db.prepare(
      "SELECT user_id, SUM(diamond) AS diamond FROM transactions WHERE kind='gacha' AND diamond > 0 GROUP BY user_id",
    ).all();
    const totalDiamond = rows.reduce((s, r) => s + (r.diamond || 0), 0);
    const payload = {
      note: '奖池去钻石改造前的钻石增发快照；不追溯扣回，仅留基线',
      taken_at: new Date().toISOString(),
      gold_per_diamond: 100,
      users: rows.length,
      total_diamond: totalDiamond,
      total_gold_equivalent: totalDiamond * 100,
      by_user: rows,
    };
    db.prepare("INSERT INTO app_config (key, value) VALUES ('gacha_audit', ?)").run(JSON.stringify(payload));
    log({ level: 'info', source: 'server', category: 'economy', event: 'gacha_audit_snapshot',
      message: `转盘钻石增发存量快照：${rows.length} 名用户共 ${totalDiamond} 钻（折 ${totalDiamond * 100} 金）` });
  } catch (e) {
    // 快照失败不能挡住服务启动，但必须留痕——否则基线悄悄丢了没人知道。
    log({ level: 'error', source: 'server', category: 'economy', event: 'gacha_audit_failed',
      message: `转盘存量快照失败：${e.message}` });
  }
}
snapshotGachaIssuance();

export default router;
