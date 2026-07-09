import db from './db.js';

// Every table whose contents make up a full site snapshot (used by both the GM
// backup/restore endpoints and the automatic rolling persistence).
// 注意：'logs' 不在备份集内——它是增长最快且对恢复无意义的运维日志，纳入会拖垮滚存快照。
// 世界书 / 小说 / 通知 / 收件箱 / 剧本点赞 / 邮箱白名单等模块必须在册，否则临时磁盘部署重启即丢。
export const BACKUP_TABLES = ['users', 'settings', 'characters', 'world_entries', 'favorites', 'conversations', 'messages',
  'scripts', 'script_likes', 'reviews', 'reports', 'script_purchases', 'posts', 'post_likes', 'moments', 'moment_likes', 'comments',
  'follows', 'groups', 'group_members', 'group_messages', 'theaters', 'theater_members', 'theater_cast', 'theater_messages',
  'announcements', 'invite_keys', 'transactions', 'categories', 'app_config', 'ai_images', 'daily_progress', 'event_claims',
  'proposals', 'proposal_votes', 'proposal_endorse', 'proposal_comments', 'friendships', 'friend_requests', 'dm_messages',
  'worldbooks', 'worldbook_entries', 'character_worldbooks', 'novels', 'novel_runs', 'novel_beats',
  'notifications', 'shares', 'email_whitelist', 'email_codes'];

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
  // 恢复期间关闭 FK 强制：父/子表按数组顺序 DELETE+INSERT 时不因引用顺序触发约束失败。
  // 事务内不能改 PRAGMA，故在事务外切换（restore 属离线重建，短暂关闭安全）。
  db.pragma('foreign_keys = OFF');
  try { tx(); }
  finally { db.pragma('foreign_keys = ON'); }
}

export const rowCount = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return 0; } };
