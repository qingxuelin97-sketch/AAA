import db from './db.js';
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

// Atomic balance change + ledger entry. Throws if it would go negative.
export const applyTx = db.transaction((userId, { kind, gold = 0, diamond = 0, memo = '', ref_owner = null, payment_order_id = null }) => {
  const u = db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('用户不存在');
  if (u.gold + gold < 0) throw new Error('金币不足');
  if (u.diamond + diamond < 0) throw new Error('钻石不足');
  db.prepare('UPDATE users SET gold = gold + ?, diamond = diamond + ? WHERE id = ?').run(gold, diamond, userId);
  // ref_owner: 该笔消费归属的创作者（按用户真实投入分成用），仅当消费者非作者本人时记录。
  const owner = (ref_owner && ref_owner !== userId) ? ref_owner : null;
  db.prepare('INSERT INTO transactions (user_id, kind, gold, diamond, memo, ref_owner, payment_order_id) VALUES (?,?,?,?,?,?,?)')
    .run(userId, kind, gold, diamond, memo, owner, payment_order_id);
  return db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(userId);
});

export function notify(userId, text, link = '') {
  const info = db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(userId, text, link);
  // 秒级推送给在线用户；离线则仅落库，下次拉取仍可见。
  push(userId, 'notification', { id: Number(info.lastInsertRowid), text, link, created_at: new Date().toISOString(), read: 0 });
}
