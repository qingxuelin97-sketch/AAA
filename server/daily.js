import db from './db.js';

// Daily task progress, mirroring the browser build. Counts reset each calendar day.
export const DAILY_TASKS = [
  { id: 'checkin', name: '完成每日签到', target: 1, reward: 15, key: 'checkin' },
  { id: 'chat', name: '发起 1 次角色对话', target: 1, reward: 20, key: 'chat' },
  { id: 'gacha', name: '在扭蛋机抽卡 1 次', target: 1, reward: 15, key: 'gacha' },
  { id: 'fav', name: '收藏 1 个喜欢的角色', target: 1, reward: 10, key: 'fav' },
  { id: 'like', name: '点赞 2 条社区动态', target: 2, reward: 10, key: 'like' },
  { id: 'novel', name: 'AI 创作 1 段小说', target: 1, reward: 20, key: 'novel' },
];

// 「今天」的业务口径：北京时间（UTC+8）。此前按 UTC 切日，中国用户每天
// 早上 8 点前完成的签到 / 任务会被记到「昨天」，连签也随之断档。
// 与服务器所在时区无关（显式 +8h 折算），客户端 util.js cnToday 同口径。
export const cnToday = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const today = cnToday;

export function dailyOf(userId) {
  let row = db.prepare('SELECT * FROM daily_progress WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO daily_progress (user_id, date, counts, claimed) VALUES (?,?,?,?)').run(userId, today(), '{}', '[]');
    row = { user_id: userId, date: today(), counts: '{}', claimed: '[]' };
  }
  if (row.date !== today()) {
    db.prepare('UPDATE daily_progress SET date = ?, counts = ?, claimed = ? WHERE user_id = ?').run(today(), '{}', '[]', userId);
    row.date = today(); row.counts = '{}'; row.claimed = '[]';
  }
  let counts = {}, claimed = [];
  try { counts = JSON.parse(row.counts || '{}'); } catch { /* */ }
  try { claimed = JSON.parse(row.claimed || '[]'); } catch { /* */ }
  return { counts, claimed };
}

export function bumpDaily(userId, key) {
  if (!userId) return;
  const d = dailyOf(userId);
  d.counts[key] = (d.counts[key] || 0) + 1;
  db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), userId);
}

export function saveClaimed(userId, claimed) {
  db.prepare('UPDATE daily_progress SET claimed = ? WHERE user_id = ?').run(JSON.stringify(claimed), userId);
}
