// 统一日志模块 —— 三端（服务端 / 桌面网页 / 移动网页 / APP）所有日志的中枢。
//
// 设计目标：
//   1) 同步写库（better-sqlite3 同步，单次 INSERT 微秒级），日志不阻塞主业务、不丢上下文。
//   2) 指纹去重：相同 source+category+event+message 的日志在短窗口内合并计数，避免崩溃风暴撑爆 DB。
//   3) 链路追踪：request_id 串联一次 HTTP 请求内的所有日志，便于复盘。
//   4) 实时告警：error/fatal 级别即时通过 SSE 推送给在线 GM（broadcastGm 定向，
//      绝不进普通用户事件流 —— 错误摘要含接口路径/异常消息，属内部信息）。
//   5) 分级保留：默认 debug 3d / info 7d / warn 30d / error+fatal 90d，可由 GM 在
//      后台按级别调整（app_config.log_retention），定时清理。
//   6) 智能采样：debug 级别在高频场景按比率采样，避免噪声淹没信号。
//   7) 阈值告警：窗口期内 error/fatal 累计达到阈值时，站内通知全体 GM（带冷却期，
//      防止告警本身成为风暴）。规则存 app_config.log_alerts，GM 后台可调。
//
// 写库失败只 console.error，绝不抛出 —— 日志不能拖垮主业务。

import db from './db.js';
import { broadcastGm, push } from './realtime.js';
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
  UPDATE logs SET count = count + ?, ts = datetime('now') WHERE id = ?
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

// 生成 request_id：用于链路追踪，一次 HTTP 请求内共享。
export function genRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

// —— 可配置项：保留策略 / 告警规则（存 app_config，GM 后台可改） ——

const RETENTION_DEFAULTS = { debug: 3, info: 7, warn: 30, error: 90, fatal: 90 };
const ALERT_DEFAULTS = { enabled: true, threshold: 10, window_min: 5, cooldown_min: 15 };

function readConfig(key) {
  try {
    const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
    if (row) return JSON.parse(row.value);
  } catch { /* 配置损坏按默认处理 */ }
  return null;
}
function writeConfig(key, value) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// 保留策略：各级别天数，钳制 1–365。
export function getLogRetention() {
  const cfg = readConfig('log_retention') || {};
  const out = { ...RETENTION_DEFAULTS };
  for (const lv of Object.keys(RETENTION_DEFAULTS)) {
    const n = Math.round(Number(cfg[lv]));
    if (Number.isFinite(n)) out[lv] = Math.min(365, Math.max(1, n));
  }
  return out;
}
export function setLogRetention(patch = {}) {
  const cur = getLogRetention();
  for (const lv of Object.keys(RETENTION_DEFAULTS)) {
    if (patch[lv] == null) continue;
    const n = Math.round(Number(patch[lv]));
    if (!Number.isFinite(n)) continue;
    cur[lv] = Math.min(365, Math.max(1, n));
  }
  writeConfig('log_retention', cur);
  return cur;
}

// 告警规则：窗口期（分钟）内 error/fatal 累计条数（含合并计数）达到阈值 → 通知 GM。
export function getLogAlerts() {
  const cfg = readConfig('log_alerts') || {};
  return {
    enabled: cfg.enabled == null ? ALERT_DEFAULTS.enabled : !!cfg.enabled,
    threshold: Math.min(10000, Math.max(1, Math.round(Number(cfg.threshold)) || ALERT_DEFAULTS.threshold)),
    window_min: Math.min(1440, Math.max(1, Math.round(Number(cfg.window_min)) || ALERT_DEFAULTS.window_min)),
    cooldown_min: Math.min(1440, Math.max(1, Math.round(Number(cfg.cooldown_min)) || ALERT_DEFAULTS.cooldown_min)),
  };
}
export function setLogAlerts(patch = {}) {
  const cur = getLogAlerts();
  const next = {
    enabled: patch.enabled == null ? cur.enabled : !!patch.enabled,
    threshold: patch.threshold == null ? cur.threshold : Math.min(10000, Math.max(1, Math.round(Number(patch.threshold)) || cur.threshold)),
    window_min: patch.window_min == null ? cur.window_min : Math.min(1440, Math.max(1, Math.round(Number(patch.window_min)) || cur.window_min)),
    cooldown_min: patch.cooldown_min == null ? cur.cooldown_min : Math.min(1440, Math.max(1, Math.round(Number(patch.cooldown_min)) || cur.cooldown_min)),
  };
  writeConfig('log_alerts', next);
  return next;
}

