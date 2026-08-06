import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { push } from '../realtime.js';
import { str, clampInt } from '../validate.js';

const router = Router();

const memberOf = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, uid);

router.get('/', authRequired, (req, res) => {
  const groups = db.prepare(`SELECT g.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
    EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) AS joined
    FROM groups g JOIN users u ON u.id = g.owner_id
    WHERE g.is_public = 1 OR g.owner_id = ? ORDER BY g.created_at DESC`).all(req.user.id, req.user.id);
  res.json({ groups });
});

router.post('/', authRequired, (req, res) => {
  const { name, description, avatar, is_public } = req.body || {};
  // 防呆：此前只判 truthy —— name: [] 能过这一关，然后作为非原始值喂给
  // better-sqlite3 抛 TypeError → 500。这里要求真字符串并限长。
  if (typeof name !== 'string' || !name.trim() || name.length > 60) {
    return res.status(400).json({ error: '群名称必填（60字内）' });
  }
  // 建群 + 建 owner 成员一并原子提交，杜绝崩溃留下「无主群」。
  const gid = db.transaction(() => {
    const info = db.prepare('INSERT INTO groups (name, owner_id, avatar, description, is_public) VALUES (?,?,?,?,?)')
      .run(name.trim(), req.user.id, str(avatar, 500) || null, str(description, 500), is_public === false ? 0 : 1);
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)').run(info.lastInsertRowid, req.user.id, 'owner');
    return info.lastInsertRowid;
  }).immediate();
  res.json({ group: db.prepare('SELECT * FROM groups WHERE id = ?').get(gid) });
});

router.post('/:id/join', authRequired, (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!g.is_public && g.owner_id !== req.user.id && !memberOf(g.id, req.user.id)) {
    return res.status(403).json({ error: '私有群仅限受邀成员加入' });
  }
  if (!memberOf(g.id, req.user.id))
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)').run(g.id, req.user.id);
  res.json({ ok: true });
});

router.post('/:id/leave', authRequired, (req, res) => {
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND role != "owner"').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/:id', authRequired, (req, res) => {
  const g = db.prepare(`SELECT g.*, u.display_name AS owner_name FROM groups g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`).get(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  // 私有群仅 owner 与成员可见，防 IDOR 读取他人私有群详情。
  if (!g.is_public && g.owner_id !== req.user.id && !memberOf(g.id, req.user.id)) return res.status(403).json({ error: '无权访问该群' });
  const members = db.prepare(`SELECT gm.role, u.id, u.display_name, u.avatar FROM group_members gm
    JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`).all(g.id);
  const messages = db.prepare(`SELECT m.*, u.display_name, u.avatar FROM group_messages m
    JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 80`).all(g.id).reverse();
  res.json({ group: g, members, messages, joined: memberOf(g.id, req.user.id) });
});

router.post('/:id/messages', authRequired, (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  // 仅成员可发言，不再自动加成员，防任意用户对他人群发消息。
  if (!memberOf(g.id, req.user.id) && g.owner_id !== req.user.id) return res.status(403).json({ error: '请先加入该群' });
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  const info = db.prepare('INSERT INTO group_messages (group_id, user_id, content) VALUES (?,?,?)').run(g.id, req.user.id, String(content).slice(0, 2000));
  const msg = db.prepare(`SELECT m.*, u.display_name, u.avatar FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`).get(info.lastInsertRowid);
  // SSE 秒推给其他在线成员 —— 群消息此前只靠 4s 轮询，收方延迟 0~4s；
  // 轮询保留为 SSE 断连时的兜底（前端已放宽间隔）。发送者本人拿响应即得。
  const memberIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(g.id).map(r => r.user_id);
  for (const uid of new Set([...memberIds, g.owner_id])) {
    if (uid !== req.user.id) push(uid, 'group_msg', { group_id: g.id, message: msg });
  }
  res.json({ message: msg });
});

// Polling endpoint for new messages — 仅成员可拉取，防 IDOR 读取他人群消息。
router.get('/:id/messages', authRequired, (req, res) => {
  const g = db.prepare('SELECT owner_id, is_public FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (g.owner_id !== req.user.id && !memberOf(req.params.id, req.user.id) && !g.is_public) return res.status(403).json({ error: '无权访问该群' });
  // 防呆：此前无 LIMIT —— after=0 会把整个群的历史一次性拉走。客户端轮询
  // 按「收到的最后一条 id」推进 after（GroupRoom.jsx），被截断的页会在下一次
  // 轮询自动补齐，因此加上限不影响功能。
  const after = clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInt(req.query.limit, 1, 200, 100);
  const rows = db.prepare(`SELECT m.*, u.display_name, u.avatar FROM group_messages m
    JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`).all(req.params.id, after, limit);
  res.json({ messages: rows });
});

export default router;
