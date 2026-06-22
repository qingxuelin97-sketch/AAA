import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, isVip, notify } from '../wallet.js';
import { adminView, updatePlatform } from '../platform.js';
import { creatorTier } from '../creator.js';
import { councilCfg, saveCouncil, councilSeats, councilSize, baseSeats, totalUsers, USERS_PER_SEAT, MIN_SEATS } from '../council.js';

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

// ---- broadcast ----
router.post('/broadcast', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '广播内容不能为空' });
  const link = String(req.body?.link || '').trim();
  const users = db.prepare('SELECT id FROM users WHERE is_banned = 0').all();
  users.forEach(u => notify(u.id, '📢 ' + text, link));
  res.json({ ok: true, count: users.length });
});

// ---- council / parliament administration ----
router.get('/councilors', (req, res) => {
  const rows = db.prepare('SELECT id, username, display_name, avatar, verified FROM users WHERE is_councilor = 1').all()
    .map(u => ({ ...u, verified: !!u.verified, creator_tier: creatorTier(u.id) }));
  res.json({ councilors: rows });
});
router.get('/council', (req, res) => {
  const c = councilCfg(); const seats = councilSeats(); const cur = councilSize();
  res.json({ council: { total_users: totalUsers(), per_seat: USERS_PER_SEAT, min_seats: MIN_SEATS, base_seats: baseSeats(),
    seats, seats_override: c.seats_override, councilors: cur, vacancies: Math.max(0, seats - cur), over: cur > seats,
    term: c.term || 1, term_started_at: c.term_started_at, locked: !!c.locked, locked_at: c.locked_at || null } });
});
router.put('/council', (req, res) => {
  const c = councilCfg(); const v = req.body?.seats_override;
  if (v === null || v === '' || v === undefined) c.seats_override = null;
  else { const n = parseInt(v, 10); if (isNaN(n) || n < 0) return res.status(400).json({ error: '席位数必须是非负整数' }); if (n > 9999) return res.status(400).json({ error: '席位数过大' }); c.seats_override = n; }
  saveCouncil(c);
  res.json({ ok: true, seats: councilSeats(), seats_override: c.seats_override });
});
router.post('/council/lock', (req, res) => {
  const c = councilCfg(); c.locked = !!req.body?.value; c.locked_at = c.locked ? new Date().toISOString() : null; saveCouncil(c);
  db.prepare('SELECT id FROM users WHERE is_councilor = 1').all().forEach(u => notify(u.id, c.locked ? '幻域议会已被管理层宣布无限期休会，暂停一切议事，静待复会通知。' : '幻域议会已恢复运作，现可正常提交提案与表决。', '/parliament'));
  res.json({ ok: true, locked: c.locked });
});
router.post('/council/reapportion', (req, res) => {
  const c = councilCfg(); c.seats_override = null; c.term = (c.term || 1) + 1; c.term_started_at = new Date().toISOString(); saveCouncil(c);
  db.prepare('SELECT id FROM users WHERE is_councilor = 1').all().forEach(u => notify(u.id, `幻域议会已完成第 ${c.term} 届换届，席位按注册规模重新核定为 ${councilSeats()} 席。`, '/parliament'));
  res.json({ ok: true, term: c.term, seats: councilSeats() });
});
router.post('/users/:id/councilor', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const val = req.body?.value ? 1 : 0;
  db.prepare('UPDATE users SET is_councilor = ? WHERE id = ?').run(val, u.id);
  notify(u.id, val ? '🏛 恭喜！你已被任命为幻域议会议员，可发起提案并参与表决。' : '你的议员身份已被免去。', '/parliament');
  res.json({ ok: true });
});

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
