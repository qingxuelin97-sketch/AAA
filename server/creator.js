import db from './db.js';

// Creator V tier from public works' popularity (mirrors the browser build).
const KNOWN_CREATOR_SCORE = 1500;
const n = (sql, ...a) => { try { return db.prepare(sql).get(...a)?.n || 0; } catch { return 0; } };

export function creatorScore(uid) {
  return n('SELECT COALESCE(SUM(uses),0)+COALESCE(SUM(likes)*2,0) n FROM characters WHERE owner_id=? AND is_public=1', uid)
       + n('SELECT COALESCE(SUM(plays),0)+COALESCE(SUM(likes)*2,0) n FROM scripts WHERE author_id=?', uid);
}
export function creatorWorks(uid) {
  return n('SELECT COUNT(*) n FROM characters WHERE owner_id=? AND is_public=1', uid)
       + n('SELECT COUNT(*) n FROM scripts WHERE author_id=?', uid);
}
function topCreatorId() {
  let best = null, bestScore = 0;
  for (const u of db.prepare('SELECT id FROM users WHERE is_banned=0').all()) {
    if (creatorWorks(u.id) > 0) { const s = creatorScore(u.id); if (s > bestScore) { bestScore = s; best = u.id; } }
  }
  return best;
}
export function creatorTier(uid) {
  if (!uid || creatorWorks(uid) === 0) return null;
  if (topCreatorId() === uid) return 'gold';
  return creatorScore(uid) >= KNOWN_CREATOR_SCORE ? 'yellow' : 'bronze';
}
