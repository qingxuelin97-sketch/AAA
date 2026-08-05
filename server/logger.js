// 统一日志模块 —— 三端（服务端 / 桌面网页 / 移动网页 / APP）所有日志的中枢。
//
// 设计目标：
//   1) 同步写库（better-sqlite3 同步，单次 INSERT 微秒级），日志不阻塞主业务、不丢上下文。
//   2) 指纹去重：相同 source+category+event+message 的日志在短窗口内合并计数，避免崩溃风暴撑爆 DB。
//   3) 链路追踪：request_id 串联一次 HTTP 请求内的所有日志，便于复盘。
//   4) 实时告警：error/fatal 级别即时通过 SSE 推送给在线 GM（broadcastGm 定向，
//      绝不进普通用户事件流 —— 错误摘要含接口路径/异常消息，属内部信息）。
//   5) 实时日志流（live tail）：GM 在日志台开启后，所有新日志秒级推送到其
//      SSE 连接（10 分钟自动过期，客户端定时续订）。未开启时零开销。
//   6) 分级保留：默认 debug 3d / info 7d / warn 30d / error+fatal 90d，可由 GM 在
//      后台按级别调整（app_config.log_retention），定时清理；开启归档后，
//      清理前自动把被删行写入 NDJSON.gz 归档文件（server/log-archives/）。
//   7) 智能采样：debug 级别在高频场景按比率采样，避免噪声淹没信号。
//   8) 规则告警引擎：多条规则（错误风暴 / 慢请求风暴 / 指定事件监控），
//      各自独立的阈值/窗口/冷却，触发时站内通知全体 GM。规则存
//      app_config.log_alert_rules，GM 后台可增删改。
//
// 写库失败只 console.error，绝不抛出 —— 日志不能拖垮主业务。

import db from './db.js';
import { broadcastGm, push } from './realtime.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_SOURCES = new Set(['server', 'client', 'app']);

// 指纹去重窗口：相同指纹在此时间窗内（毫秒）合并为一条，count++。
const DEDUP_WINDOW_MS = 60_000;
// debug 级别采样率：高频 debug 日志只保留 10%，避免噪声。
const DEBUG_SAMPLE_RATE = 0.1;
// 慢请求阈值（与 index.js 访问日志口径一致）。
const SLOW_MS = 1500;

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

const sqliteNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

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

// —— 可配置项（存 app_config，GM 后台可改） ——

const RETENTION_DEFAULTS = { debug: 3, info: 7, warn: 30, error: 90, fatal: 90 };

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

// 保留策略：各级别天数，钳制 1–365；archive 开关控制清理前是否归档。
export function getLogRetention() {
  const cfg = readConfig('log_retention') || {};
  const out = { ...RETENTION_DEFAULTS, archive: !!cfg.archive };
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
  if (patch.archive != null) cur.archive = !!patch.archive;
  writeConfig('log_retention', cur);
  return cur;
}

// —— 规则告警引擎 ——
// 规则类型：
//   error_burst —— 窗口期内 error/fatal 累计（含合并计数）达到阈值
//   slow_burst  —— 窗口期内慢请求（api 访问日志 duration_ms >= 1500）条数达到阈值
//   event_match —— 窗口期内指定事件（可选叠加 category/level）累计达到阈值
// 每条规则独立冷却，触发时站内通知全体 GM + SSE audit_alert。
const ALERT_TYPES = new Set(['error_burst', 'slow_burst', 'event_match']);
const DEFAULT_RULES = [
  { id: 'error-burst', name: '错误风暴', enabled: true, type: 'error_burst', threshold: 10, window_min: 5, cooldown_min: 15 },
];

