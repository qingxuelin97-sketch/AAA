import { Router } from'express';
import bcrypt from'bcryptjs';
import db from'../db.js';
import { sign, authRequired } from'../auth.js';
import { publicUser, applyTx, notify } from'../wallet.js';

const router = Router();

// Registration requires a valid invite key.
router.post('/register', (req, res) => {
  const { username, password, email, display_name, invite } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:'用户名和密码必填' });
  if (!invite) return res.status(400).json({ error:'请输入邀请密钥' });
  if (String(username).length < 2) return res.status(400).json({ error:'用户名至少 2 个字符' });
  if (String(password).length < 4) return res.status(400).json({ error:'密码至少 4 位' });

  const key = db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(String(invite).trim());
  if (!key) return res.status(400).json({ error:'邀请密钥无效' });
  if (key.used >= key.max_uses) return res.status(400).json({ error:'该邀请密钥已被使用完' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error:'该用户名已被注册' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
    .run(username, email ||'', hash, display_name || username);
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
  db.prepare('UPDATE invite_keys SET used = used + 1 WHERE code = ?').run(key.code);

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

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !bcrypt.compareSync(password ||'', row.password_hash)) {
    return res.status(401).json({ error:'用户名或密码错误' });
  }
  if (row.is_banned) return res.status(403).json({ error: '账号已被封禁' + (row.ban_reason ? '：' + row.ban_reason : '') });
  res.json({ token: sign(row), user: publicUser(row) });
});

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

router.put('/me', authRequired, (req, res) => {
  const { display_name, bio, avatar, banner, email } = req.body || {};
  db.prepare(`UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio),
    avatar = COALESCE(?, avatar), banner = COALESCE(?, banner), email = COALESCE(?, email) WHERE id = ?`)
    .run(display_name ?? null, bio ?? null, avatar ?? null, banner ?? null, email ?? null, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.put('/password', authRequired, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(old_password ||'', row.password_hash)) return res.status(400).json({ error:'原密码错误' });
  if (String(new_password ||'').length < 4) return res.status(400).json({ error:'新密码至少 4 位' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

export default router;
