import db from './db.js';

// Daily task progress, mirroring the browser build. Counts reset each calendar day.
export const DAILY_TASKS = [
  { id: 'checkin', name: '完成每日签到', target: 1, reward: 15, key: 'checkin' },
  { id: 'chat', name: '发起 1 次角色对话', target: 1, reward: 20, key: 'chat' },
  { id: 'gacha', name: '转动幸运转盘 1 次', target: 1, reward: 15, key: 'gacha' },
  { id: 'fav', name: '收藏 1 个喜欢的角色', target: 1, reward: 10, key: 'fav' },
  { id: 'like', name: '点赞 2 条社区动态', target: 2, reward: 10, key: 'like' },
  { id: 'novel', name: 'AI 创作 1 段小说', target: 1, reward: 20, key: 'novel' },
];

// 「今天」的业务口径：北京时间（UTC+8）。此前按 UTC 切日，中国用户每天
// 早上 8 点前完成的签到 / 任务会被记到「昨天」，连签也随之断档。
// 与服务器所在时区无关（显式 +8h 折算），客户端 util.js cnToday 同口径。
export const cnToday = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const today = cnToday;

// ⚠ 名字是读，实际会写：首次访问要建行，跨日要重置。它被 GET /engage/tasks、
// gacha 的状态查询、affinity 等纯读路径调用，所以「一个 GET 会写库」是既有事实。
// 这里只堵住那个真问题：原来的裸 INSERT 没有任何冲突保护，而 daily_progress 的
// 主键是 user_id —— 新用户首日两个并发请求，必有一个撞 UNIQUE 抛错。
export function dailyOf(userId) {
  let row = db.prepare('SELECT * FROM daily_progress WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO daily_progress (user_id, date, counts, claimed) VALUES (?,?,?,?) ON CONFLICT(user_id) DO NOTHING')
      .run(userId, today(), '{}', '[]');
    // 并发下可能是别人建的行，回读一次拿真值，不要臆造。
    row = db.prepare('SELECT * FROM daily_progress WHERE user_id = ?').get(userId)
      || { user_id: userId, date: today(), counts: '{}', claimed: '[]' };
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
