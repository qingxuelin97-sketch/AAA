// per-user 速率限制器：按用户 id（登录后）或 IP 聚合，防脚本滥用。
import rateLimit from 'express-rate-limit';

const mk = (max, windowMs, msg = '操作过于频繁，请稍后再试') => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : req.ip),
  handler: (req, res) => res.status(429).json({ error: msg }),
});

// AI 类（生图/TTS/对话补全/剧场演绎）：每用户每分钟 12 次
export const aiLimiter = mk(12, 60_000, 'AI 调用过于频繁，请稍后再试');
// 内容创建（发帖/评论/动态/私信）：每用户每分钟 10 次
export const contentLimiter = mk(10, 60_000, '发言过于频繁，请稍后再试');
// 文件上传：每用户每分钟 5 次
export const uploadLimiter = mk(5, 60_000, '上传过于频繁，请稍后再试');
