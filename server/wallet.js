import db from './db.js';
import crypto from 'node:crypto';
import { push } from './realtime.js';

export const GOLD_PER_DIAMOND = 100; // 1 钻石 = 100 金币
export const VIP_COST_GOLD = 30000;  // 30 天 VIP 价格
export const VIP_DAYS = 30;

export function isVip(user) {
  return !!user?.vip_until && new Date(user.vip_until).getTime() > Date.now();
}

export function publicUser(u) {
  if (!u) return u;
  return {
    id: u.id, username: u.username, email: u.email, display_name: u.display_name,
    avatar: u.avatar, banner: u.banner, bio: u.bio,
    gold: u.gold, diamond: u.diamond,
    diamond_debt: Math.max(0, u.diamond_debt || 0), economic_hold: !!u.economic_hold,
    economic_hold_reason: u.economic_hold_reason || '',
    vip_until: u.vip_until, vip: isVip(u),
    checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, is_gm: !!u.is_gm, is_banned: !!u.is_banned,
    svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', is_councilor: !!u.is_councilor, created_at: u.created_at
  };
}

const walletResult = (userId, tx = null, idempotent = false) => {
  const balance = db.prepare(`SELECT gold, diamond, diamond_debt, economic_hold,
    economic_hold_reason FROM users WHERE id = ?`).get(userId);
  return { ...balance, transaction_id: tx?.id || null, operation_id: tx?.operation_id || null, idempotent };
};

