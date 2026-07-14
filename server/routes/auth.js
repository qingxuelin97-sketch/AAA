import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { sign, authRequired, bumpTokenVersion, SECRET } from '../auth.js';
import { publicUser, applyTx, notify } from '../wallet.js';
import { sendVerifyCode, getMail } from '../mail.js';
import { isWhitelisted, normalizeEmail, canonicalEmail, whitelistEnabled } from '../whitelist.js';
import { registrationRequestHash, verifyPlayIntegrityToken, playIntegrityAvailability } from '../integrity.js';
import { log } from '../logger.js';

const router = Router();
// 开放策略：登录/注册不再对用户做尝试频率限制（移除 authLimiter），
// 不再因 IP/设备限定注册次数，也不再对非管理员账号做失败锁定——
// 普通用户登录访问一律放行，不再跳出「尝试过于频繁」类提示。
// 邮箱验证码请求仍保留 codeLimiter（仅用于防邮件发送接口被刷），但其配额
// 同样宽松：仅作邮件成本兜底，不阻断正常注册流程。
const codeLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: Number(process.env.MAIL_CODE_IP_LIMIT) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

const NAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync(`timing-equalizer-${crypto.randomUUID()}`, BCRYPT_ROUNDS);

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });
const openRegistrationForTests = () => process.env.NODE_ENV !== 'production' && process.env.REGISTRATION_MODE === 'open';
const generateCode = () => String(crypto.randomInt(100000, 1_000_000));

function validPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return false;
  let kinds = 0;
  if (/[a-z]/.test(password)) kinds++;
  if (/[A-Z]/.test(password)) kinds++;
  if (/\d/.test(password)) kinds++;
  if (/[^a-zA-Z0-9]/.test(password)) kinds++;
  return kinds >= 2;
}

function usableInvite(value) {
  const code = String(value || '').trim();
  if (!code) return null;
  return db.prepare('SELECT * FROM invite_keys WHERE code = ? AND used < max_uses').get(code) || null;
}

function emailCodeDigest(email, purpose, userId, code) {
  return `h1:${crypto.createHmac('sha256', SECRET)
    .update(`${purpose}\0${userId || 0}\0${email}\0${String(code).trim()}`)
    .digest('hex')}`;
}

function codeMatches(row, submitted) {
  const stored = String(row.code || '');
  const candidate = stored.startsWith('h1:')
    ? emailCodeDigest(row.email, row.purpose || 'register', row.user_id || 0, submitted)
    : String(submitted || '').trim(); // one-time compatibility for pre-migration codes
  const a = Buffer.from(stored);
  const b = Buffer.from(candidate);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function latestEmailCode(email, purpose, userId = null) {
  if (userId == null) {
    return db.prepare(`SELECT * FROM email_codes
      WHERE email = ? AND purpose = ? AND user_id IS NULL AND consumed = 0 ORDER BY id DESC LIMIT 1`)
      .get(email, purpose);
  }
  return db.prepare(`SELECT * FROM email_codes
    WHERE email = ? AND purpose = ? AND user_id = ? AND consumed = 0 ORDER BY id DESC LIMIT 1`)
    .get(email, purpose, userId);
}

function validateEmailCode(email, code, purpose, userId = null) {
  const row = latestEmailCode(email, purpose, userId);
  if (!row) throw httpError(400, '请先获取验证码');
  if (row.attempts >= 5) throw httpError(429, '验证码错误次数过多，请重新获取');
  if (Date.now() > row.expires_at) throw httpError(400, '验证码已过期，请重新获取');
  if (!codeMatches(row, code)) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ? AND consumed = 0').run(row.id);
    throw httpError(400, '验证码不正确');
  }
  return row;
}

function issueIntegrityTicket(email, username) {
  return jwt.sign({ kind: 'registration_integrity', email, username }, SECRET, { expiresIn: '15m', algorithm: 'HS256' });
}

function readIntegrityTicket(ticket, email, username) {
  if (!ticket) return null;
  try {
    const value = jwt.verify(String(ticket), SECRET, { algorithms: ['HS256'] });
    return value.kind === 'registration_integrity' && value.email === email && value.username === username ? value : null;
  } catch { return null; }
}

