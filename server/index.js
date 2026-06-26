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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// CORS 白名单：来自环境变量 CORS_ORIGINS（逗号分隔），未配置则仅允许同源。
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(null, false); // 不抛错，仅不带 ACAO 头，浏览器即拦截
  },
  credentials: false,
}));

// 安全头（CSP 由前端 index.html meta 单独配置，这里不覆盖以避免冲突）。
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // 上传资源可被前端同源/跨域加载
}));

// 全局速率限制：每分钟 240 次/IP，防基础滥用。
app.use(rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '10mb' }));

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
app.get('/api/health', (req, res) => res.json({ ok: true }));

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
  res.status(status).json({ error: message });
});

// Start serving immediately (so platform health checks pass even if the DB is slow),
// then restore the rolling snapshot in the background and begin rolling saves.
app.listen(PORT, () => console.log(`AI 聊天平台后端运行于 http://localhost:${PORT}`));
import('./persist.js').then(async ({ restoreOnBoot, startRolling }) => {
  await restoreOnBoot();
  startRolling();
}).catch(e => console.error('[persist] 初始化失败：', e.message));
