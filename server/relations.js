import db from './db.js';

const ONLINE_MS = 5 * 60 * 1000;
export const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

export function areFriends(a, b) {
  const [x, y] = pairKey(a, b);
  return !!db.prepare('SELECT 1 FROM friendships WHERE a_id=? AND b_id=?').get(x, y);
}
export function friendIds(uid) {
  return db.prepare('SELECT a_id, b_id FROM friendships WHERE a_id=? OR b_id=?').all(uid, uid)
    .map(f => (f.a_id === uid ? f.b_id : f.a_id));
}
export function isOnline(u) {
  if (!u) return false;
  const s = db.prepare('SELECT show_online FROM settings WHERE user_id=?').get(u.id);
  if (s && s.show_online === 0) return false;
  return !!u.last_active && (Date.now() - u.last_active) < ONLINE_MS;
}
export function dmAllowed(me, target) {
  if (!target) return false;
  if (areFriends(me.id, target.id)) return true;
  const s = db.prepare('SELECT allow_dm FROM settings WHERE user_id=?').get(target.id) || {};
  const mode = s.allow_dm || 'all';
  if (mode === 'none') return false;
  if (mode === 'followers') return !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(me.id, target.id);
  return true;
}
export function friendState(meId, tid) {
  if (tid === meId) return 'self';
  if (areFriends(meId, tid)) return 'friends';
  if (db.prepare("SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=? AND status='pending'").get(meId, tid)) return 'pending_out';
  if (db.prepare("SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=? AND status='pending'").get(tid, meId)) return 'pending_in';
  return 'none';
}
export function dmThread(meId, otherId) {
  return db.prepare('SELECT * FROM dm_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id')
    .all(meId, otherId, otherId, meId);
}