function registrationGate({ email, username, invite, integrityTicket }) {
  const key = usableInvite(invite);
  if (invite && !key) throw httpError(400, '邀请密钥无效或已用完');
  if (openRegistrationForTests()) return { trust: 'test-open', key };
  if (isWhitelisted(email)) return { trust: 'whitelist', key };
  if (key) return { trust: 'invite', key };
  if (readIntegrityTicket(integrityTicket, email, username)) return { trust: 'play-integrity', key: null };
  throw httpError(403, '注册仅对受邀、白名单或通过 Google Play 完整性校验的用户开放');
}

async function storeAndSendCode({ email, purpose, userId = null }) {
  const since = Date.now() - 10 * 60_000;
  const recent = db.prepare(`SELECT COUNT(*) AS n FROM email_codes
    WHERE email = ? AND purpose = ? AND created_at >= datetime(?, 'unixepoch')`).get(email, purpose, since / 1000).n;
  if (recent >= 3) throw httpError(429, '该邮箱请求验证码过于频繁，请 10 分钟后再试');
  const code = generateCode();
  const ttlMin = Math.min(30, Math.max(3, Number(getMail().code_ttl_min) || 10));
  db.prepare('UPDATE email_codes SET consumed = 1 WHERE email = ? AND purpose = ? AND consumed = 0').run(email, purpose);
  const info = db.prepare(`INSERT INTO email_codes (email,code,expires_at,purpose,user_id)
    VALUES (?,?,?,?,?)`).run(email, emailCodeDigest(email, purpose, userId, code), Date.now() + ttlMin * 60_000, purpose, userId);
  const sent = await sendVerifyCode(email, code);
  if (!sent.ok) {
    db.prepare('DELETE FROM email_codes WHERE id = ?').run(info.lastInsertRowid);
    throw httpError(502, sent.error);
  }
  return { ttlMin, code };
}

router.get('/registration-policy', (_req, res) => {
  res.json({
    mode: openRegistrationForTests() ? 'open' : 'restricted',
    methods: { whitelist: true, invite: true, play_integrity: playIntegrityAvailability().configured },
  });
});