// 阈值告警：error/fatal 落库后调用。窗口计数达标且不在冷却期 → 站内通知全体 GM + SSE。
// 内存记冷却时间戳即可（重启后最多多发一次，无害）；告警动作自身出错绝不外抛。
let lastAlertAt = 0;
function maybeFireAlert() {
  try {
    const cfg = getLogAlerts();
    if (!cfg.enabled) return;
    const now = Date.now();
    if (now - lastAlertAt < cfg.cooldown_min * 60_000) return;
    const row = db.prepare(
      `SELECT COALESCE(SUM(count), 0) total FROM logs WHERE level IN ('error','fatal') AND ts >= datetime('now', ?)`
    ).get(`-${cfg.window_min} minutes`);
    if ((row?.total || 0) < cfg.threshold) return;
    lastAlertAt = now;
    const text = `⚠️ 日志告警：最近 ${cfg.window_min} 分钟内累计 ${row.total} 条错误（阈值 ${cfg.threshold}），请前往 GM 控制台 → 日志 排查。`;
    const gms = db.prepare('SELECT id FROM users WHERE is_gm = 1 AND is_banned = 0').all();
    for (const g of gms) {
      try {
        const info = db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(g.id, text, '/admin');
        push(g.id, 'notification', { id: Number(info.lastInsertRowid), text, link: '/admin', created_at: new Date().toISOString(), read: 0 });
      } catch { /* 单个 GM 通知失败不影响其余 */ }
    }
    broadcastGm('audit_alert', { total: row.total, threshold: cfg.threshold, window_min: cfg.window_min, ts: new Date().toISOString() });
    // 告警本身也留痕（info 级，不会再次触发告警）。
    log({ level: 'info', source: 'server', category: 'system', event: 'log_alert_fired', message: text, extra: { total: row.total, ...cfg } });
  } catch (e) {
    console.error('[logger] 告警检查失败:', e.message);
  }
}

