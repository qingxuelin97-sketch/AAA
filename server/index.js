import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import characterRoutes from './routes/characters.js';
import settingsRoutes from './routes/settings.js';
import chatRoutes from './routes/chat.js';
import communityRoutes from './routes/community.js';
import userRoutes from './routes/users.js';
import economyRoutes from './routes/economy.js';
import scriptRoutes from './routes/scripts.js';
import socialRoutes from './routes/social.js';
import groupRoutes from './routes/groups.js';
import theaterRoutes from './routes/theater.js';
import metaRoutes from './routes/meta.js';
import announcementRoutes from './routes/announcements.js';
import adminRoutes from './routes/admin.js';
import engageRoutes from './routes/engage.js';
import aiRoutes from './routes/ai.js';
import achievementRoutes from './routes/achievements.js';
import meRoutes from './routes/me.js';
import parliamentRoutes from './routes/parliament.js';
import friendRoutes from './routes/friends.js';
import dmRoutes from './routes/dm.js';
import worldbookRoutes from './routes/worldbooks.js';
import novelRoutes from './routes/novels.js';
import realtimeRoutes from './routes/realtime.js';
import asrRoutes from './routes/asr.js';
import { log, purgeOldLogs, genRequestId } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// 反向代理（Nginx / 云负载均衡）之后运行时，信任第一跳代理设置的 X-Forwarded-For，
// 否则限流与登录锁定看到的全是代理 IP，一人触发限流会波及全站。
// 直接暴露公网（无代理）时设 TRUST_PROXY=0 关闭，防止客户端伪造 XFF 绕过按 IP 限流。
app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 1);

// CORS：来自环境变量 CORS_ORIGINS（逗号分隔）的白名单；未配置则允许所有来源，
// 保证同源部署（前后端在同一阿里云实例）和静态托管+独立后端的场景都能开箱可用。
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
);
app.use(cors({
  origin: (origin, cb) => {
    if (!ALLOWED_ORIGINS.size || !origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
  // 平台语音按句计费金额通过响应头返回（routes/chat.js /chat/tts）。跨域部署
  //（Capacitor 壳指向独立后端）时必须显式暴露，否则前端 res.headers.get 拿到 null，
  // 扣费提示与余额刷新静默失效。
  exposedHeaders: ['X-Gold-Fee', 'X-Gold-Balance'],
}));

// 安全头（CSP 由前端 index.html meta 单独配置，这里不覆盖以避免冲突）。
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // 上传资源可被前端同源/跨域加载
  referrerPolicy: { policy: 'no-referrer' },             // API 响应不外泄来源路径
  // HSTS 仅在确认全站 HTTPS 后由环境变量显式开启（HSTS=1），避免误伤 HTTP 调试部署。
  hsts: process.env.HSTS === '1' ? { maxAge: 15552000, includeSubDomains: true } : false,
}));

// API 速率限制：每分钟 240 次/IP，防基础滥用。只挂在 /api 上——
// 静态资源与 /uploads 图片不计数，否则头像密集的列表页会替用户吃光配额。
app.use('/api', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '10mb' }));