function sanitizeRule(r, idx) {
  if (!r || typeof r !== 'object') return null;
  const type = ALERT_TYPES.has(r.type) ? r.type : 'error_burst';
  const rule = {
    id: /^[A-Za-z0-9_-]{1,40}$/.test(String(r.id || '')) ? String(r.id) : `rule-${idx}-${crypto.randomBytes(3).toString('hex')}`,
    name: clip(String(r.name || type), 40),
    enabled: r.enabled == null ? true : !!r.enabled,
    type,
    threshold: Math.min(10000, Math.max(1, Math.round(Number(r.threshold)) || 10)),
    window_min: Math.min(1440, Math.max(1, Math.round(Number(r.window_min)) || 5)),
    cooldown_min: Math.min(1440, Math.max(1, Math.round(Number(r.cooldown_min)) || 15)),
  };
  if (type === 'event_match') {
    rule.event = clip(String(r.event || ''), 120);
    if (!rule.event) return null; // 事件监控必须指定事件名
    if (r.category) rule.category = clip(String(r.category), 40);
    if (r.level && VALID_LEVELS.has(r.level)) rule.level = r.level;
  }
  return rule;
}

export function getLogAlertRules() {
  const cfg = readConfig('log_alert_rules');
  if (cfg && Array.isArray(cfg.rules)) {
    return cfg.rules.map(sanitizeRule).filter(Boolean);
  }
  // 从旧版单规则配置（log_alerts）迁移
  const legacy = readConfig('log_alerts');
  if (legacy) {
    const migrated = [sanitizeRule({
      id: 'error-burst', name: '错误风暴', enabled: legacy.enabled == null ? true : !!legacy.enabled,
      type: 'error_burst', threshold: legacy.threshold, window_min: legacy.window_min, cooldown_min: legacy.cooldown_min,
    }, 0)].filter(Boolean);
    writeConfig('log_alert_rules', { rules: migrated });
    return migrated;
  }
  return DEFAULT_RULES.map(r => ({ ...r }));
}
export function setLogAlertRules(rules = []) {
  const list = (Array.isArray(rules) ? rules : []).slice(0, 10).map(sanitizeRule).filter(Boolean);
  writeConfig('log_alert_rules', { rules: list });
  return list;
}

// 每条规则的上次触发时间（内存即可：重启后最多多发一次，无害）。
const ruleFiredAt = new Map(); // rule.id -> ms

function ruleMatchesInsert(rule, row) {
  if (rule.type === 'error_burst') return row.level === 'error' || row.level === 'fatal';
  if (rule.type === 'slow_burst') return row.category === 'api' && row.duration_ms >= SLOW_MS;
  if (rule.type === 'event_match') {
    if (row.event !== rule.event) return false;
    if (rule.category && row.category !== rule.category) return false;
    if (rule.level && row.level !== rule.level) return false;
    return true;
  }
  return false;
}

function ruleWindowCount(rule) {
  const win = `-${rule.window_min} minutes`;
  if (rule.type === 'error_burst') {
    return db.prepare(`SELECT COALESCE(SUM(count),0) n FROM logs WHERE level IN ('error','fatal') AND ts >= datetime('now', ?)`).get(win).n;
  }
  if (rule.type === 'slow_burst') {
    return db.prepare(`SELECT COUNT(*) n FROM logs WHERE category = 'api' AND duration_ms >= ${SLOW_MS} AND ts >= datetime('now', ?)`).get(win).n;
  }
  // event_match
  const where = ['event = :evt', 'ts >= datetime(\'now\', :win)'];
  const params = { evt: rule.event, win };
  if (rule.category) { where.push('category = :cat'); params.cat = rule.category; }
  if (rule.level) { where.push('level = :lv'); params.lv = rule.level; }
  return db.prepare(`SELECT COALESCE(SUM(count),0) n FROM logs WHERE ${where.join(' AND ')}`).get(params).n;
}

function notifyGms(text, link = '/admin') {
  const gms = db.prepare('SELECT id FROM users WHERE is_gm = 1 AND is_banned = 0').all();
  for (const g of gms) {
    try {
      const info = db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(g.id, text, link);
      push(g.id, 'notification', { id: Number(info.lastInsertRowid), text, link, created_at: new Date().toISOString(), read: 0 });
    } catch { /* 单个 GM 通知失败不影响其余 */ }
  }
}