// 核心写入函数。所有字段都做了空值与类型兜底；调用方只需传关心的字段。
// count 供客户端上报「去重窗口内累计次数」透传（默认 1，钳制 1–999）。
export function log({
  level = 'info', source = 'server', category = 'system', event = 'log',
  message = '', user_id = null, ip = '', ua = '', endpoint = '', method = '',
  status = 0, duration_ms = 0, extra = null, session_id = '', request_id = '',
  count = 1,
} = {}) {
  try {
    const lv = VALID_LEVELS.has(level) ? level : 'info';
    const src = VALID_SOURCES.has(source) ? source : 'server';
    const cnt = Math.min(999, Math.max(1, Math.round(Number(count)) || 1));

    // debug 智能采样：高频 debug 只保留 DEBUG_SAMPLE_RATE 比例。
    // 但带 request_id 的 debug（业务调试用）不采样，确保链路完整。
    if (lv === 'debug' && !request_id) {
      if (Math.random() > DEBUG_SAMPLE_RATE) return 0;
    }

    const fp = makeFingerprint({ source: src, category, event, message });
    const extraStr = extra == null ? '' : (typeof extra === 'string' ? clip(extra) : clip(JSON.stringify(extra)));

    // 指纹去重：error/warn 级别在窗口内合并，避免崩溃风暴。
    // info/debug 不去重（业务事件每条都有意义）。
    if (lv === 'error' || lv === 'warn' || lv === 'fatal') {
      const recent = findRecentByFingerprintStmt.get(fp, `-${DEDUP_WINDOW_MS / 1000} seconds`);
      if (recent) {
        bumpCountStmt.run(cnt, recent.id);
        // 仍然推送给在线 GM（让后台看到「又来了一次」的实时脉冲）。
        if (lv === 'error' || lv === 'fatal') {
          try { broadcastGm('audit', { id: recent.id, level: lv, source: src, category, event, message: clip(message, 200), dedup: true, ts: new Date().toISOString() }); } catch { /* */ }
          maybeFireAlert();
        }
        return recent.id;
      }
    }

    const info = insertStmt.run({
      level: lv, source: src, category, event: clip(event, 120), message: clip(message, 1000),
      user_id: user_id || null, ip: clip(ip, 64), ua: clip(ua, 400), endpoint: clip(endpoint, 300),
      method: clip(method, 10), status: Number(status) || 0, duration_ms: Number(duration_ms) || 0,
      extra: extraStr, session_id: clip(session_id, 64), request_id: clip(request_id, 64),
      fingerprint: fp, count: cnt,
    });

    const id = Number(info.lastInsertRowid);
    // error/fatal 实时推送给在线 GM（broadcastGm 定向），后台日志台即时刷新。
    if (lv === 'error' || lv === 'fatal') {
      try {
        broadcastGm('audit', { id, level: lv, source: src, category, event, message: clip(message, 200), ts: new Date().toISOString() });
      } catch { /* 推送失败不影响主流程 */ }
      maybeFireAlert();
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
// 链路维度：request_id / session_id / fingerprint 精确匹配（详情弹窗点击穿透用）；
// endpoint 前缀模糊；status_class 按状态码百位分档（2/3/4/5）；min_duration 找慢请求。
export function queryLogs({
  level = '', source = '', category = '', event = '', user_id = '',
  q = '', since = '', until = '', limit = 50, offset = 0, sort = 'desc',
  endpoint = '', request_id = '', session_id = '', fingerprint = '',
  status_class = '', min_duration = '',
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
  if (endpoint) { where.push('endpoint LIKE :ep'); params.ep = `${endpoint}%`; }
  if (request_id) { where.push('request_id = :rid'); params.rid = request_id; }
  if (session_id) { where.push('session_id = :sid'); params.sid = session_id; }
  if (fingerprint) { where.push('fingerprint = :fp'); params.fp = fingerprint; }
  if (status_class && /^[2-5]$/.test(String(status_class))) {
    where.push('status >= :scLo AND status < :scHi');
    params.scLo = Number(status_class) * 100;
    params.scHi = Number(status_class) * 100 + 100;
  }
  if (min_duration && Number(min_duration) > 0) {
    where.push('duration_ms >= :mdur');
    params.mdur = Number(min_duration);
  }

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
// 增强：24h 请求量 / 错误率 / 慢请求（计数·均值·最大耗时）/ 状态码分档分布。
export function getLogStats() {
  const byLevel = db.prepare(`SELECT level, COUNT(*) n, SUM(count) total FROM logs GROUP BY level`).all();
  const bySource = db.prepare(`SELECT source, COUNT(*) n, SUM(count) total FROM logs GROUP BY source`).all();
  const byCategory = db.prepare(`SELECT category, COUNT(*) n, SUM(count) total FROM logs GROUP BY category`).all();
  // 最近 24h 的 error/fatal 计数（红色告警指标）
  const since24h = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const recentErrors = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs WHERE level IN ('error','fatal') AND ts >= ?`).get(since24h);
  const total = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs`).get();
  // 24h API 请求统计（category='api' 的访问日志）：量 / 慢请求 / 耗时分布 / 状态码分档
  const api24h = db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(count),0) total,
            COALESCE(SUM(CASE WHEN duration_ms >= 1500 THEN 1 ELSE 0 END),0) slow_n,
            COALESCE(ROUND(AVG(duration_ms)),0) avg_ms,
            COALESCE(MAX(duration_ms),0) max_ms
     FROM logs WHERE category = 'api' AND ts >= ?`
  ).get(since24h);
  const byStatusClass = db.prepare(
    `SELECT (status / 100) AS klass, COUNT(*) n FROM logs
     WHERE category = 'api' AND status >= 100 AND ts >= ? GROUP BY klass ORDER BY klass`
  ).all(since24h);
  const reqTotal = api24h?.total || 0;
  const errRate = reqTotal > 0 ? Math.round((recentErrors.total / reqTotal) * 1000) / 10 : 0;
  return {
    total: total.n || 0,
    total_with_count: total.total || 0,
    recent_errors_24h: recentErrors.n || 0,
    recent_errors_24h_total: recentErrors.total || 0,
    api_24h: {
      requests: reqTotal, slow: api24h?.slow_n || 0,
      avg_ms: api24h?.avg_ms || 0, max_ms: api24h?.max_ms || 0,
      error_rate: errRate,
      by_status_class: byStatusClass.map(r => ({ klass: `${r.klass}xx`, n: r.n })),
    },
    by_level: byLevel, by_source: bySource, by_category: byCategory,
  };
}

// 时间序列统计：按小时/天聚合，用于 GM 后台趋势图。
// window: 'hour' (最近24小时, 每小时) | 'day' (最近30天, 每天)
// 返回零填充的完整桶序列（空档补 0，趋势图不再「缺牙」），并带各级别分项计数
// （前端可叠加错误曲线）。level 过滤参数保留兼容。
export function getLogTimeseries(window = 'hour', level = '') {
  const levelCaseExpr = `CASE level WHEN 'fatal' THEN 50 WHEN 'error' THEN 40 WHEN 'warn' THEN 30 WHEN 'info' THEN 20 ELSE 10 END`;
  const isHour = window !== 'day';
  const fmt = isHour ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
  const range = isHour ? '-24 hours' : '-30 days';
  let sql = `SELECT strftime('${fmt}', ts) AS bucket, level, COUNT(*) n, SUM(count) total
             FROM logs WHERE ts >= datetime('now', '${range}')`;
  const params = [];
  if (level && LEVEL_WEIGHT[level]) { sql += ` AND ${levelCaseExpr} >= ?`; params.push(LEVEL_WEIGHT[level]); }
  sql += ` GROUP BY bucket, level ORDER BY bucket ASC`;
  const rows = db.prepare(sql).all(...params);

  // 零填充：生成完整桶序列（UTC，与 SQLite datetime('now') 口径一致）。
  const byBucket = new Map();
  for (const r of rows) {
    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, { bucket: r.bucket, n: 0, total: 0, errors: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
    const b = byBucket.get(r.bucket);
    b.n += r.n; b.total += r.total || r.n;
    if (r.level in b) b[r.level] += r.n;
    if (r.level === 'error' || r.level === 'fatal') b.errors += r.n;
  }
  const out = [];
  const now = Date.now();
  const steps = isHour ? 24 : 30;
  const stepMs = isHour ? 3600_000 : 86400_000;
  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(now - i * stepMs);
    const key = isHour
      ? d.toISOString().slice(0, 13).replace('T', ' ') + ':00'
      : d.toISOString().slice(0, 10);
    out.push(byBucket.get(key) || { bucket: key, n: 0, total: 0, errors: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
  }
  return out;
}

// TOP 统计：按 event / endpoint / user / ip / category 聚合，找出高频事件 / 热点接口 /
// 活跃用户 / 高频 IP / 高频类别；dim='slow' 时按接口平均耗时降序找慢接口。
export function getLogTop(dim = 'event', level = '', limit = 10) {
  const levelCaseExpr = `CASE level WHEN 'fatal' THEN 50 WHEN 'error' THEN 40 WHEN 'warn' THEN 30 WHEN 'info' THEN 20 ELSE 10 END`;
  const lim = Math.min(Number(limit) || 10, 50);
  if (dim === 'slow') {
    // 慢接口榜：只看访问日志，按平均耗时降序（至少 3 次调用，剔除偶发抖动）。
    return db.prepare(
      `SELECT endpoint AS key, COUNT(*) n, SUM(count) total,
              ROUND(AVG(duration_ms)) avg_ms, MAX(duration_ms) max_ms
       FROM logs WHERE category = 'api' AND endpoint != '' AND duration_ms > 0
       GROUP BY endpoint HAVING COUNT(*) >= 3 ORDER BY avg_ms DESC LIMIT ?`
    ).all(lim);
  }
  let col;
  if (dim === 'event') col = 'event';
  else if (dim === 'endpoint') col = 'endpoint';
  else if (dim === 'user') col = 'user_id';
  else if (dim === 'ip') col = 'ip';
  else if (dim === 'category') col = 'category';
  else if (dim === 'status') col = 'status';
  else col = 'event';
  let sql = `SELECT ${col} AS key, COUNT(*) n, SUM(count) total FROM logs WHERE ${col} != '' AND ${col} IS NOT NULL`;
  if (col === 'status') sql = `SELECT status AS key, COUNT(*) n, SUM(count) total FROM logs WHERE status >= 100`;
  const params = [];
  if (level && LEVEL_WEIGHT[level]) { sql += ` AND ${levelCaseExpr} >= ?`; params.push(LEVEL_WEIGHT[level]); }
  sql += ` GROUP BY ${col} ORDER BY total DESC LIMIT ?`;
  params.push(lim);
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

// 日志保留清理：按级别分级保留（天数由 getLogRetention 提供，GM 可调）。
// 由 index.js 定时调用，与 purgeExpiredCodes 同模式。返回清理条数。
export function purgeOldLogs() {
  const retention = getLogRetention();
  let removed = 0;
  for (const [level, days] of Object.entries(retention)) {
    const r = db.prepare(`DELETE FROM logs WHERE level = ? AND ts < datetime('now', ?)`).run(level, `-${days} days`);
    removed += r.changes;
  }
  return removed;
}

// 手动定向清理：GM 后台「清理」的进阶形态 —— 可指定级别与「早于 N 天」。
// days=0 表示该级别全清（GM 显式操作，配审计）。不传 level 则全部级别按 days 清。
export function purgeLogs({ level = '', days = null } = {}) {
  if (days == null || !Number.isFinite(Number(days))) return purgeOldLogs();
  const d = Math.min(365, Math.max(0, Math.round(Number(days))));
  if (level && VALID_LEVELS.has(level)) {
    return db.prepare(`DELETE FROM logs WHERE level = ? AND ts < datetime('now', ?)`).run(level, `-${d} days`).changes;
  }
  return db.prepare(`DELETE FROM logs WHERE ts < datetime('now', ?)`).run(`-${d} days`).changes;
}