export function assertEconomicAccess(userId) {
  const u = db.prepare('SELECT diamond_debt, economic_hold FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('用户不存在');
  if ((u.diamond_debt || 0) > 0 || u.economic_hold) {
    const err = new Error('账户存在充值债务，当前经济操作已暂停');
    err.status = 423;
    err.code = 'ECONOMIC_HOLD';
    err.expose = true;
    throw err;
  }
}

// Atomic balance change + immutable ledger entry. Optional idempotency and
// reversal links are deliberately enforced here rather than at individual
// routes so retries cannot mint duplicate refunds.
export const applyTx = db.transaction((userId, {
  kind, gold = 0, diamond = 0, memo = '', ref_owner = null, payment_order_id = null,
  operation_id = null, idempotency_key = null, reversal_of = null, share_eligible = true,
}) => {
  const u = db.prepare(`SELECT gold, diamond, diamond_debt, economic_hold,
    economic_hold_reason FROM users WHERE id = ?`).get(userId);
  if (!u) throw new Error('用户不存在');
  if (!Number.isSafeInteger(gold) || !Number.isSafeInteger(diamond)) throw new Error('钱包金额必须是安全整数');
  if (![u.gold, u.diamond, u.diamond_debt || 0].every(Number.isSafeInteger)) throw new Error('钱包余额超出安全整数范围');

  const idem = idempotency_key == null ? null : String(idempotency_key).slice(0, 200);
  if (idem) {
    const existing = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?').get(userId, idem);
    if (existing) {
      const priorGrossDiamond = existing.gross_diamond == null ? existing.diamond : existing.gross_diamond;
      if (existing.kind !== kind || existing.gold !== gold || priorGrossDiamond !== diamond) throw new Error('幂等键已用于不同的钱包操作');
      return walletResult(userId, existing, true);
    }
  }

  // A debt hold is an account-wide economic quarantine, not merely a UI/route
  // restriction. Central enforcement prevents held value being laundered via
  // scripts, VIP, AI/TTS/image fees, or any future negative wallet operation.
  if ((gold < 0 || diamond < 0) && ((u.diamond_debt || 0) > 0 || u.economic_hold)) {
    const err = new Error('账户存在充值债务，当前经济操作已暂停');
    err.status = 423;
    err.code = 'ECONOMIC_HOLD';
    err.expose = true;
    throw err;
  }

  let original = null;
  if (reversal_of != null) {
    original = db.prepare('SELECT * FROM transactions WHERE id = ?').get(reversal_of);
    if (!original || original.user_id !== userId) throw new Error('原钱包流水不存在或不属于该用户');
    const prior = db.prepare('SELECT * FROM transactions WHERE reversal_of = ?').get(original.id);
    if (prior) return walletResult(userId, prior, true);
    if (gold !== -original.gold || diamond !== -original.diamond) throw new Error('冲正金额必须与原流水完全相反');
    // A failed reserved charge and its refund become revenue-visible in one
    // transaction, so observers see either neither side or a net-zero pair.
    db.prepare('UPDATE transactions SET share_eligible = 1 WHERE id = ?').run(original.id);
    if (ref_owner == null) ref_owner = original.ref_owner;
    share_eligible = true;
  }

  const goldAfter = u.gold + gold;
  if (!Number.isSafeInteger(goldAfter)) throw new Error('金币余额超出安全整数范围');
  if (goldAfter < 0) throw new Error('金币不足');
  let visibleDiamond = diamond;
  let debtPaid = 0;
  let debtAfter = Math.max(0, u.diamond_debt || 0);
  if (diamond > 0 && debtAfter > 0) {
    debtPaid = Math.min(debtAfter, diamond);
    debtAfter -= debtPaid;
    visibleDiamond -= debtPaid;
  }
  const diamondAfter = u.diamond + visibleDiamond;
  if (!Number.isSafeInteger(diamondAfter)) throw new Error('钻石余额超出安全整数范围');
  if (diamondAfter < 0) throw new Error('钻石不足');
  const clearPaymentHold = debtAfter === 0 && u.economic_hold_reason === 'payment_debt';
  db.prepare(`UPDATE users SET gold = gold + ?, diamond = diamond + ?, diamond_debt = ?,
    economic_hold = CASE WHEN ? THEN 0 ELSE economic_hold END,
    economic_hold_reason = CASE WHEN ? THEN '' ELSE economic_hold_reason END,
    economic_hold_at = CASE WHEN ? THEN NULL ELSE economic_hold_at END
    WHERE id = ?`).run(gold, visibleDiamond, debtAfter, clearPaymentHold ? 1 : 0,
      clearPaymentHold ? 1 : 0, clearPaymentHold ? 1 : 0, userId);
  // ref_owner: 该笔消费归属的创作者（按用户真实投入分成用），仅当消费者非作者本人时记录。
  const owner = (ref_owner && ref_owner !== userId) ? ref_owner : null;
  const operation = operation_id ? String(operation_id).slice(0, 200) : crypto.randomUUID();
  const info = db.prepare(`INSERT INTO transactions
    (user_id, kind, gold, diamond, gross_diamond, diamond_debt_delta, diamond_debt_after,
     gold_balance_after, diamond_balance_after, memo, ref_owner, payment_order_id, operation_id,
     idempotency_key, reversal_of, share_eligible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, kind, gold, visibleDiamond, diamond, -debtPaid, debtAfter,
      goldAfter, diamondAfter, memo, owner, payment_order_id, operation, idem,
      original?.id || null, share_eligible ? 1 : 0);
  const tx = { id: Number(info.lastInsertRowid), operation_id: operation };
  return walletResult(userId, tx, false);
});

// Reverse a credited payment even when the user has already spent part of it.
// Available diamonds are recovered immediately and the shortfall becomes debt;
// the linked reversal and the account hold are committed atomically.
export const reversePaymentCredit = db.transaction((userId, {
  original_transaction_id, amount, kind, payment_order_id,
  idempotency_key, memo = '', operation_id = null,
}) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('冲正钻石数量必须是安全正整数');
  const original = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(original_transaction_id, userId);
  if (!original || original.kind !== 'recharge') throw new Error('原充值流水不存在');
  const originalGross = original.gross_diamond == null ? original.diamond : original.gross_diamond;
  if (originalGross !== amount || original.payment_order_id !== payment_order_id) throw new Error('冲正金额与原充值不一致');

  const idem = String(idempotency_key || '').slice(0, 200);
  if (!idem) throw new Error('支付冲正必须提供幂等键');
  const existing = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?').get(userId, idem);
  if (existing) return walletResult(userId, existing, true);
  const prior = db.prepare('SELECT * FROM transactions WHERE reversal_of = ?').get(original.id);
  if (prior) return walletResult(userId, prior, true);

  const u = db.prepare('SELECT gold, diamond, diamond_debt FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('用户不存在');
  if (![u.gold, u.diamond, u.diamond_debt || 0].every(Number.isSafeInteger)) throw new Error('钱包余额超出安全整数范围');
  const recovered = Math.min(Math.max(0, u.diamond || 0), amount);
  const shortfall = amount - recovered;
  const debtAfter = Math.max(0, u.diamond_debt || 0) + shortfall;
  if (!Number.isSafeInteger(debtAfter)) throw new Error('钻石债务超出安全整数范围');
  const now = Date.now();
  db.prepare(`UPDATE users SET diamond = diamond - ?, diamond_debt = ?,
    economic_hold = CASE WHEN ? > 0 THEN 1 ELSE economic_hold END,
    economic_hold_reason = CASE WHEN ? > 0 THEN 'payment_debt' ELSE economic_hold_reason END,
    economic_hold_at = CASE WHEN ? > 0 THEN COALESCE(economic_hold_at, ?) ELSE economic_hold_at END
    WHERE id = ?`).run(recovered, debtAfter, shortfall, shortfall, shortfall, now, userId);

  const operation = operation_id ? String(operation_id).slice(0, 200) : crypto.randomUUID();
  const info = db.prepare(`INSERT INTO transactions
    (user_id,kind,gold,diamond,gross_diamond,diamond_debt_delta,diamond_debt_after,
     gold_balance_after,diamond_balance_after,memo,payment_order_id,operation_id,idempotency_key,
     reversal_of,share_eligible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, kind, 0, -recovered, -amount, shortfall, debtAfter,
      u.gold, u.diamond - recovered, memo, payment_order_id, operation, idem, original.id, 1);
  return walletResult(userId, { id: Number(info.lastInsertRowid), operation_id: operation }, false);
});

// Reserved upstream fees do not contribute to creator revenue until the
// corresponding result has been delivered successfully.
export function settleTransaction(transactionId) {
  const info = db.prepare('UPDATE transactions SET share_eligible = 1 WHERE id = ? AND reversal_of IS NULL').run(transactionId);
  if (info.changes !== 1) throw new Error('待结算钱包流水不存在');
}

export function notify(userId, text, link = '') {
  const info = db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(userId, text, link);
  // 秒级推送给在线用户；离线则仅落库，下次拉取仍可见。
  push(userId, 'notification', { id: Number(info.lastInsertRowid), text, link, created_at: new Date().toISOString(), read: 0 });
}
