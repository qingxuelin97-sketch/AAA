import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { notify } from '../wallet.js';
import { creatorTier } from '../creator.js';
import { areFriends, friendIds, isOnline, dmAllowed, friendState, dmThread, pairKey } from '../relations.js';
import { push } from '../realtime.js';

const router = Router();
const U = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

router.get('/', authRequired, (req, res) => {
  const me = req.user.id;
  const rows = friendIds(me).map(id => {
    const u = U(id); if (!u) return null;
    const msgs = dmThread(me, id); const last = msgs[msgs.length - 1];
    const unread = msgs.filter(d => d.from_id === id && !d.read).length;
    return { id: u.id, display_name: u.display_name, avatar: u.avatar, online: isOnline(u), creator_tier: creatorTier(u.id), is_councilor: !!u.is_councilor, verified: !!u.verified,
      last_message: last ? { text: last.text.slice(0, 44), at: last.created_at, mine: last.from_id === me } : null, unread };
  }).filter(Boolean).sort((a, b) => (b.unread - a.unread) || (b.online - a.online) || ((b.last_message?.at || '').localeCompare(a.last_message?.at || '')));
  res.json({ friends: rows, count: rows.length });
});

router.get('/requests', authRequired, (req, res) => {
  const me = req.user.id;
  const incoming = db.prepare("SELECT * FROM friend_requests WHERE to_id=? AND status='pending' ORDER BY id DESC").all(me)
    .map(r => { const u = U(r.from_id); return u && { req_id: r.id, id: u.id, display_name: u.display_name, avatar: u.avatar, creator_tier: creatorTier(u.id), bio: u.bio || '', at: r.created_at }; }).filter(Boolean);
  const outgoing = db.prepare("SELECT * FROM friend_requests WHERE from_id=? AND status='pending' ORDER BY id DESC").all(me)
    .map(r => { const u = U(r.to_id); return u && { req_id: r.id, id: u.id, display_name: u.display_name, avatar: u.avatar }; }).filter(Boolean);
  res.json({ incoming, outgoing });
});

router.get('/state/:id', authRequired, (req, res) => {
  const tid = +req.params.id; const t = U(tid);
  res.json({ state: friendState(req.user.id, tid), can_dm: t ? dmAllowed(req.user, t) : false, online: isOnline(t) });
});

router.post('/request/:id', authRequired, (req, res) => {
  const me = req.user; const tid = +req.params.id;
  if (tid === me.id) return res.status(400).json({ error: '不能添加自己为好友' });
  const target = U(tid); if (!target) return res.status(404).json({ error: '用户不存在' });
  if (areFriends(me.id, tid)) return res.status(400).json({ error: '你们已经是好友了' });
  const incoming = db.prepare("SELECT * FROM friend_requests WHERE from_id=? AND to_id=? AND status='pending'").get(tid, me.id);
  if (incoming) {
    db.prepare("UPDATE friend_requests SET status='accepted' WHERE id=?").run(incoming.id);
    const [a, b] = pairKey(me.id, tid); db.prepare('INSERT INTO friendships (a_id, b_id) VALUES (?,?)').run(a, b);
    notify(tid, `${me.display_name} 接受了你的好友申请 🎉`, '/friends');
    push(tid, 'friend', { kind: 'accepted', by: { id: me.id, display_name: me.display_name, avatar: me.avatar } });
    return res.json({ state: 'friends' });
  }
  if (db.prepare("SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=? AND status='pending'").get(me.id, tid)) return res.status(400).json({ error: '已发送过好友申请，等待对方通过' });
  db.prepare("INSERT INTO friend_requests (from_id, to_id, status) VALUES (?,?,'pending')").run(me.id, tid);
  notify(tid, `${me.display_name} 申请加你为好友`, '/friends');
  push(tid, 'friend', { kind: 'request', by: { id: me.id, display_name: me.display_name, avatar: me.avatar, creator_tier: creatorTier(me.id) } });
  res.json({ state: 'pending_out' });
});

router.post('/requests/:id/:action', authRequired, (req, res) => {
  const me = req.user; const r = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!r || r.to_id !== me.id) return res.status(404).json({ error: '申请不存在' });
  if (r.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  if (req.params.action === 'accept') {
    db.prepare("UPDATE friend_requests SET status='accepted' WHERE id=?").run(r.id);
    if (!areFriends(me.id, r.from_id)) { const [a, b] = pairKey(me.id, r.from_id); db.prepare('INSERT INTO friendships (a_id, b_id) VALUES (?,?)').run(a, b); }
    notify(r.from_id, `${me.display_name} 通过了你的好友申请，开始聊天吧～`, '/friends');
    push(r.from_id, 'friend', { kind: 'accepted', by: { id: me.id, display_name: me.display_name, avatar: me.avatar } });
    return res.json({ ok: true, state: 'friends' });
  }
  db.prepare("UPDATE friend_requests SET status='rejected' WHERE id=?").run(r.id);
  res.json({ ok: true, state: 'none' });
});

router.delete('/:id', authRequired, (req, res) => {
  const me = req.user.id; const tid = +req.params.id; const [a, b] = pairKey(me, tid);
  db.prepare('DELETE FROM friendships WHERE a_id=? AND b_id=?').run(a, b);
  db.prepare('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').run(me, tid, tid, me);
  res.json({ ok: true });
});

export default router;
