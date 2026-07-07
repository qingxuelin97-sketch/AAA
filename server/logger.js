// 统一日志模块 —— 三端（服务端 / 桌面网页 / 移动网页 / APP）所有日志的中枢。
//
// 设计目标：
//   1) 同步写库（better-sqlite3 同步，单次 INSERT 微秒级），日志不阻塞主业务、不丢上下文。
//   2) 指纹去重：相同 source+category+event+message 的日志在短窗口内合并计数，避免崩溃风暴撑爆 DB。
//   3) 链路追踪：request_id 串联一次 HTTP 请求内的所有日志，便于复盘。
//   4) 实时告警：error/fatal 级别即时通过 SSE 广播给在线 GM，后台日志台秒级可见。
//   5) 分级保留：debug 3d / info 7d / warn 30d / error+fatal 90d，定时清理。
//   6) 智能采样：debug 级别在高频场景按比率采样，避免噪声淹没信号。
//
// 写库失败只 console.error，绝不抛出 —— 日志不能拖垮主业务。

import db from './db.js';
import { broadcast } from './realtime.js';
import crypto from 'crypto';

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_SOURCES = new Set(['server', 'client', 'app']);

// 指纹去重窗口：相同指纹在此时间窗内（毫秒）合并为一条，count++。
const DEDUP_WINDOW_MS = 60_000;
// debug 级别采样率：高频 debug 日志只保留 10%，避免噪声。
const DEBUG_SAMPLE_RATE = 0.1;

const insertStmt = db.prepare(`
  INSERT INTO logs (level, source, category, event, message, user_id, ip, ua, endpoint, method, status, duration_ms, extra, session_id, request_id, fingerprint, count)
  VALUES (@level, @source, @category, @event, @message, @user_id, @ip, @ua, @endpoint, @method, @status, @duration_ms, @extra, @session_id, @request_id, @fingerprint, @count)
`);

const bumpCountStmt = db.prepare(`
  UPDATE logs SET count = count + 1, ts = datetime('now') WHERE id = ?
`);

// 查找指纹去重窗口内的最近一条日志（用于合并）。
const findRecentByFingerprintStmt = db.prepare(`
  SELECT id FROM logs WHERE fingerprint = ? AND ts >= datetime('now', ?) ORDER BY id DESC LIMIT 1
`);

// 截断超长字段，防止单条日志撑爆 DB（堆栈/UA 可能很长）。
const clip = (s, n = 4000) => {
  if (s == null) return '';
  const t = typeof s === 'string' ? s : String(s);
  return t.length > n ? t.slice(0, n) + '…[truncated]' : t;
};

