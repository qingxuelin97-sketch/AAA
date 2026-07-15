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
import paymentRoutes from './routes/payments.js';
import { MAX_WEBHOOK_BYTES } from './payment.js';
import { log, purgeOldLogs, genRequestId } from './logger.js';
import jwt from 'jsonwebtoken';
import { SECRET } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// 信任代理策略（决定 req.ip = 真实客户端 IP，供限流/登录锁定按 IP 计）：
//  · 默认 'loopback'：只信任同机回环代理（如本机 Nginx 反代）设置的 XFF；
//    直连公网(如 APK 直连 :4000)时，公网客户端伪造的 XFF 一律不采信 → 无法绕过按 IP 限流。
//  · TRUST_PROXY=0 强制关闭；TRUST_PROXY=N 信任前 N 跳（多层代理/云 LB）。
const _tp = process.env.TRUST_PROXY;
app.set('trust proxy', (_tp == null || _tp === '') ? 'loopback' : (_tp === '0' ? false : (Number(_tp) || _tp)));
// 部署自检：Render / Railway / Fly 等 PaaS 的流量必经平台反代（非回环 IP），
// 默认 'loopback' 会拒信平台注入的 XFF → req.ip 退化成全体用户共享的代理 IP，
// 按 IP 的注册配额/登录锁定/匿名限流全部失效（要么全站互相误伤、要么形同虚设）。
// 这类平台必须显式设 TRUST_PROXY=1（层数按实际反代跳数），这里只大声告警不擅自改值——
// 直连公网的部署（阿里云 pm2 直听 :4000）默认 'loopback' 才是对的，改了反而开放 XFF 伪造。
if ((_tp == null || _tp === '') && (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME)) {
  console.error('[security] 检测到 PaaS 反代环境但未设置 TRUST_PROXY —— 按 IP 的限流/注册配额/登录锁定已退化为共享代理 IP，请设置 TRUST_PROXY=1（多层代理按实际跳数）。');
}

// CORS：来自环境变量 CORS_ORIGINS（逗号分隔）的白名单。未配置时不再对任意
// 来源放行 —— 默认只认 Capacitor/Ionic 原生壳 WebView 的固定来源；同源部署
//（前后端同一实例）的请求浏览器本就不做跨域拦截、无 Origin 的请求（curl /
// 原生 http 客户端 / 同源 GET）照常放行，两类主力场景零配置可用。
// 静态托管 + 独立后端的跨域 Web 部署需显式配置 CORS_ORIGINS（启动时有提示）。
// 注：cors 中间件对未匹配 origin 只是不下发 ACAO 头（浏览器侧拒读响应），
// 并不中断请求 —— 数据鉴权仍由各路由 authRequired 把关，此处是纵深防御，
// 收掉「任意网站可驱动已登录用户浏览器调 API / 放大爬取面」的口子。
// 原生壳 WebView 与本机开发器的来源：capacitor://localhost（iOS）、
// http(s)://localhost[:端口]（Android androidScheme / vite dev）。Origin 头
// 浏览器不可伪造，localhost 来源不构成跨站攻击面，默认放行不损防御。
const CAP_SHELL_ORIGIN_RE = /^(https?|capacitor|ionic):\/\/localhost(:\d+)?$/i;
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
);
if (!ALLOWED_ORIGINS.size && process.env.NODE_ENV === 'production') {
  console.warn('[security] CORS_ORIGINS 未配置：跨域仅默认放行原生壳来源（localhost / capacitor://）。独立托管的 Web 前端请显式设置 CORS_ORIGINS=https://你的域名。');
}
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // 同源 / curl / 原生客户端：无 Origin，无需 CORS 头
    if (ALLOWED_ORIGINS.size ? ALLOWED_ORIGINS.has(origin) : CAP_SHELL_ORIGIN_RE.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
  // 平台语音按句计费金额通过响应头返回（routes/chat.js /chat/tts）。跨域部署
  //（Capacitor 壳指向独立后端）时必须显式暴露，否则前端 res.headers.get 拿到 null，
  // 扣费提示与余额刷新静默失效。X-Request-Id 供前端排查链路（这里统一声明，
  // 下方链路追踪中间件不得再 setHeader 覆盖本列表）。
  exposedHeaders: ['X-Gold-Fee', 'X-Gold-Balance', 'X-Request-Id'],
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
// 全局限流分层（反爬虫）：登录用户 240 次/分钟不变；未登录（或持伪造/过期
// token）降到 60 次/分钟 —— 公开广场接口（角色/剧本列表等）是无本万利的
// 爬取面，匿名爬虫的预算砍到 1/4，正常游客浏览远用不到这个量。
// 这里只验 JWT 签名（纯内存 HMAC，微秒级），不查库；数据鉴权仍由各路由的
// authRequired 全量把关，此标记只用于限流分档，伪造不了签名就到不了高档。
app.use('/api', (req, _res, next) => {
  req.rlAuthed = false;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { jwt.verify(h.slice(7), SECRET, { algorithms: ['HS256'] }); req.rlAuthed = true; } catch { /* 按匿名档 */ }
  }
  // 原生壳设备标识（反单设备多注册，见 routes/auth.js /register）。仅做格式
  // 校验，不合法即丢弃 —— 该值本质是客户端自报（root/模拟器可伪造），只作
  // 配额与审计信号，不承担鉴权，任何路由不得据此放宽权限。
  const did = String(req.headers['x-device-id'] || '');
  req.deviceId = /^[A-Za-z0-9-]{8,64}$/.test(did) ? did : '';
  next();
});
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: (req) => (req.rlAuthed
    ? Math.max(1, Number(process.env.API_AUTH_RATE_LIMIT) || 240)
    : Math.max(1, Number(process.env.API_ANON_RATE_LIMIT) || 60)),
  standardHeaders: true,
  legacyHeaders: false,
  // Login has stricter database-backed account+IP and IP-only buckets. Letting
  // the anonymous 60/min middleware run first would make its specified 100/min
  // spray ceiling unreachable and would not be shared across workers.
  skip: (req) => req.method === 'POST' && (
    req.path === '/auth/login'
    // Payment providers commonly share an egress IP. Exact webhook routes use
    // their own signature-aware 120/min limiter below; applying the anonymous
    // 60/min bucket first would make valid callback bursts impossible.
    || /^\/payments\/[A-Za-z0-9._-]+\/webhook$/.test(req.path)
  ),
}));

