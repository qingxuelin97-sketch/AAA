import db from './db.js';

// Every table whose contents make up a full site snapshot. Operational logs
// stay outside snapshots because they grow quickly and are not restore data.
//
// 这是一份**显式白名单**，而 persist.js 的恢复流程是「逐表 DELETE 后整表回灌」：
// 漏登记一张表，它就不进备份、也不被恢复覆盖 —— 结果是恢复后 messages 回到 T 时刻，
// 漏掉的表却停在 T+n，数据集从此自相矛盾，而且全程没有任何日志。
// client/app-test.mjs 有一条断言守着这里：db.js 里新建的每张表都必须出现在
// BACKUP_TABLES 或下面的 EXCLUDED_TABLES 里，二选一，不允许遗漏。
export const BACKUP_TABLES = [
  'users', 'settings', 'characters', 'world_entries', 'favorites', 'conversations', 'messages',
  'scripts', 'script_likes', 'reviews', 'reports', 'script_purchases', 'posts', 'moments', 'moment_likes', 'comments',
  'follows', 'groups', 'group_members', 'group_messages', 'theaters', 'theater_members', 'theater_cast', 'theater_messages',
  'announcements', 'invite_keys', 'transactions', 'categories', 'app_config', 'ai_images', 'daily_progress', 'event_claims',
  'proposals', 'proposal_votes', 'proposal_endorse', 'proposal_comments', 'friendships', 'friend_requests', 'dm_messages',
  'worldbooks', 'worldbook_entries', 'character_worldbooks', 'novels', 'novel_runs', 'novel_beats',
  'notifications', 'shares', 'email_whitelist', 'email_codes', 'payment_orders', 'payment_events', 'code_redemptions', 'user_uploads',
  // 以下三张是用户数据，此前一直漏登记：hearts 是收藏/喜欢关系，character_views 是
  // 曝光计数（也是唯一能算 CTR 的分母），reading_progress 是阅读进度。
  'hearts', 'character_views', 'reading_progress',
  // 回复变体：被重新生成过的消息的历史版本，属于用户内容
  'message_variants',
];

// 明确**不进**备份的表，与 BACKUP_TABLES 一起构成对 db.js 全部建表的完整覆盖。
// 登记在这里表示「已经想过，确实不该备份」，而不是「忘了」。
export const EXCLUDED_TABLES = [
  'logs',                  // 运营日志，增长快且有独立的分级保留策略
  'auth_login_failures',   // 登录失败风控计数，短期时序数据，恢复旧值反而会误锁账号
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