// 计算事件指纹：source + category + event + message 的归一化哈希。
// 用于聚合「相同的错误反复出现」这种场景 —— 一条日志带 count=N 比同样信息重复 N 条更有用。
function makeFingerprint({ source, category, event, message }) {
  const raw = `${source}|${category}|${event}|${clip(message, 200)}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

// 内存计数器：debug 采样用。每 N 次只放行 1 次。
const debugCounter = new Map(); // fingerprint -> count

// 生成 request_id：用于链路追踪，一次 HTTP 请求内共享。
export function genRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

// 核心写入函数。所有字段都做了空值与类型兜底；调用方只需传关心的字段。
export function log({
  level = 'info', source = 'server', category = 'system', event = 'log',
  message = '', user_id = null, ip = '', ua = '', endpoint = '', method = '',
  status = 0, duration_ms = 0, extra = null, session_id = '', request_id = '',
} = {}) {
  try {
    const lv = VALID_LEVELS.has(level) ? level : 'info';
    const src = VALID_SOURCES.has(source) ? source : 'server';

    // debug 智能采样：高频 debug 只保留 DEBUG_SAMPLE_RATE 比例。
    // 但带 request_id 的 debug（业务调试用）不采样，确保链路完整。
    if (lv === 'debug' && !request_id) {
      const fp = makeFingerprint({ source: src, category, event, message });
      const n = (debugCounter.get(fp) || 0) + 1;
      debugCounter.set(fp, n);
      if (Math.random() > DEBUG_SAMPLE_RATE) return 0;
    }

    const fp = makeFingerprint({ source: src, category, event, message });
    const extraStr = extra == null ? '' : (typeof extra === 'string' ? clip(extra) : clip(JSON.stringify(extra)));

    // 指纹去重：error/warn 级别在窗口内合并，避免崩溃风暴。
    // info/debug 不去重（业务事件每条都有意义）。
    if (lv === 'error' || lv === 'warn' || lv === 'fatal') {
      const recent = findRecentByFingerprintStmt.get(fp, `-${DEDUP_WINDOW_MS / 1000} seconds`);
      if (recent) {
        bumpCountStmt.run(recent.id);
        // 仍然广播给 GM（让后台看到「又来了一次」的实时脉冲）。
        if (lv === 'error' || lv === 'fatal') {
          try { broadcast('audit', { id: recent.id, level: lv, source: src, category, event, message: clip(message, 200), dedup: true, ts: new Date().toISOString() }); } catch { /* */ }
        }
        return recent.id;
      }
    }

    const info = insertStmt.run({
      level: lv, source: src, category, event: clip(event, 120), message: clip(message, 1000),
      user_id: user_id || null, ip: clip(ip, 64), ua: clip(ua, 400), endpoint: clip(endpoint, 300),
      method: clip(method, 10), status: Number(status) || 0, duration_ms: Number(duration_ms) || 0,
      extra: extraStr, session_id: clip(session_id, 64), request_id: clip(request_id, 64),
      fingerprint: fp, count: 1,
    });

    const id = Number(info.lastInsertRowid);
    // error/fatal 实时广播给在线 GM，后台日志台即时刷新。
    // 前端在 useRealtimeEvent('audit') 里判断当前用户是否 GM 再展示（非 GM 忽略）。
    if (lv === 'error' || lv === 'fatal') {
      try {
        broadcast('audit', { id, level: lv, source: src, category, event, message: clip(message, 200), ts: new Date().toISOString() });
      } catch { /* 推送失败不影响主流程 */ }
    }
    return id;
  } catch (e) {
    // 日志写库本身失败：只 console，不抛出。
    console.error('[logger] 写入失败:', e.message);
    return 0;
  }
}

// 审计日志快捷方法：专用于 GM 后台操作（ban/gift/feature/delete/restore/broadcast 等）。
// category 固定 'admin'，level 固定 'info'（审计是正常操作记录，不是错误）。
// actor_id = 操作者；user_id = 被操作目标用户（可为空）。
export function auditLog({ event, message = '', user_id = null, actor_id = null, ip = '', ua = '', extra = null, request_id = '' }) {
  return log({
    level: 'info', source: 'server', category: 'admin', event,
    message, user_id: actor_id, ip, ua, endpoint: '', method: '',
    extra: { ...((extra && typeof extra === 'object') ? extra : {}), target_user_id: user_id || null },
    request_id,
  });
}

// —— GM 后台日志查询 ——
// 多维过滤 + 分页，全部用 named params（顺序无关，更安全）。
// level 用 >= 过滤：查 error 时同时返回 fatal（错误排查要看全部严重级别）。
export function queryLogs({
  level = '', source = '', category = '', event = '', user_id = '',
  q = '', since = '', until = '', limit = 50, offset = 0, sort = 'desc',
} = {}) {
  const where = [];
  const params = {};
  // 级别用 >= 过滤：查 error 时同时返回 fatal。
  // 用内联 CASE（WHERE 里不能用 SELECT 别名 level_weight）。
  const levelCaseExpr = `CASE level WHEN 'fatal' THEN 50 WHEN 'error' THEN 40 WHEN 'warn' THEN 30 WHEN 'info' THEN 20 ELSE 10 END`;
  if (level && LEVEL_WEIGHT[level]) {
    where.push(`${levelCaseExpr} >= :lw`);
    params.lw = LEVEL_WEIGHT[level];
  }
  if (source) { where.push('source = :src'); params.src = source; }
  if (category) { where.push('category = :cat'); params.cat = category; }
  if (event) { where.push('event = :evt'); params.evt = event; }
  if (user_id) { where.push('user_id = :uid'); params.uid = Number(user_id) || 0; }
  if (q) { where.push('(message LIKE :q OR event LIKE :q OR endpoint LIKE :q OR extra LIKE :q)'); params.q = `%${q}%`; }
  if (since) { where.push('ts >= :since'); params.since = since; }
  if (until) { where.push('ts <= :until'); params.until = until; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = sort === 'asc' ? 'ASC' : 'DESC';
  const lim = Math.min(Number(limit) || 50, 500);
  const off = Math.max(Number(offset) || 0, 0);

  const rows = db.prepare(
    `SELECT *, ${levelCaseExpr} AS level_weight FROM logs ${whereSql} ORDER BY id ${order} LIMIT :limit OFFSET :offset`
  ).all({ ...params, limit: lim, offset: off });

  const total = db.prepare(`SELECT COUNT(*) n FROM logs ${whereSql}`).get(params).n;
  return { rows, total };
}

// 日志统计：按级别/来源/类别聚合，用于 GM 后台日志台顶部概览卡片。
export function getLogStats() {
  const byLevel = db.prepare(`SELECT level, COUNT(*) n, SUM(count) total FROM logs GROUP BY level`).all();
  const bySource = db.prepare(`SELECT source, COUNT(*) n, SUM(count) total FROM logs GROUP BY source`).all();
  const byCategory = db.prepare(`SELECT category, COUNT(*) n, SUM(count) total FROM logs GROUP BY category`).all();
  // 最近 24h 的 error/fatal 计数（红色告警指标）
  const since24h = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const recentErrors = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs WHERE level IN ('error','fatal') AND ts >= ?`).get(since24h);
  const total = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs`).get();
  return {
    total: total.n || 0,
    total_with_count: total.total || 0,
    recent_errors_24h: recentErrors.n || 0,
    recent_errors_24h_total: recentErrors.total || 0,
    by_level: byLevel, by_source: bySource, by_category: byCategory,
  };
}

// 时间序列统计：按小时/天聚合，用于 GM 后台趋势图。
// window: 'hour' (最近24小时, 每小时) | 'day' (最近30天, 每天)
export function getLogTimeseries(window = 'hour', level = '') {
  const levelCaseExpr = `CASE level WHEN 'fatal' THEN 50 WHEN 'error' THEN 40 WHEN 'warn' THEN 30 WHEN 'info' THEN 20 ELSE 10 END`;
  let sql, params = {};
  if (window === 'hour') {
    // 最近 24 小时，按小时分组
    sql = `SELECT strftime('%Y-%m-%d %H:00', ts) AS bucket, COUNT(*) n, SUM(count) total
           FROM logs WHERE ts >= datetime('now', '-24 hours')`;
    if (level && LEVEL_WEIGHT[level]) { sql += ` AND ${levelCaseExpr} >= ?`; params = [LEVEL_WEIGHT[level]]; }
    sql += ` GROUP BY bucket ORDER BY bucket ASC`;
  } else {
    // 最近 30 天，按天分组
    sql = `SELECT strftime('%Y-%m-%d', ts) AS bucket, COUNT(*) n, SUM(count) total
           FROM logs WHERE ts >= datetime('now', '-30 days')`;
    if (level && LEVEL_WEIGHT[level]) { sql += ` AND ${levelCaseExpr} >= ?`; params = [LEVEL_WEIGHT[level]]; }
    sql += ` GROUP BY bucket ORDER BY bucket ASC`;
  }
  return db.prepare(sql).all(...Object.values(params));
}

// TOP 统计：按 event / endpoint / user 聚合，找出高频事件 / 热点接口 / 活跃用户。
export function getLogTop(dim = 'event', level = '', limit = 10) {
  const levelCaseExpr = `CASE level WHEN 'fatal' THEN 50 WHEN 'error' THEN 40 WHEN 'warn' THEN 30 WHEN 'info' THEN 20 ELSE 10 END`;
  let col;
  if (dim === 'event') col = 'event';
  else if (dim === 'endpoint') col = 'endpoint';
  else if (dim === 'user') col = 'user_id';
  else if (dim === 'ip') col = 'ip';
  else col = 'event';
  let sql = `SELECT ${col} AS key, COUNT(*) n, SUM(count) total FROM logs WHERE ${col} != '' AND ${col} IS NOT NULL`;
  const params = [];
  if (level && LEVEL_WEIGHT[level]) { sql += ` AND ${levelCaseExpr} >= ?`; params.push(LEVEL_WEIGHT[level]); }
  sql += ` GROUP BY ${col} ORDER BY total DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 10, 50));
  return db.prepare(sql).all(...params);
}

// 指纹聚合：找出高频错误（按指纹分组，count 求和），用于「错误热点」面板。
export function getErrorFingerprints(limit = 10) {
  return db.prepare(
    `SELECT fingerprint, level, category, event, message, SUM(count) total, MAX(ts) last_ts, COUNT(*) rows
     FROM logs WHERE level IN ('error','fatal','warn') AND fingerprint != ''
     GROUP BY fingerprint ORDER BY total DESC LIMIT ?`
  ).all(Math.min(Number(limit) || 10, 50));
}

// 日志保留清理：按级别分级保留（debug 3天 / info 7天 / warn 30天 / error+fatal 90天）。
// 由 index.js 定时调用，与 purgeExpiredCodes 同模式。返回清理条数。
export function purgeOldLogs() {
  const RETENTION = [
    { level: 'debug', days: 3 },
    { level: 'info', days: 7 },
    { level: 'warn', days: 30 },
    { level: 'error', days: 90 },
    { level: 'fatal', days: 90 },
  ];
  let removed = 0;
  for (const { level, days } of RETENTION) {
    const r = db.prepare(`DELETE FROM logs WHERE level = ? AND ts < datetime('now', ?)`).run(level, `-${days} days`);
    removed += r.changes;
  }
  return removed;
}
