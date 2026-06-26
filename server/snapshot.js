import db from './db.js';

// Every table whose contents make up a full site snapshot (used by both the GM
// backup/restore endpoints and the automatic rolling persistence).
export const BACKUP_TABLES = ['users', 'settings', 'characters', 'world_entries', 'favorites', 'conversations', 'messages',
  'scripts', 'reviews', 'reports', 'script_purchases', 'posts', 'post_likes', 'moments', 'moment_likes', 'comments',
  'follows', 'groups', 'group_members', 'group_messages', 'theaters', 'theater_members', 'theater_cast', 'theater_messages',
  'announcements', 'invite_keys', 'transactions', 'categories', 'app_config', 'ai_images', 'daily_progress', 'event_claims',
  'proposals', 'proposal_votes', 'proposal_endorse', 'proposal_comments', 'friendships', 'friend_requests', 'dm_messages'];

export function exportAll() {
  const tables = {};
  for (const t of BACKUP_TABLES) { try { tables[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch { /* table absent */ } }
  return tables;
}

export function importAll(tables) {
  if (!tables || typeof tables !== 'object') throw new Error('备份数据无效');
  const tx = db.transaction(() => {
    for (const t of BACKUP_TABLES) {
      const rows = tables[t]; if (!Array.isArray(rows)) continue;
      try {
        // 动态取该表实际列名做白名单交集，防止恶意列名拼接 SQL。
        const realCols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
        const allowed = new Set(realCols);
        db.prepare(`DELETE FROM ${t}`).run();
        for (const row of rows) {
          const cols = Object.keys(row).filter(c => allowed.has(c)); if (!cols.length) continue;
          db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(k => row[k]));
        }
      } catch { /* skip incompatible table */ }
    }
  });
  tx();
}

export const rowCount = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return 0; } };