// 规则检查：每条日志落库后调用。先按「规则匹配本条 + 冷却期已过」双闸门过滤，
// 命中才做一次窗口计数查询 —— 平时零额外查询开销。告警动作自身出错绝不外抛。
function maybeFireAlerts(row) {
  if (row.event === 'log_alert_fired') return; // 告警留痕自身不再参与告警
  try {
    const rules = getLogAlertRules();
    const now = Date.now();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!ruleMatchesInsert(rule, row)) continue;
      if (now - (ruleFiredAt.get(rule.id) || 0) < rule.cooldown_min * 60_000) continue;
      const n = ruleWindowCount(rule);
      if (n < rule.threshold) continue;
      ruleFiredAt.set(rule.id, now);
      const what = rule.type === 'error_burst' ? '错误' : rule.type === 'slow_burst' ? '慢请求' : `事件「${rule.event}」`;
      const text = `⚠️ 日志告警「${rule.name}」：最近 ${rule.window_min} 分钟内累计 ${n} 条${what}（阈值 ${rule.threshold}），请前往 GM 控制台 → 日志 排查。`;
      notifyGms(text);
      broadcastGm('audit_alert', { rule_id: rule.id, rule_name: rule.name, type: rule.type, total: n, threshold: rule.threshold, window_min: rule.window_min, ts: new Date().toISOString() });
      log({ level: 'info', source: 'server', category: 'system', event: 'log_alert_fired', message: text, extra: { rule } });
    }
  } catch (e) {
    console.error('[logger] 告警检查失败:', e.message);
  }
}

