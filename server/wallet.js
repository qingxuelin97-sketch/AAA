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
    gold: u.gold, diamond: u.diamond, vip_until: u.vip_until, vip: isVip(u),
    checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, is_gm: !!u.is_gm, is_banned: !!u.is_banned,
    svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', is_councilor: !!u.is_councilor, created_at: u.created_at
  };
}

const walletResult = (userId, tx = null, idempotent = false) => {
  const balance = db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(userId);
  return { ...balance, transaction_id: tx?.id || null, operation_id: tx?.operation_id || null, idempotent };
};

// Atomic balance change + immutable ledger entry. Optional idempotency and
// reversal links are deliberately enforced here rather than at individual
// routes so retries cannot mint duplicate refunds.
export const applyTx = db.transaction((userId, {
  kind, gold = 0, diamond = 0, memo = '', ref_owner = null, payment_order_id = null,
  operation_id = null, idempotency_key = null, reversal_of = null, share_eligible = true,
}) => {
  const u = db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('用户不存在');
  if (!Number.isSafeInteger(gold) || !Number.isSafeInteger(diamond)) throw new Error('钱包金额必须是安全整数');

  const idem = idempotency_key == null ? null : String(idempotency_key).slice(0, 200);
  if (idem) {
    const existing = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?').get(userId, idem);
    if (existing) {
      if (existing.kind !== kind || existing.gold !== gold || existing.diamond !== diamond) throw new Error('幂等键已用于不同的钱包操作');
      return walletResult(userId, existing, true);
    }
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

  if (u.gold + gold < 0) throw new Error('金币不足');
  if (u.diamond + diamond < 0) throw new Error('钻石不足');
  db.prepare('UPDATE users SET gold = gold + ?, diamond = diamond + ? WHERE id = ?').run(gold, diamond, userId);
  // ref_owner: 该笔消费归属的创作者（按用户真实投入分成用），仅当消费者非作者本人时记录。
  const owner = (ref_owner && ref_owner !== userId) ? ref_owner : null;
  const operation = operation_id ? String(operation_id).slice(0, 200) : crypto.randomUUID();
  const info = db.prepare(`INSERT INTO transactions
    (user_id, kind, gold, diamond, memo, ref_owner, payment_order_id, operation_id, idempotency_key, reversal_of, share_eligible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, kind, gold, diamond, memo, owner, payment_order_id, operation, idem, original?.id || null, share_eligible ? 1 : 0);
  const tx = { id: Number(info.lastInsertRowid), operation_id: operation };
  return walletResult(userId, tx, false);
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
