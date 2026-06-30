import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { attach } from '../realtime.js';
import { SECRET } from '../auth.js';

const router = Router();

// EventSource 不能带自定义 header，故 SSE 走 query token 鉴权。
// 复用 auth.js 的 SECRET 与 token_version 校验逻辑，保持与 Bearer 鉴权一致。
function sseAuth(req, res, next) {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  const user = db.prepare('SELECT id, username, display_name, is_banned, token_version FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  if (user.is_banned) return res.status(403).json({ error: '账号已被封禁' });
  if ((payload.tv ?? 0) !== (user.token_version ?? 0)) return res.status(401).json({ error: '登录态已失效' });
  req.user = user;
  next();
}

// 持久 SSE 流：客户端登录后建立一条连接，服务端由此秒级下发事件。
router.get('/stream', sseAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关闭 nginx/反代的缓冲，确保事件即时透传到客户端。
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 建连即刷新在线状态，好友列表立刻看到 TA 上线。
  try { db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(Date.now(), req.user.id); } catch { /* */ }

  // 握手事件：让客户端确认连接已就绪并拿到自己的 uid。
  res.write(`event: ready\ndata: ${JSON.stringify({ uid: req.user.id, at: Date.now() })}\n\n`);

  const detach = attach(req.user.id, res);
  req.on('close', detach);
});

export default router;
