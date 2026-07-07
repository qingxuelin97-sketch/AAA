import { Router } from'express';
import rateLimit from 'express-rate-limit';
import bcrypt from'bcryptjs';
import db from'../db.js';
import { sign, authRequired, bumpTokenVersion } from'../auth.js';
import { publicUser, applyTx, notify } from'../wallet.js';
import { sendVerifyCode, getMail } from'../mail.js';
import { isWhitelisted, normalizeEmail, whitelistEnabled } from'../whitelist.js';
import { log } from '../logger.js';

const router = Router();

// 登录/注册：每 15 分钟最多 10 次/IP，防撞库与批量注册。
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: '尝试过于频繁，请稍后再试' } });

// 发送验证码：每 10 分钟最多 5 次/IP + 每邮箱 3 次，防短信邮件轰炸。
// 测试环境可通过 MAIL_CODE_IP_LIMIT 放宽 IP 限制（默认 5）。
const codeLimiter = rateLimit({ windowMs: 10 * 60_000, max: Number(process.env.MAIL_CODE_IP_LIMIT) || 5, standardHeaders: true, legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' } });

// 用户名：2-20 位，字母数字下划线或中文；密码：至少 6 位。
const NAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 生成 6 位数字验证码。
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 发送注册验证码：先校验白名单（不在白名单的邮箱不发信），再下发。
router.post('/send-code', codeLimiter, async (req, res) => {
  const { email } = req.body || {};
  const e = normalizeEmail(email);
  if (!e || !EMAIL_RE.test(e)) return res.status(400).json({ error: '邮箱格式不正确' });

  // 白名单政策：白名单内有任意条目时，仅白名单邮箱可收到验证码。
  if (whitelistEnabled() && !isWhitelisted(e)) {
    return res.status(403).json({ error: '该邮箱不在注册白名单内，无法注册本平台' });
  }
  // 该邮箱是否已注册
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(e)) {
    return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
  }
  // 邮箱级频率：10 分钟内最多 3 次（防轰炸）。codeLimiter 已限 IP。
  const since = Date.now() - 10 * 60_000;
  const recent = db.prepare("SELECT COUNT(*) n FROM email_codes WHERE email = ? AND created_at >= datetime(?, 'unixepoch')").get(e, since / 1000).n;
  if (recent >= 3) return res.status(429).json({ error: '该邮箱请求验证码过于频繁，请 10 分钟后再试' });

  const ttlMin = getMail().code_ttl_min || 10;
  const code = genCode();
  db.prepare('INSERT INTO email_codes (email, code, expires_at) VALUES (?, ?, ?)')
    .run(e, code, Date.now() + ttlMin * 60_000);

  const r = await sendVerifyCode(e, code);
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true, ttl_min: ttlMin });
});

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