app.use('/api/payments', (req, res, next) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return res.status(413).json({ error: '支付回调请求体过大', code: 'PAYMENT_WEBHOOK_TOO_LARGE' });
  }
  next();
});
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || '2mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/payments/')) {
      if (buf.length > MAX_WEBHOOK_BYTES) {
        const error = new Error('支付回调请求体过大');
        error.status = 413;
        throw error;
      }
      req.rawBody = Buffer.from(buf);
    }
  },
}));

// —— 链路追踪 + 访问日志中间件 ——
// 每个请求注入 request_id（响应头回传 X-Request-Id，便于前端排查），
// 请求结束时按状态码分级落库（2xx=info / 4xx=warn / 5xx=error），慢请求额外标注。
// /realtime/stream 与 /health 不记录（前者长连接会刷爆，后者健康检查无意义）。
const SLOW_THRESHOLD_MS = 1500; // 慢请求阈值：超过 1.5s 标注
app.use('/api', (req, res, next) => {
  const start = Date.now();
  // 优先复用客户端传来的 request_id（前端 fetch 拦截器可生成），否则服务端生成。
  const suppliedRequestId = req.header('X-Request-Id') || '';
  req.requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedRequestId) ? suppliedRequestId : genRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  // 跨域暴露统一在上方 cors 的 exposedHeaders 声明（含 X-Request-Id / X-Gold-*）。
  // 此处不可再 setHeader('Access-Control-Expose-Headers')——那会整体覆盖 cors 写入的
  // 列表，导致 Capacitor 壳读不到 /chat/tts 的计费头（历史 bug）。
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
app.use('/api/payments', paymentRoutes);
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
async function startServer() {
  const { restoreOnBoot, startRolling } = await import('./persist.js');
  // Restoring after listen() allowed real requests to write into a database
  // that could then be overwritten. Business traffic now starts only after a
  // successful restore (or after confirming persistence is disabled).
  await restoreOnBoot();
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`AI 聊天平台后端运行于 http://0.0.0.0:${PORT}`));
  startRolling();
  return server;
}

startServer().catch((err) => {
  console.error('[startup] 初始化失败，拒绝对外提供业务流量：', err);
  process.exitCode = 1;
});

// —— 日志保留清理任务 ——
// 启动时清理一次（清理上次运行遗留的过期日志），之后每 24h 一次。
try {
  const removed = purgeOldLogs();
  if (removed > 0) console.log(`[logger] 启动清理过期日志 ${removed} 条`);
} catch (e) { console.error('[logger] 启动清理失败:', e.message); }
setInterval(() => {
  try { purgeOldLogs(); } catch (e) { console.error('[logger] 定时清理失败:', e.message); }
}, 24 * 60 * 60 * 1000).unref();
