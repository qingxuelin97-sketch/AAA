import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, isVip, notify } from '../wallet.js';
import { adminView, updatePlatform } from '../platform.js';

const router = Router();
const isGm = (uid) => !!db.prepare('SELECT is_gm FROM users WHERE id = ?').get(uid)?.is_gm;
function gm(req, res, next) {
  if (!isGm(req.user.id)) return res.status(403).json({ error: '需要 GM 权限' });
  next();
}
router.use(authRequired, gm);
const rnd = (n = 6) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

router.get('/check', (req, res) => res.json({ is_gm: true }));

// ---- platform AI config (language / voice / image) ----
router.get('/platform', (req, res) => res.json({ platform: adminView() }));
router.put('/platform', (req, res) => res.json({ ok: true, platform: updatePlatform(req.body || {}) }));

router.get('/stats', (req, res) => {
  const c = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  res.json({ stats: { users: c('users'), characters: c('characters'), scripts: c('scripts'), moments: c('moments'),
    banned: db.prepare('SELECT COUNT(*) n FROM users WHERE is_banned=1').get().n,
    reports: db.prepare("SELECT COUNT(*) n FROM reports WHERE status='open'").get().n } });
});

// ---- users ----
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (!q) rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all();
  else if (/^\d+$/.test(q)) rows = db.prepare('SELECT * FROM users WHERE id = ?').all(+q);
  else rows = db.prepare('SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 50').all(`%${q}%`, `%${q}%`);
  res.json({ users: rows.map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar,
    gold: u.gold, diamond: u.diamond, vip: isVip(u), is_gm: !!u.is_gm, is_banned: !!u.is_banned, ban_reason: u.ban_reason })) });
});
router.post('/users/:id/ban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(req.body?.reason || '', req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/unban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = ? WHERE id = ?').run('', req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/gm', (req, res) => {
  db.prepare('UPDATE users SET is_gm = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
router.post('/gift', (req, res) => {
  const { user_id, username, gold = 0, diamond = 0, vip_days = 0, memo } = req.body || {};
  const target = user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(user_id)
    : db.prepare('SELECT * FROM users WHERE username = ? OR display_name = ?').get(username, username);
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  if (gold || diamond) applyTx(target.id, { kind: 'reward', gold: +gold || 0, diamond: +diamond || 0, memo: memo || 'GM 赠送' });
  if (+vip_days > 0) {
    const base = isVip(target) ? new Date(target.vip_until).getTime() : Date.now();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + vip_days * 86400000).toISOString(), target.id);
  }
  notify(target.id, `管理员赠送了你 ${gold ? gold + ' 金币 ' : ''}${diamond ? diamond + ' 钻石 ' : ''}${+vip_days > 0 ? vip_days + ' 天 VIP' : ''}`.trim());
  res.json({ ok: true, user_id: target.id });
});

// ---- content moderation ----
router.get('/characters', (req, res) => {
  const q = String(req.query.q || '').trim(); const k = `%${q}%`;
  const rows = q ? db.prepare('SELECT c.*, u.display_name owner_name FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.name LIKE ? ORDER BY c.id DESC LIMIT 50').all(k)
    : db.prepare('SELECT c.*, u.display_name owner_name FROM characters c JOIN users u ON u.id=c.owner_id ORDER BY c.id DESC LIMIT 50').all();
  res.json({ characters: rows });
});
router.post('/characters/:id/feature', (req, res) => { db.prepare('UPDATE characters SET featured = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id); res.json({ ok: true }); });
router.delete('/characters/:id', (req, res) => { db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

router.get('/scripts', (req, res) => {
  const q = String(req.query.q || '').trim(); const k = `%${q}%`;
  const rows = q ? db.prepare('SELECT s.*, u.display_name author_name FROM scripts s JOIN users u ON u.id=s.author_id WHERE s.title LIKE ? ORDER BY s.id DESC LIMIT 50').all(k)
    : db.prepare('SELECT s.*, u.display_name author_name FROM scripts s JOIN users u ON u.id=s.author_id ORDER BY s.id DESC LIMIT 50').all();
  res.json({ scripts: rows });
});
router.post('/scripts/:id/feature', (req, res) => { db.prepare('UPDATE scripts SET featured = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id); res.json({ ok: true }); });
router.delete('/scripts/:id', (req, res) => { db.prepare('DELETE FROM scripts WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

router.delete('/moments/:id', (req, res) => { db.prepare('DELETE FROM moments WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
router.delete('/comments/:id', (req, res) => { db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
router.delete('/reviews/:id', (req, res) => { db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---- codes (invite / gift) ----
router.get('/codes', (req, res) => {
  res.json({ codes: db.prepare('SELECT * FROM invite_keys ORDER BY rowid DESC LIMIT 50').all() });
});
router.post('/codes', (req, res) => {
  const { gold = 0, diamond = 0, vip_days = 0, max_uses = 1, note = '', prefix = '' } = req.body || {};
  const code = (prefix ? String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' : '') + rnd(6);
  db.prepare('INSERT INTO invite_keys (code, max_uses, used, grant_gold, grant_diamond, grant_vip_days, note) VALUES (?,?,0,?,?,?,?)')
    .run(code, Math.max(1, +max_uses || 1), +gold || 0, +diamond || 0, +vip_days || 0, note || '');
  res.json({ code: db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code) });
});
router.delete('/codes/:code', (req, res) => { db.prepare('DELETE FROM invite_keys WHERE code = ?').run(req.params.code); res.json({ ok: true }); });

// ---- reports ----
router.get('/reports', (req, res) => {
  const rows = db.prepare(`SELECT r.*, u.display_name reporter_name FROM reports r LEFT JOIN users u ON u.id=r.reporter_id ORDER BY r.status='open' DESC, r.id DESC LIMIT 80`).all();
  res.json({ reports: rows });
});
router.post('/reports/:id/resolve', (req, res) => { db.prepare("UPDATE reports SET status='resolved' WHERE id = ?").run(req.params.id); res.json({ ok: true }); });

export default router;