// 注册：邮箱验证码 + 白名单政策。不在白名单的邮箱无法注册。
// invite（邀请密钥）保留为可选：若填写则照旧核销并发放邀请奖励。
router.post('/register', authLimiter, async (req, res) => {
  const { username, password, email, display_name, code, invite } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:'用户名和密码必填' });
  if (!NAME_RE.test(String(username))) return res.status(400).json({ error:'用户名需 2-20 位，仅限字母、数字、下划线或中文' });
  if (!validPassword(password)) return res.status(400).json({ error:'密码至少 8 位，且需包含字母、数字、符号中的至少两类' });
  const e = normalizeEmail(email);
  if (!e) return res.status(400).json({ error:'请填写邮箱' });
  if (!EMAIL_RE.test(e)) return res.status(400).json({ error:'邮箱格式不正确' });
  if (!code) return res.status(400).json({ error:'请输入邮箱验证码' });

  // 白名单政策：白名单非空时，仅白名单邮箱可注册。
  if (whitelistEnabled() && !isWhitelisted(e)) {
    return res.status(403).json({ error:'该邮箱不在注册白名单内，无法注册本平台' });
  }
  // 邮箱是否已被注册
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(e)) {
    return res.status(409).json({ error:'该邮箱已注册，请直接登录' });
  }

  // 先查用户名，避免无效请求浪费验证码尝试次数。
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error:'该用户名已被注册' });

  // 校验验证码：取该邮箱最新一条未消费且未过期的记录，比对并防爆破（最多 5 次尝试）。
  const row = db.prepare('SELECT * FROM email_codes WHERE email = ? AND consumed = 0 ORDER BY id DESC LIMIT 1').get(e);
  if (!row) return res.status(400).json({ error:'请先获取验证码' });
  if (row.attempts >= 5) return res.status(429).json({ error:'验证码错误次数过多，请重新获取' });
  if (Date.now() > row.expires_at) return res.status(400).json({ error:'验证码已过期，请重新获取' });
  if (String(row.code) !== String(code).trim()) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return res.status(400).json({ error:'验证码不正确' });
  }
  // 标记已消费（原子更新，防并发重放）
  const consumed = db.prepare('UPDATE email_codes SET consumed = 1 WHERE id = ? AND consumed = 0').run(row.id);
  if (consumed.changes === 0) return res.status(400).json({ error:'验证码已被使用，请重新获取' });

  // 邀请密钥可选：若填写则核销并发放奖励。
  let key = null;
  if (invite) {
    const code2 = String(invite).trim();
    key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code2);
    if (!key) return res.status(400).json({ error:'邀请密钥无效' });
    const used = db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ? AND used < max_uses').run(code2);
    if (used.changes === 0) return res.status(400).json({ error:'该邀请密钥已被使用完' });
  }

  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  let info;
  try {
    info = db.prepare('INSERT INTO users (username, email, password_hash, display_name, gold) VALUES (?, ?, ?, ?, ?)')
      .run(username, e, hash, (display_name || username).slice(0, 30), 300);
  } catch (err) {
    // 并发撞名等插入失败：退还刚扣掉的邀请额度，再报错。
    if (key) db.prepare('UPDATE invite_keys SET used = used - 1 WHERE code = ? AND used > 0').run(key.code);
    if (/UNIQUE/i.test(err.message || '')) return res.status(409).json({ error:'该用户名已被注册' });
    throw err;
  }
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);

  // grant invite bonuses
  if (key && (key.grant_gold || key.grant_diamond)) {
    applyTx(id, { kind:'invite', gold: key.grant_gold, diamond: key.grant_diamond, memo:`邀请密钥 ${key.code} 奖励` });
  }
  if (key && key.grant_vip_days) {
    const until = new Date(Date.now() + key.grant_vip_days * 86400000).toISOString();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(until, id);
  }
  notify(id,'欢迎来到幻域！已为你发放新手金币，快去发现广场逛逛吧','/');

  log({ level: 'info', source: 'server', category: 'auth', event: 'register',
    message: `新用户注册 ${username} (${e})`, user_id: id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: '/auth/register', method: 'POST', status: 200, request_id: req.requestId || '',
    extra: { username, email: e, invited: !!key } });

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
      log({ level: 'warn', source: 'server', category: 'auth', event: 'login_failed',
        message: `登录失败 ${username} (${lock ? '已锁定' : '第' + fl + '次'})`, user_id: row.id, ip: req.ip, ua: req.header('user-agent') || '',
        endpoint: '/auth/login', method: 'POST', status: 401, request_id: req.requestId || '',
        extra: { failed_attempts: fl, locked: !!lock } });
      return res.status(401).json({ error: lock ? '密码错误次数过多，账号已锁定 15 分钟' : '用户名或密码错误' });
    }
    log({ level: 'warn', source: 'server', category: 'auth', event: 'login_failed',
      message: `登录失败（账号不存在）${username}`, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: '/auth/login', method: 'POST', status: 401, request_id: req.requestId || '',
      extra: { username } });
    return res.status(401).json({ error:'用户名或密码错误' });
  }
  if (row.is_banned) {
    log({ level: 'warn', source: 'server', category: 'auth', event: 'login_banned',
      message: `封禁用户尝试登录 ${username}`, user_id: row.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: '/auth/login', method: 'POST', status: 403, request_id: req.requestId || '' });
    return res.status(403).json({ error: '账号已被封禁' + (row.ban_reason ? '：' + row.ban_reason : '') });
  }
  // 登录成功：清零失败计数与锁定状态。
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(row.id);
  log({ level: 'info', source: 'server', category: 'auth', event: 'login',
    message: `用户登录 ${username}`, user_id: row.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: '/auth/login', method: 'POST', status: 200, request_id: req.requestId || '' });
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
  log({ level: 'warn', source: 'server', category: 'auth', event: 'password_change',
    message: `用户修改密码`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: '/auth/password', method: 'PUT', status: 200, request_id: req.requestId || '' });
  // 给当前会话签发新版本 token，改密者本人无需重新登录（其他设备照常踢下线）。
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: sign(fresh) });
});

export default router;
