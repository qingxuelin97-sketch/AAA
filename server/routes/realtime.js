import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db.js';
import { attach } from '../realtime.js';
import { SECRET, authRequired } from '../auth.js';

const router = Router();

// —— 一次性 SSE 建连 ticket ——
// EventSource 不能带自定义 header；query 里放长效 JWT 会被代理/访问日志记录。
// 客户端先用 Bearer 鉴权换一张 60 秒内有效、单次使用的随机 ticket，再拿它建连，
// 即使 URL 被日志记录也无法重放。旧客户端仍可走 ?token=（JWT）兼容路径。
const TICKET_TTL = 60_000;
const tickets = new Map(); // ticket -> { uid, exp }
function sweepTickets() {
  const now = Date.now();
  for (const [t, v] of tickets) if (v.exp < now) tickets.delete(t);
}
router.post('/ticket', authRequired, (req, res) => {
  sweepTickets();
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { uid: req.user.id, exp: Date.now() + TICKET_TTL });
  res.json({ ticket, ttl: TICKET_TTL });
});

// 校验用户可用性（存在 / 未封禁），ticket 与 token 两条路径共用。
function loadUsableUser(id, res) {
  const user = db.prepare('SELECT id, username, display_name, is_banned, token_version FROM users WHERE id = ?').get(id);
  if (!user) { res.status(401).json({ error: '账号不存在' }); return null; }
  if (user.is_banned) { res.status(403).json({ error: '账号已被封禁' }); return null; }
  return user;
}

// SSE 鉴权：优先 ticket（一次性、短时效），回退 query token（JWT，兼容旧客户端）。
function sseAuth(req, res, next) {
  const ticket = req.query.ticket;
  if (ticket) {
    const rec = tickets.get(String(ticket));
    tickets.delete(String(ticket)); // 单次使用：无论命中与否都销毁
    if (!rec || rec.exp < Date.now()) return res.status(401).json({ error: '连接凭证已过期，请重试' });
    const user = loadUsableUser(rec.uid, res);
    if (!user) return;
    req.user = user;
    return next();
  }
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  const user = loadUsableUser(payload.id, res);
  if (!user) return;
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
