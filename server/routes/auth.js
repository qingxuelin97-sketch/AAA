import { Router } from'express';
import rateLimit from 'express-rate-limit';
import bcrypt from'bcryptjs';
import db from'../db.js';
import { sign, authRequired, bumpTokenVersion } from'../auth.js';
import { publicUser, applyTx, notify } from'../wallet.js';

const router = Router();

// 登录/注册：每 15 分钟最多 10 次/IP，防撞库与批量注册。
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: '尝试过于频繁，请稍后再试' } });

// 用户名：2-20 位，字母数字下划线或中文；密码：至少 6 位。
const NAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bcrypt \u6210\u672c\u56e0\u5b50\uff1a12\uff08\u6bd4 10 \u63d0\u9ad8 4 \u500d\u79bb\u7ebf\u7206\u7834\u6210\u672c\uff0c\u767b\u5f55/\u6ce8\u518c\u9891\u7387\u4e0b\u7684
// \u5355\u6b21\u54c8\u5e0c\u8017\u65f6\u4ecd\u5728\u767e\u6beb\u79d2\u7ea7\uff0c\u53ef\u63a5\u53d7\uff09\u3002\u5df2\u6709\u8d26\u53f7\u7684\u65e7 10 \u8f6e\u54c8\u5e0c\u7ee7\u7eed\u53ef\u9a8c\u8bc1\u3002
const BCRYPT_ROUNDS = 12;
// \u8d26\u53f7\u4e0d\u5b58\u5728\u65f6\u7528\u4e8e\u65f6\u5e8f\u5bf9\u9f50\u7684\u771f\u5b9e\u54c8\u5e0c\uff08\u542f\u52a8\u65f6\u751f\u6210\u4e00\u6b21\uff09\u3002\u4e4b\u524d\u7528\u7578\u5f62\u4e32
// '$2a$10$xxx\u2026' \u515c\u5e95\uff0cbcryptjs \u5bf9\u65e0\u6548\u76d0\u4f1a\u63d0\u524d\u8fd4\u56de\uff0c\u65f6\u5e8f\u4e0a\u4ecd\u53ef\u679a\u4e3e\u7528\u6237\u540d\u3002
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-' + Math.random(), BCRYPT_ROUNDS);

// 密码强度：至少 8 位，且包含至少两类字符（字母/数字/符号）
function validPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 72) return false;
  let kinds = 0;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/\d/.test(pw)) kinds++;
  if (/[^a-zA-Z0-9]/.test(pw)) kinds++;
  return kinds >= 2;
}

// Registration requires a valid invite key.
router.post('/register', authLimiter, async (req, res) => {
  const { username, password, email, display_name, invite } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:'用户名和密码必填' });
  if (!invite) return res.status(400).json({ error:'请输入邀请密钥' });
  if (!NAME_RE.test(String(username))) return res.status(400).json({ error:'用户名需 2-20 位，仅限字母、数字、下划线或中文' });
  if (!validPassword(password)) return res.status(400).json({ error:'密码至少 8 位，且需包含字母、数字、符号中的至少两类' });
  if (email && !EMAIL_RE.test(String(email))) return res.status(400).json({ error:'邮箱格式不正确' });

  // 先查用户名再扣邀请码：否则「用户名已被注册」的失败请求也会白白烧掉一次邀请额度。
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error:'该用户名已被注册' });

  // 用条件 UPDATE 原子扣减邀请码用量，杜绝并发超额注册。
  const code = String(invite).trim();
  const key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code);
  if (!key) return res.status(400).json({ error:'邀请密钥无效' });
  const used = db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ? AND used < max_uses').run(code);
  if (used.changes === 0) return res.status(400).json({ error:'该邀请密钥已被使用完' });

  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  let info;
  try {
    info = db.prepare('INSERT INTO users (username, email, password_hash, display_name, gold) VALUES (?, ?, ?, ?, ?)')
      .run(username, email ||'', hash, (display_name || username).slice(0, 30), 300);
  } catch (e) {
    // 并发撞名等插入失败：退还刚扣掉的邀请额度，再报错。
    db.prepare('UPDATE invite_keys SET used = used - 1 WHERE code = ? AND used > 0').run(code);
    if (/UNIQUE/i.test(e.message || '')) return res.status(409).json({ error:'该用户名已被注册' });
    throw e;
  }
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);

  // grant invite bonuses
  if (key.grant_gold || key.grant_diamond) {
    applyTx(id, { kind:'invite', gold: key.grant_gold, diamond: key.grant_diamond, memo:`邀请密钥 ${key.code} 奖励` });
  }
  if (key.grant_vip_days) {
    const until = new Date(Date.now() + key.grant_vip_days * 86400000).toISOString();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(until, id);
  }
  notify(id,'欢迎来到幻域！已为你发放新手金币，快去发现广场逛逛吧','/');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  // 账号存在且被锁定：直接拒绝。不存在账号无锁定状态，仍走下方 dummy 比较以保护时序。
  if (row && row.locked_until && row.locked_until > Date.now()) {
    const mins = Math.ceil((row.locked_until - Date.now()) / 60000);
    return res.status(429).json({ error: `账号已被锁定，请 ${mins} 分钟后再试` });
  }
  // 即使账号不存在也执行一次比较，避免通过响应时序枚举用户名。
  const ok = await bcrypt.compare(String(password || ''), row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) {
    // 密码错误：累加失败次数，达到 5 次锁定 15 分钟。
    if (row) {
      const fl = (row.failed_logins || 0) + 1;
      const lock = fl >= 5 ? Date.now() + 15 * 60_000 : 0;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fl, lock, row.id);
      return res.status(401).json({ error: lock ? '密码错误次数过多，账号已锁定 15 分钟' : '用户名或密码错误' });
    }
    return res.status(401).json({ error:'用户名或密码错误' });
  }
  if (row.is_banned) return res.status(403).json({ error: '账号已被封禁' + (row.ban_reason ? '：' + row.ban_reason : '') });
  // 登录成功：清零失败计数与锁定状态。
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(row.id);
  res.json({ token: sign(row), user: publicUser(row) });
});

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

router.put('/me', authRequired, (req, res) => {
  const { display_name, bio, avatar, banner, email } = req.body || {};
  if (email && !EMAIL_RE.test(String(email))) return res.status(400).json({ error:'邮箱格式不正确' });
  db.prepare(`UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio),
    avatar = COALESCE(?, avatar), banner = COALESCE(?, banner), email = COALESCE(?, email) WHERE id = ?`)
    .run(display_name ? String(display_name).slice(0, 30) : null, bio ? String(bio).slice(0, 500) : null,
      avatar ? String(avatar).slice(0, 500) : null, banner ? String(banner).slice(0, 500) : null,
      email ?? null, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.put('/password', authRequired, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!await bcrypt.compare(String(old_password || ''), row.password_hash)) return res.status(400).json({ error:'原密码错误' });
  if (!validPassword(new_password)) return res.status(400).json({ error:'新密码至少 8 位，且需包含字母、数字、符号中的至少两类' });
  const hash = await bcrypt.hash(String(new_password), BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  bumpTokenVersion(req.user.id); // 改密后使所有旧 token 失效
  // 给当前会话签发新版本 token，改密者本人无需重新登录（其他设备照常踢下线）。
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: sign(fresh) });
});

export default router;
