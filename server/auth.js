import jwt from 'jsonwebtoken';
import db from './db.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// JWT 密钥解析：优先环境变量 JWT_SECRET；未配置时自动生成强随机密钥并
// 持久化到 .jwt-secret 文件，重启后复用——既避免回落到公开硬编码密钥，
// 又保证未配置环境变量时开箱可用（不会 process.exit 导致服务起不来）。
// 生产环境强烈建议显式设置 JWT_SECRET 环境变量。
const SECRET_FILE = path.join(__dirname, '.jwt-secret');
export let SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (fs.existsSync(SECRET_FILE)) {
    SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  if (!SECRET || SECRET.length < 32) {
    SECRET = crypto.randomBytes(48).toString('base64url');
    try { fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); } catch { /* 只读 fs 时退回内存密钥 */ }
  }
  if (!process.env.JWT_SECRET) {
    console.warn('[auth] 未配置 JWT_SECRET 环境变量，已自动生成并持久化到 .jwt-secret。生产环境建议显式设置 JWT_SECRET 环境变量以便多实例一致。');
  }
}

// 为每个账号维护 token 版本号；改密/封禁时 +1，使旧 token 立即失效。
export function bumpTokenVersion(userId) {
  db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(userId);
}

export function sign(user) {
  const tv = user.token_version ?? 0;
  return jwt.sign({ id: user.id, username: user.username, tv }, SECRET, { expiresIn: '30d', algorithm: 'HS256' });
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id, username, email, display_name, avatar, bio, is_banned, ban_reason, token_version FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    if (user.is_banned) return res.status(403).json({ error: '账号已被封禁' + (user.ban_reason ? '：' + user.ban_reason : '') });
    // 校验 token 版本：改密后旧 token 失效
    if ((payload.tv ?? 0) !== (user.token_version ?? 0)) return res.status(401).json({ error: '登录态已失效，请重新登录' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// Soft auth: attaches req.user if a valid token is present, but never blocks.
export function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
      const user = db.prepare('SELECT id, username, display_name, avatar, is_banned, token_version FROM users WHERE id = ?').get(payload.id);
      // 即便软鉴权也校验封禁与 token 版本，避免被封号/改密用户继续以登录态浏览
      if (user && !user.is_banned && (payload.tv ?? 0) === (user.token_version ?? 0)) req.user = user;
    } catch { /* ignore */ }
  }
  next();
}