router.post('/send-code', codeLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const username = String(req.body?.username || '').trim();
    const invite = String(req.body?.invite || '').trim();
    if (!email || !EMAIL_RE.test(email)) throw httpError(400, '邮箱格式不正确');
    if (db.prepare("SELECT id FROM users WHERE email = ? OR (email_canon = ? AND email_canon != '')").get(email, canonicalEmail(email))) {
      throw httpError(409, '该邮箱（或其别名形式）已注册，请直接登录');
    }

    let integrityTicket = null;
    const key = usableInvite(invite);
    if (invite && !key) throw httpError(400, '邀请密钥无效或已用完');
    const permitted = openRegistrationForTests() || isWhitelisted(email) || !!key;
    if (!permitted) {
      if (!req.body?.integrity_token || !NAME_RE.test(username)) {
        throw httpError(403, '请提供有效邀请密钥，或使用经 Google Play 校验的正式 App 注册');
      }
      const expectedHash = registrationRequestHash({ email, username });
      await verifyPlayIntegrityToken(req.body.integrity_token, expectedHash);
      integrityTicket = issueIntegrityTicket(email, username);
    }

    const { ttlMin, code } = await storeAndSendCode({ email, purpose: 'register' });
    const out = { ok: true, ttl_min: ttlMin, integrity_ticket: integrityTicket };
    if (process.env.NODE_ENV === 'test' && process.env.TEST_EXPOSE_EMAIL_CODES === '1') out.test_code = code;
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/register', async (req, res, next) => {
  try {
    const { password, display_name, code, invite, integrity_ticket } = req.body || {};
    const username = String(req.body?.username || '').trim();
    const email = normalizeEmail(req.body?.email);
    if (!NAME_RE.test(username)) throw httpError(400, '用户名需 2-20 位，仅限字母、数字、下划线或中文');
    if (!validPassword(password)) throw httpError(400, '密码需为 8-72 位，并包含字母、数字、符号中的至少两类');
    if (!email || !EMAIL_RE.test(email)) throw httpError(400, '邮箱格式不正确');
    if (!code) throw httpError(400, '请输入邮箱验证码');
    const emailCanon = canonicalEmail(email);
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw httpError(409, '该用户名已被注册');
    if (db.prepare("SELECT id FROM users WHERE email = ? OR (email_canon = ? AND email_canon != '')").get(email, emailCanon)) {
      throw httpError(409, '该邮箱（或其别名形式）已注册，请直接登录');
    }

    const gate = registrationGate({ email, username, invite, integrityTicket: integrity_ticket });
    const codeRow = validateEmailCode(email, code, 'register');
    // 开放策略：不再按 IP/设备限定注册次数——普通用户不论网络与设备均可注册。
    const ip = req.ip || '';
    const deviceId = req.deviceId || '';

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    let userId;
    db.transaction(() => {
      const consumed = db.prepare('UPDATE email_codes SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at >= ?').run(codeRow.id, Date.now());
      if (consumed.changes !== 1) throw httpError(409, '验证码已被使用，请重新获取');
      if (gate.key) {
        const used = db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ? AND used < max_uses').run(gate.key.code);
        if (used.changes !== 1) throw httpError(409, '邀请密钥已被使用完');
      }
      const info = db.prepare(`INSERT INTO users
        (username,email,email_canon,reg_ip,reg_device,reg_trust,integrity_checked_at,password_hash,display_name,gold)
        VALUES (?,?,?,?,?,?,?,?,?,300)`)
        .run(username, email, emailCanon, ip, deviceId || null, gate.trust,
          gate.trust === 'play-integrity' ? Date.now() : null,
          passwordHash, String(display_name || username).slice(0, 30));
      userId = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
      if (gate.key) {
        db.prepare('INSERT INTO code_redemptions (code,user_id) VALUES (?,?)').run(gate.key.code, userId);
        if (gate.key.grant_gold || gate.key.grant_diamond) {
          applyTx(userId, { kind: 'invite', gold: gate.key.grant_gold, diamond: gate.key.grant_diamond, memo: `邀请密钥 ${gate.key.code} 奖励` });
        }
        if (gate.key.grant_vip_days) {
          db.prepare('UPDATE users SET vip_until = ? WHERE id = ?')
            .run(new Date(Date.now() + gate.key.grant_vip_days * 86400000).toISOString(), userId);
        }
      }
    }).immediate();

    notify(userId, '欢迎来到幻域！已为你发放新手金币。', '/');
    log({
      level: 'info', source: 'server', category: 'auth', event: 'register',
      message: `新用户注册 ${username}`, user_id: userId, ip, ua: req.header('user-agent') || '',
      endpoint: '/auth/register', method: 'POST', status: 200, request_id: req.requestId || '',
      extra: { username, trust: gate.trust, invited: !!gate.key },
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    if (/UNIQUE constraint failed: users\.username/i.test(err.message || '')) err = httpError(409, '该用户名已被注册');
    else if (/UNIQUE constraint failed: users\.(email|email_canon)/i.test(err.message || '')) err = httpError(409, '该邮箱（或其别名形式）已注册');
    next(err);
  }
});

router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // 开放策略：仅管理员（root）账号保留失败锁定，普通用户登录访问一律放行——
  // 不论调用频次、来源 IP 或设备，都不会再因「尝试过于频繁」被拦在登录入口。
  if (row?.is_gm && row?.locked_until > Date.now()) {
    const minutes = Math.ceil((row.locked_until - Date.now()) / 60000);
    return res.status(429).json({ error: `账号已被锁定，请 ${minutes} 分钟后再试` });
  }
  const ok = await bcrypt.compare(String(req.body?.password || ''), row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) {
    if (row?.is_gm) {
      const failures = (row.failed_logins || 0) + 1;
      const lockedUntil = failures >= 5 ? Date.now() + 15 * 60_000 : 0;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failures, lockedUntil, row.id);
    }
    log({ level: 'warn', source: 'server', category: 'auth', event: 'login_failed', message: `登录失败 ${username}`,
      user_id: row?.id || null, ip: req.ip, ua: req.header('user-agent') || '', endpoint: '/auth/login', method: 'POST', status: 401,
      request_id: req.requestId || '' });
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (row.is_banned) return res.status(403).json({ error: '账号已被封禁' + (row.ban_reason ? `：${row.ban_reason}` : '') });
  if (row.is_gm) db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(row.id);
  log({ level: 'info', source: 'server', category: 'auth', event: 'login', message: `用户登录 ${username}`,
    user_id: row.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: '/auth/login', method: 'POST', status: 200,
    request_id: req.requestId || '' });
  res.json({ token: sign(row), user: publicUser(row) });
});

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const out = { user: publicUser(row) };
  const ageSeconds = Math.floor(Date.now() / 1000) - (req.tokenIat || 0);
  if (req.tokenIat && ageSeconds > 7 * 86400) out.token = sign(row);
  res.json(out);
});

