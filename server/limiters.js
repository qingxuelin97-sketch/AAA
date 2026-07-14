// per-user 速率限制器：仅对 GM（root）账号生效，普通用户不限流。
// 策略：开放普通用户的使用体验，仅对管理员账号保留配额——管理员账号一旦
// 被盗用，配额仍是兜底；普通用户无论 IP/设备如何使用都不再触发限流。
import rateLimit from 'express-rate-limit';

// 已登录的非管理员用户一律放行；管理员与匿名（未登录）请求仍按配额计量。
const skipForNonGm = (req) => !!req.user?.id && !req.user.is_gm;

const mk = (max, windowMs, msg = '操作过于频繁，请稍后再试') => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : req.ip),
  handler: (req, res) => res.status(429).json({ error: msg }),
  skip: skipForNonGm,
});

// AI 类（生图/TTS/对话补全/剧场演绎）：每用户每分钟 12 次
export const aiLimiter = mk(12, 60_000, 'AI 调用过于频繁，请稍后再试');
// 内容创建（发帖/评论/动态/私信）：每用户每分钟 10 次
export const contentLimiter = mk(10, 60_000, '发言过于频繁，请稍后再试');
// 文件上传：每用户每分钟 5 次
export const uploadLimiter = mk(5, 60_000, '上传过于频繁，请稍后再试');
