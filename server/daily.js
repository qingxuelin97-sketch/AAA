import db from './db.js';

// Daily task progress, mirroring the browser build. Counts reset each calendar day.
export const DAILY_TASKS = [
  { id: 'checkin', name: '完成每日签到', target: 1, reward: 30, key: 'checkin' },
  { id: 'chat', name: '发起 1 次角色对话', target: 1, reward: 40, key: 'chat' },
  { id: 'gacha', name: '在扭蛋机抽卡 1 次', target: 1, reward: 30, key: 'gacha' },
  { id: 'fav', name: '收藏 1 个喜欢的角色', target: 1, reward: 20, key: 'fav' },
  { id: 'like', name: '点赞 2 条社区动态', target: 2, reward: 20, key: 'like' },
];

const today = () => new Date().toISOString().slice(0, 10);

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
