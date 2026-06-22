import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { notify } from '../wallet.js';
import { creatorTier } from '../creator.js';
import { areFriends, isOnline, dmAllowed, dmThread } from '../relations.js';

const router = Router();
const U = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

router.get('/', authRequired, (req, res) => {
  const me = req.user.id;
  const partners = new Set();
  db.prepare('SELECT from_id, to_id FROM dm_messages WHERE from_id=? OR to_id=?').all(me, me)
    .forEach(d => partners.add(d.from_id === me ? d.to_id : d.from_id));
  const rows = [...partners].map(id => {
    const u = U(id); if (!u) return null;
    const msgs = dmThread(me, id); const last = msgs[msgs.length - 1];
    const unread = msgs.filter(d => d.from_id === id && !d.read).length;
    return { id: u.id, display_name: u.display_name, avatar: u.avatar, online: isOnline(u), friend: areFriends(me, id),
      last_message: last ? { text: last.text.slice(0, 50), at: last.created_at, mine: last.from_id === me } : null, unread };
  }).filter(Boolean).sort((a, b) => (b.last_message?.at || '').localeCompare(a.last_message?.at || ''));
  res.json({ threads: rows, unread_total: rows.reduce((s, r) => s + r.unread, 0) });
});

router.get('/:id', authRequired, (req, res) => {
  const me = req.user; const tid = +req.params.id; const target = U(tid);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE dm_messages SET read=1 WHERE to_id=? AND from_id=? AND read=0').run(me.id, tid);
  const msgs = dmThread(me.id, tid).map(d => ({ id: d.id, from_id: d.from_id, text: d.text, created_at: d.created_at, mine: d.from_id === me.id }));
  res.json({ messages: msgs, peer: { id: target.id, display_name: target.display_name, avatar: target.avatar, online: isOnline(target), creator_tier: creatorTier(target.id), is_councilor: !!target.is_councilor, verified: !!target.verified }, can_dm: dmAllowed(me, target), friend: areFriends(me.id, tid) });
});

router.post('/:id', authRequired, (req, res) => {
  const me = req.user; const tid = +req.params.id; const target = U(tid);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const text = String(req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: '消息不能为空' });
  if (!dmAllowed(me, target)) return res.status(403).json({ error: '对方的隐私设置不允许你私信，需先成为好友或关注' });
  const info = db.prepare('INSERT INTO dm_messages (from_id, to_id, text, read) VALUES (?,?,?,0)').run(me.id, tid, text.slice(0, 2000));
  notify(tid, `${me.display_name} 发来私信：${text.slice(0, 24)}`, '/friends');
  res.json({ message: { id: info.lastInsertRowid, from_id: me.id, text: text.slice(0, 2000), created_at: new Date().toISOString(), mine: true } });
});

export default router;
