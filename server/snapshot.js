import db from './db.js';

// Every table whose contents make up a full site snapshot. Operational logs
// stay outside snapshots because they grow quickly and are not restore data.
export const BACKUP_TABLES = [
  'users', 'settings', 'characters', 'world_entries', 'favorites', 'conversations', 'messages',
  'scripts', 'script_likes', 'reviews', 'reports', 'script_purchases', 'posts', 'post_likes', 'moments', 'moment_likes', 'comments',
  'follows', 'groups', 'group_members', 'group_messages', 'theaters', 'theater_members', 'theater_cast', 'theater_messages',
  'announcements', 'invite_keys', 'transactions', 'categories', 'app_config', 'ai_images', 'daily_progress', 'event_claims',
  'proposals', 'proposal_votes', 'proposal_endorse', 'proposal_comments', 'friendships', 'friend_requests', 'dm_messages',
  'worldbooks', 'worldbook_entries', 'character_worldbooks', 'novels', 'novel_runs', 'novel_beats',
  'notifications', 'shares', 'email_whitelist', 'email_codes', 'payment_orders', 'payment_events', 'code_redemptions', 'user_uploads',
];

export function exportAll() {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    // A rolling upgrade may briefly run against an older schema. Missing new
    // tables can be omitted from export, but existing-table read failures must
    // be visible to callers.
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (exists) tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return tables;
}

export function importAll(tables) {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('备份数据无效');
  const restore = db.transaction(() => {
    for (const table of BACKUP_TABLES) {
      const rows = tables[table];
      if (!Array.isArray(rows)) continue;
      const realCols = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
      if (!realCols.length) throw new Error(`备份目标表不存在: ${table}`);
      const allowed = new Set(realCols);
      db.prepare(`DELETE FROM ${table}`).run();
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`备份表 ${table} 含无效行`);
        const cols = Object.keys(row).filter(column => allowed.has(column));
        if (!cols.length) throw new Error(`备份表 ${table} 的行没有兼容字段`);
        db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
          .run(...cols.map(column => row[column]));
      }
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`备份违反外键约束（${violations.length} 处）`);
  });

  db.pragma('foreign_keys = OFF');
  try { restore.immediate(); }
  finally { db.pragma('foreign_keys = ON'); }
}

export const rowCount = (table) => {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  catch { return 0; }
};
