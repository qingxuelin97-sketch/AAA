// Per-user rate limits apply uniformly. Skipping normal users made paid AI/TTS
// endpoints effectively unbounded and turned upstream failures into an abuse
// primitive. Authentication is mounted before these middleware functions, so
// a stable user id is used whenever available.
import rateLimit from 'express-rate-limit';

const mk = (max, windowMs, msg = '操作过于频繁，请稍后再试') => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : req.ip),
  handler: (req, res) => res.status(429).json({ error: msg }),
});

// 配额可由环境变量覆盖（与 index.js 的 API_AUTH_RATE_LIMIT / API_ANON_RATE_LIMIT
// 同一模式）：便于按部署规模调优，也让回归测试能把「限流」与「被测行为」解耦 ——
// 否则矩阵式的滥用测试会先把配额打空，后续用例全部收到 429 而测不到真实分支。
const envMax = (name, def) => Math.max(1, Number(process.env[name]) || def);

// AI 类（生图/TTS/对话补全/剧场演绎）：每用户每分钟 12 次
export const aiLimiter = mk(envMax('AI_RATE_LIMIT', 12), 60_000, 'AI 调用过于频繁，请稍后再试');
// 内容创建（发帖/评论/动态/私信）：每用户每分钟 10 次
export const contentLimiter = mk(envMax('CONTENT_RATE_LIMIT', 10), 60_000, '发言过于频繁，请稍后再试');
// 文件上传：每用户每分钟 5 次
export const uploadLimiter = mk(envMax('UPLOAD_RATE_LIMIT', 5), 60_000, '上传过于频繁，请稍后再试');