router.post('/email/send-code', authRequired, codeLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !EMAIL_RE.test(email)) throw httpError(400, '邮箱格式不正确');
    if (email === normalizeEmail(req.user.email)) throw httpError(400, '新邮箱与当前邮箱相同');
    if (whitelistEnabled() && !isWhitelisted(email)) throw httpError(403, '该邮箱不在允许使用的白名单内');
    const canon = canonicalEmail(email);
    if (db.prepare("SELECT id FROM users WHERE id <> ? AND (email = ? OR (email_canon = ? AND email_canon != ''))").get(req.user.id, email, canon)) {
      throw httpError(409, '该邮箱已被其他账号使用');
    }
    const { ttlMin, code } = await storeAndSendCode({ email, purpose: 'email_change', userId: req.user.id });
    const out = { ok: true, ttl_min: ttlMin };
    if (process.env.NODE_ENV === 'test' && process.env.TEST_EXPOSE_EMAIL_CODES === '1') out.test_code = code;
    res.json(out);
  } catch (err) { next(err); }
});

router.put('/me', authRequired, (req, res, next) => {
  try {
    const { display_name, bio, avatar, banner, email_code } = req.body || {};
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const requestedEmail = req.body?.email == null ? null : normalizeEmail(req.body.email);
    let email = null;
    let emailCanon = null;
    let codeRow = null;
    if (requestedEmail && requestedEmail !== normalizeEmail(current.email)) {
      if (!EMAIL_RE.test(requestedEmail)) throw httpError(400, '邮箱格式不正确');
      if (whitelistEnabled() && !isWhitelisted(requestedEmail)) throw httpError(403, '该邮箱不在允许使用的白名单内');
      email = requestedEmail;
      emailCanon = canonicalEmail(email);
      if (db.prepare("SELECT id FROM users WHERE id <> ? AND (email = ? OR (email_canon = ? AND email_canon != ''))").get(req.user.id, email, emailCanon)) {
        throw httpError(409, '该邮箱已被其他账号使用');
      }
      if (!email_code) throw httpError(400, '更换邮箱必须提供新邮箱验证码');
      codeRow = validateEmailCode(email, email_code, 'email_change', req.user.id);
    }

    const safeUrlField = (value) => {
      if (!value) return null;
      const raw = String(value).trim();
      if (/^data:image\//i.test(raw)) {
        if (raw.length > 500) throw httpError(400, '内联图片过大，请使用上传接口');
        return raw;
      }
      const short = raw.slice(0, 500);
      return /^(https?:\/\/|\/)/i.test(short) ? short : null;
    };
    const avatarValue = safeUrlField(avatar);
    const bannerValue = safeUrlField(banner);
    db.transaction(() => {
      if (codeRow) {
        const consumed = db.prepare('UPDATE email_codes SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at >= ?').run(codeRow.id, Date.now());
        if (consumed.changes !== 1) throw httpError(409, '验证码已被使用，请重新获取');
      }
      db.prepare(`UPDATE users SET display_name=COALESCE(?,display_name), bio=COALESCE(?,bio),
        avatar=COALESCE(?,avatar), banner=COALESCE(?,banner), email=COALESCE(?,email), email_canon=COALESCE(?,email_canon)
        WHERE id=?`).run(
        display_name ? String(display_name).slice(0, 30) : null,
        bio ? String(bio).slice(0, 500) : null,
        avatarValue, bannerValue, email, emailCanon, req.user.id,
      );
    }).immediate();
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  } catch (err) { next(err); }
});

router.put('/password', authRequired, async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!await bcrypt.compare(String(req.body?.old_password || ''), row.password_hash)) return res.status(400).json({ error: '原密码错误' });
  if (!validPassword(req.body?.new_password)) return res.status(400).json({ error: '新密码需为 8-72 位，并包含至少两类字符' });
  const hash = await bcrypt.hash(String(req.body.new_password), BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  bumpTokenVersion(req.user.id);
  log({ level: 'warn', source: 'server', category: 'auth', event: 'password_change', message: '用户修改密码',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: '/auth/password', method: 'PUT', status: 200,
    request_id: req.requestId || '' });
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: sign(fresh) });
});

export default router;