// —— 实时日志流（live tail）——
// GM 在日志台开启后，10 分钟内所有新日志（轻量字段）逐条推送到其 SSE 连接；
// 客户端每 4 分钟续订。无人订阅时 pushTail 一次 size 判断即返回，零开销。
const tailSubscribers = new Map(); // userId -> expiresAtMs
export function setLogTail(userId, on) {
  if (on) tailSubscribers.set(userId, Date.now() + 10 * 60_000);
  else tailSubscribers.delete(userId);
  return { tailing: tailSubscribers.size };
}
export function tailCount() {
  const now = Date.now();
  for (const [uid, exp] of tailSubscribers) if (exp < now) tailSubscribers.delete(uid);
  return tailSubscribers.size;
}
function pushTail(row) {
  if (!tailSubscribers.size) return;
  const now = Date.now();
  for (const [uid, exp] of tailSubscribers) {
    if (exp < now) { tailSubscribers.delete(uid); continue; }
    try { push(uid, 'logline', row); } catch { /* */ }
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
    const liteRow = {
      ts: sqliteNow(), level: lv, source: src, category, event: clip(event, 120),
      message: clip(message, 300), user_id: user_id || null, endpoint: clip(endpoint, 300),
      method: clip(method, 10), status: Number(status) || 0, duration_ms: Number(duration_ms) || 0,
      request_id: clip(request_id, 64), session_id: clip(session_id, 64), count: cnt,
    };

    // 指纹去重：error/warn 级别在窗口内合并，避免崩溃风暴。
    // info/debug 不去重（业务事件每条都有意义）。
    if (lv === 'error' || lv === 'warn' || lv === 'fatal') {
      const recent = findRecentByFingerprintStmt.get(fp, `-${DEDUP_WINDOW_MS / 1000} seconds`);
      if (recent) {
        bumpCountStmt.run(cnt, recent.id);
        // 仍然推送给在线 GM（让后台看到「又来了一次」的实时脉冲）。
        if (lv === 'error' || lv === 'fatal') {
          try { broadcastGm('audit', { id: recent.id, level: lv, source: src, category, event, message: clip(message, 200), dedup: true, ts: new Date().toISOString() }); } catch { /* */ }
        }
        pushTail({ ...liteRow, id: recent.id, dedup: true });
        maybeFireAlerts(liteRow);
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
    }
    pushTail({ ...liteRow, id });
    maybeFireAlerts(liteRow);
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
// 增强：24h 请求量 / 错误率 / 慢请求（计数·均值·最大耗时）/ 状态码分档分布，
// 以及「昨日同窗」对比（prev_24h：25–48h 前），前端据此显示环比箭头。
export function getLogStats() {
  const byLevel = db.prepare(`SELECT level, COUNT(*) n, SUM(count) total FROM logs GROUP BY level`).all();
  const bySource = db.prepare(`SELECT source, COUNT(*) n, SUM(count) total FROM logs GROUP BY source`).all();
  const byCategory = db.prepare(`SELECT category, COUNT(*) n, SUM(count) total FROM logs GROUP BY category`).all();
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const since24h = iso(Date.now() - 86400000);
  const since48h = iso(Date.now() - 2 * 86400000);
  const recentErrors = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs WHERE level IN ('error','fatal') AND ts >= ?`).get(since24h);
  const total = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs`).get();
  const apiWindow = (lo, hi) => db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(count),0) total,
            COALESCE(SUM(CASE WHEN duration_ms >= ${SLOW_MS} THEN 1 ELSE 0 END),0) slow_n,
            COALESCE(ROUND(AVG(duration_ms)),0) avg_ms,
            COALESCE(MAX(duration_ms),0) max_ms
     FROM logs WHERE category = 'api' AND ts >= ? ${hi ? 'AND ts < ?' : ''}`
  ).get(...(hi ? [lo, hi] : [lo]));
  const api24h = apiWindow(since24h, null);
  const apiPrev = apiWindow(since48h, since24h);
  const prevErrors = db.prepare(`SELECT COALESCE(SUM(count),0) total FROM logs WHERE level IN ('error','fatal') AND ts >= ? AND ts < ?`).get(since48h, since24h);
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
    prev_24h: {
      requests: apiPrev?.total || 0, slow: apiPrev?.slow_n || 0,
      avg_ms: apiPrev?.avg_ms || 0, errors: prevErrors?.total || 0,
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

// —— 分析查询 ——

// 延迟分位：最近 24h API 访问日志的 P50/P95/P99（全局 + 请求量 TOP12 接口逐个）。
// SQLite 无窗口分位函数，用「计数 + ORDER BY LIMIT 1 OFFSET k」精确取分位（微秒级点查）。
export function getLatencyStats() {
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const pct = (whereSql, params, n) => {
    if (!n) return { p50: 0, p95: 0, p99: 0 };
    const at = (q) => db.prepare(
      `SELECT duration_ms v FROM logs WHERE ${whereSql} ORDER BY duration_ms LIMIT 1 OFFSET ?`
    ).get(...params, Math.min(n - 1, Math.floor(n * q)))?.v || 0;
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  };
  const gWhere = `category = 'api' AND ts >= ?`;
  const g = db.prepare(`SELECT COUNT(*) n, COALESCE(ROUND(AVG(duration_ms)),0) avg_ms, COALESCE(MAX(duration_ms),0) max_ms FROM logs WHERE ${gWhere}`).get(since);
  const global = { count: g.n, avg_ms: g.avg_ms, max_ms: g.max_ms, ...pct(gWhere, [since], g.n) };
  const tops = db.prepare(
    `SELECT endpoint, COUNT(*) n, COALESCE(ROUND(AVG(duration_ms)),0) avg_ms, COALESCE(MAX(duration_ms),0) max_ms
     FROM logs WHERE category = 'api' AND endpoint != '' AND ts >= ?
     GROUP BY endpoint ORDER BY n DESC LIMIT 12`
  ).all(since);
  const eWhere = `category = 'api' AND endpoint = ? AND ts >= ?`;
  const endpoints = tops.map(t => ({
    endpoint: t.endpoint, count: t.n, avg_ms: t.avg_ms, max_ms: t.max_ms,
    ...pct(eWhere, [t.endpoint, since], t.n),
  }));
  return { global, endpoints };
}

// 活跃热力图：最近 30 天，北京时间 星期×小时 的日志量与错误量矩阵。
export function getLogHeatmap() {
  const rows = db.prepare(
    `SELECT CAST(strftime('%w', datetime(ts, '+8 hours')) AS INTEGER) dow,
            CAST(strftime('%H', datetime(ts, '+8 hours')) AS INTEGER) hh,
            COUNT(*) n,
            SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) errors
     FROM logs WHERE ts >= datetime('now', '-30 days')
     GROUP BY dow, hh`
  ).all();
  // 7×24 矩阵（dow: 0=周日 … 6=周六，北京时间）
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, errors: 0 })));
  for (const r of rows) {
    if (r.dow >= 0 && r.dow < 7 && r.hh >= 0 && r.hh < 24) matrix[r.dow][r.hh] = { n: r.n, errors: r.errors };
  }
  return matrix;
}

// 用户会话轨迹：按 session_id 聚合（首末时间 / 条数 / 错误数 / 端），用于
// 「这个用户这几天都经历了什么」的快速定位。不传 user_id 时返回全站最近会话。
export function getLogSessions({ user_id = '', limit = 20 } = {}) {
  const lim = Math.min(Number(limit) || 20, 50);
  const where = [`session_id != ''`];
  const params = [];
  if (user_id) { where.push('user_id = ?'); params.push(Number(user_id) || 0); }
  return db.prepare(
    `SELECT session_id, MIN(ts) first_ts, MAX(ts) last_ts, COUNT(*) n, SUM(count) total,
            SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) errors,
            MAX(source) source, MAX(user_id) user_id
     FROM logs WHERE ${where.join(' AND ')}
     GROUP BY session_id ORDER BY last_ts DESC LIMIT ?`
  ).all(...params, lim);
}

// —— 查询书签（GM 常用过滤组合，存 app_config.log_views）——
export function getLogViews() {
  const cfg = readConfig('log_views');
  return (cfg && Array.isArray(cfg.views)) ? cfg.views.slice(0, 20) : [];
}
export function setLogViews(views = []) {
  const list = (Array.isArray(views) ? views : []).slice(0, 20).map((v, i) => ({
    id: /^[A-Za-z0-9_-]{1,40}$/.test(String(v?.id || '')) ? String(v.id) : `view-${i}-${crypto.randomBytes(3).toString('hex')}`,
    name: clip(String(v?.name || `视图${i + 1}`), 30),
    params: (v?.params && typeof v.params === 'object') ? Object.fromEntries(
      Object.entries(v.params).filter(([k]) => [
        'level', 'source', 'category', 'event', 'q', 'user_id', 'endpoint',
        'request_id', 'session_id', 'fingerprint', 'status_class', 'min_duration', 'preset',
      ].includes(k)).map(([k, val]) => [k, clip(String(val), 200)])
    ) : {},
  }));
  writeConfig('log_views', { views: list });
  return list;
}

// —— 归档 ——
// 清理前把被删行写入 NDJSON.gz（每次清理一个文件），GM 可列出 / 下载 / 删除，
// 也可「立即归档」当前过滤命中的行（只归档不删除）。
const ARCHIVE_DIR = path.join(__dirname, 'log-archives');
const ARCHIVE_NAME_RE = /^logs-[A-Za-z0-9_.-]+\.ndjson\.gz$/;

function archiveRows(rows, label = 'purge') {
  if (!rows.length) return null;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `logs-${label}-${stamp}.ndjson.gz`;
  const buf = zlib.gzipSync(Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8'));
  fs.writeFileSync(path.join(ARCHIVE_DIR, name), buf);
  return { file: name, count: rows.length, bytes: buf.length };
}

export function listLogArchives() {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    return fs.readdirSync(ARCHIVE_DIR)
      .filter(f => ARCHIVE_NAME_RE.test(f))
      .map(f => {
        const st = fs.statSync(path.join(ARCHIVE_DIR, f));
        return { file: f, bytes: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch { return []; }
}
export function logArchivePath(name) {
  if (!ARCHIVE_NAME_RE.test(String(name || ''))) return null;
  const p = path.join(ARCHIVE_DIR, name);
  return fs.existsSync(p) ? p : null;
}
export function deleteLogArchive(name) {
  const p = logArchivePath(name);
  if (!p) return false;
  fs.unlinkSync(p);
  return true;
}
// 立即归档（不删除）：可选 level 与「早于 N 天」。
export function archiveNow({ level = '', days = null } = {}) {
  const where = [];
  const params = [];
  if (level && VALID_LEVELS.has(level)) { where.push('level = ?'); params.push(level); }
  if (days != null && Number.isFinite(Number(days))) {
    where.push(`ts < datetime('now', ?)`);
    params.push(`-${Math.min(365, Math.max(0, Math.round(Number(days))))} days`);
  }
  const rows = db.prepare(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id LIMIT 200000`).all(...params);
  return archiveRows(rows, 'manual') || { file: null, count: 0, bytes: 0 };
}