// —— 链路追踪 + 访问日志中间件 ——
// 每个请求注入 request_id（响应头回传 X-Request-Id，便于前端排查），
// 请求结束时按状态码分级落库（2xx=info / 4xx=warn / 5xx=error），慢请求额外标注。
// /realtime/stream 与 /health 不记录（前者长连接会刷爆，后者健康检查无意义）。
const SLOW_THRESHOLD_MS = 1500; // 慢请求阈值：超过 1.5s 标注
app.use('/api', (req, res, next) => {
  const start = Date.now();
  // 优先复用客户端传来的 request_id（前端 fetch 拦截器可生成），否则服务端生成。
  req.requestId = req.header('X-Request-Id') || genRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  // 暴露给跨域前端（Capacitor 壳指向独立后端时必须显式暴露，否则拿不到 null）。
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
  const skip = req.path === '/realtime/stream' || req.path === '/health';
  if (skip) return next();
  res.on('finish', () => {
    const dur = Date.now() - start;
    const status = res.statusCode;
    const path = req.path || '';
    const method = req.method || '';
    const ip = req.ip || '';
    const ua = req.header('user-agent') || '';
    const uid = req.user?.id || null;
    // 级别自动：5xx=error / 4xx=warn / 慢请求=warn / 其余=info
    let level = 'info';
    if (status >= 500) level = 'error';
    else if (status >= 400) level = 'warn';
    else if (dur > SLOW_THRESHOLD_MS) level = 'warn';
    // 静态资源（/uploads）已在上方独立挂载，不会走这里；这里只记 /api 下的业务请求。
    log({
      level, source: 'server', category: 'api', event: 'request',
      message: `${method} ${path} → ${status} ${dur}ms`,
      user_id: uid, ip, ua, endpoint: path, method, status, duration_ms: dur,
      extra: { slow: dur > SLOW_THRESHOLD_MS },
      request_id: req.requestId,
    });
  });
  next();
});

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
// 上传资源以附件形式下发并禁 MIME 嗅探，杜绝存储型 XSS（如 .html/.svg 内嵌脚本）。
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/users', userRoutes);
app.use('/api/economy', economyRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/theater', theaterRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/engage', engageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/me', meRoutes);
app.use('/api/parliament', parliamentRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/worldbooks', worldbookRoutes);
app.use('/api/novels', novelRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/asr', asrRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// —— 客户端日志上报端点 ——
// 三端（桌面网页 / 移动网页 / APP）统一上报：JS 异常、Promise 拒绝、React 崩溃、
// 业务自定义事件。无需鉴权（崩溃发生在登录前也要能上报），但按 IP 限流防刷。
// source 自动识别：UA 含 huanyu/capacitor 或带 X-Huanyu-App 头 → 'app'，否则 'client'。
const clientLogLimiter = rateLimit({
  windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: '日志上报过于频繁' },
});
app.post('/api/logs/client', clientLogLimiter, (req, res) => {
  const { level = 'info', event = 'client_log', message = '', extra = null, session_id = '', request_id = '' } = req.body || {};
  const ua = req.header('user-agent') || '';
  const isApp = /huanyu|capacitor/i.test(ua) || !!req.header('X-Huanyu-App');
  const source = isApp ? 'app' : 'client';
  log({
    level, source, category: isApp ? 'app' : 'client', event,
    message, ip: req.ip || '', ua, extra,
    session_id, request_id: request_id || req.header('X-Request-Id') || '',
    endpoint: req.header('referer') || '',
  });
  res.json({ ok: true });
});

// Serve built client (production) with SPA fallback.
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  // 不对外提供 sourcemap，避免泄露前端源码结构。
  app.use(express.static(clientDist, {
    setHeaders: (res, p) => { if (p.endsWith('.map')) res.setHeader('Content-Disposition', 'attachment'); },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// 统一错误处理：仅暴露带 err.expose 标记的客户端错误，其余返回通用提示，详情写日志。
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.expose ? err.message : (status < 500 ? err.message : '服务器内部错误');
  // 5xx 错误落库（带堆栈），便于 GM 后台排查；4xx 是客户端错误，访问日志已记录，不重复。
  if (status >= 500) {
    log({
      level: 'error', source: 'server', category: 'api', event: 'server_error',
      message: `${req.method} ${req.path} → ${status}: ${err.message}`,
      user_id: req.user?.id || null, ip: req.ip || '', ua: req.header('user-agent') || '',
      endpoint: req.path || '', method: req.method || '', status,
      extra: { stack: err.stack || '', name: err.name || '' },
      request_id: req.requestId || '',
    });
  }
  res.status(status).json({ error: message, request_id: req.requestId || undefined });
});

// —— 进程级异常捕获 ——
// 未处理的 Promise 拒绝与同步异常：落库为 fatal，避免进程静默崩溃无迹可寻。
// uncaughtException 仍退出进程（Node 建议），但先记日志；unhandledRejection 不退出（可恢复）。
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
  console.error('[unhandledRejection]', msg);
  try { log({ level: 'fatal', source: 'server', category: 'system', event: 'unhandled_rejection', message: String(reason?.message || reason || ''), extra: { stack: reason?.stack || '', name: reason?.name || '' } }); } catch { /* */ }
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  try { log({ level: 'fatal', source: 'server', category: 'system', event: 'uncaught_exception', message: err.message || '', extra: { stack: err.stack || '', name: err.name || '' } }); } catch { /* */ }
  // 给日志一点落库时间再退出（better-sqlite3 同步写，无需等）。
  process.exit(1);
});

// Start serving immediately (so platform health checks pass even if the DB is slow),
// then restore the rolling snapshot in the background and begin rolling saves.
// 显式绑定 0.0.0.0：确保外部（安全组放行的 4000 端口）可访问，避免某些环境下默认绑到 127.0.0.1。
app.listen(PORT, '0.0.0.0', () => console.log(`AI 聊天平台后端运行于 http://0.0.0.0:${PORT}`));
import('./persist.js').then(async ({ restoreOnBoot, startRolling }) => {
  await restoreOnBoot();
  startRolling();
}).catch(e => console.error('[persist] 初始化失败：', e.message));

// —— 日志保留清理任务 ——
// 启动时清理一次（清理上次运行遗留的过期日志），之后每 24h 一次。
try {
  const removed = purgeOldLogs();
  if (removed > 0) console.log(`[logger] 启动清理过期日志 ${removed} 条`);
} catch (e) { console.error('[logger] 启动清理失败:', e.message); }
setInterval(() => {
  try { purgeOldLogs(); } catch (e) { console.error('[logger] 定时清理失败:', e.message); }
}, 24 * 60 * 60 * 1000).unref();
