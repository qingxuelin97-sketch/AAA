import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { attach } from '../realtime.js';
import { authRequired } from '../auth.js';

const router = Router();
const TICKET_TTL_MS = 45_000;
const MAX_TICKETS = 10_000;
const tickets = new Map();

function pruneTickets(now = Date.now()) {
  for (const [ticket, value] of tickets) {
    if (value.expiresAt <= now) tickets.delete(ticket);
  }
  // A hard cap prevents authenticated ticket spam from becoming an unbounded
  // in-memory store. Oldest entries are removed first (Map insertion order).
  while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value);
}

// EventSource cannot attach Authorization headers. Exchange the bearer token
// over a normal authenticated POST for a short-lived, single-use stream ticket
// so the long-lived JWT never appears in URLs, proxy logs, or browser history.
router.post('/ticket', authRequired, (req, res) => {
  pruneTickets();
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId: req.user.id,
    tokenVersion: req.user.token_version ?? 0,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ticket, expires_in_ms: TICKET_TTL_MS });
});

function sseTicketAuth(req, res, next) {
  const ticket = String(req.query.ticket || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return res.status(401).json({ error: '实时连接票据无效' });
  const value = tickets.get(ticket);
  tickets.delete(ticket); // consume on every attempt, including stale/banned users
  if (!value || value.expiresAt <= Date.now()) return res.status(401).json({ error: '实时连接票据已过期' });
  const user = db.prepare('SELECT id, username, display_name, is_banned, token_version FROM users WHERE id = ?').get(value.userId);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  if (user.is_banned) return res.status(403).json({ error: '账号已被封禁' });
  if ((user.token_version ?? 0) !== value.tokenVersion) return res.status(401).json({ error: '登录态已失效' });
  req.user = user;
  next();
}

// Persistent SSE stream: authenticated by a single-use ticket above.
router.get('/stream', sseTicketAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try { db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(Date.now(), req.user.id); } catch { /* */ }
  res.write(`event: ready\ndata: ${JSON.stringify({ uid: req.user.id, at: Date.now(), feats: ['group_msg', 'theater_msg'] })}\n\n`);

  const detach = attach(req.user.id, res);
  req.on('close', detach);
});

export default router;