// 日志保留清理：按级别分级保留（天数由 getLogRetention 提供，GM 可调）。
// 由 index.js 定时调用，与 purgeExpiredCodes 同模式。返回清理条数。
// 开启归档（retention.archive）时，清理前先把被删行写入归档文件。
export function purgeOldLogs() {
  const retention = getLogRetention();
  let removed = 0;
  const doomed = [];
  for (const [level, days] of Object.entries(retention)) {
    if (level === 'archive') continue;
    if (retention.archive) {
      doomed.push(...db.prepare(`SELECT * FROM logs WHERE level = ? AND ts < datetime('now', ?) LIMIT 100000`).all(level, `-${days} days`));
    }
    const r = db.prepare(`DELETE FROM logs WHERE level = ? AND ts < datetime('now', ?)`).run(level, `-${days} days`);
    removed += r.changes;
  }
  if (doomed.length) { try { archiveRows(doomed, 'purge'); } catch (e) { console.error('[logger] 归档失败:', e.message); } }
  return removed;
}

// 手动定向清理：GM 后台「清理」的进阶形态 —— 可指定级别与「早于 N 天」。
// days=0 表示该级别全清（GM 显式操作，配审计）。不传 level 则全部级别按 days 清。
export function purgeLogs({ level = '', days = null } = {}) {
  if (days == null || !Number.isFinite(Number(days))) return purgeOldLogs();
  const d = Math.min(365, Math.max(0, Math.round(Number(days))));
  const retention = getLogRetention();
  const where = level && VALID_LEVELS.has(level) ? 'level = ? AND ts < datetime(\'now\', ?)' : 'ts < datetime(\'now\', ?)';
  const params = level && VALID_LEVELS.has(level) ? [level, `-${d} days`] : [`-${d} days`];
  if (retention.archive) {
    const doomed = db.prepare(`SELECT * FROM logs WHERE ${where} LIMIT 100000`).all(...params);
    if (doomed.length) { try { archiveRows(doomed, 'purge'); } catch (e) { console.error('[logger] 归档失败:', e.message); } }
  }
  return db.prepare(`DELETE FROM logs WHERE ${where}`).run(...params).changes;
}

// —— 健康自检：日志系统自身的体检报告（GM 设置页展示）——
export function getLogHealth() {
  const total = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(count),0) total FROM logs').get();
  const bounds = db.prepare('SELECT MIN(ts) oldest, MAX(ts) newest FROM logs').get();
  const lastHour = db.prepare(`SELECT COUNT(*) n FROM logs WHERE ts >= datetime('now', '-1 hour')`).get();
  const archives = listLogArchives();
  return {
    rows: total.n || 0,
    events: total.total || 0,
    dedup_ratio: total.n ? Math.round(((total.total || 0) / total.n) * 100) / 100 : 1,
    oldest_ts: bounds.oldest || null,
    newest_ts: bounds.newest || null,
    ingest_last_hour: lastHour.n || 0,
    tail_subscribers: tailCount(),
    archives: { count: archives.length, bytes: archives.reduce((s, a) => s + a.bytes, 0) },
    retention: getLogRetention(),
    alert_rules: getLogAlertRules().length,
  };
}
