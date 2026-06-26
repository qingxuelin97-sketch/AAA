import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';

const router = Router();

const str = (v, max) => v == null ? '' : String(v).slice(0, max);

function loadEntries(wbId) {
  return db.prepare('SELECT id, keys, content, enabled, position, mode, inject_pos, priority, case_sensitive, group_name, comment FROM worldbook_entries WHERE worldbook_id = ? ORDER BY priority DESC, position, id').all(wbId);
}

// 列表卡片：附条目数，供广场/我的列表展示
function withCount(rows) {
  if (!rows.length) return rows;
  const counts = db.prepare('SELECT worldbook_id, COUNT(*) n FROM worldbook_entries WHERE worldbook_id IN (' + rows.map(() => '?').join(',') + ') GROUP BY worldbook_id').all(...rows.map(r => r.id));
  const map = new Map(counts.map(c => [c.worldbook_id, c.n]));
  return rows.map(r => ({ ...r, entry_count: map.get(r.id) || 0 }));
}

// 我的世界书
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM worldbooks WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ worldbooks: withCount(rows) });
});

// 公开世界书广场
router.get('/public', authOptional, (req, res) => {
  const { q } = req.query;
  let sql = `SELECT w.*, u.display_name AS owner_name FROM worldbooks w
    JOIN users u ON u.id = w.owner_id WHERE w.is_public = 1`;
  const args = [];
  if (q) { sql += ' AND (w.name LIKE ? OR w.tags LIKE ? OR w.description LIKE ?)'; const k = `%${q}%`; args.push(k, k, k); }
  sql += ' ORDER BY w.uses DESC, w.id DESC LIMIT 80';
  const rows = db.prepare(sql).all(...args);
  if (req.user) {
    const mine = new Set(db.prepare('SELECT id FROM worldbooks WHERE owner_id = ?').all(req.user.id).map(r => r.id));
    rows.forEach(r => (r.owned = mine.has(r.id)));
  }
  res.json({ worldbooks: withCount(rows) });
});

// 详情（含条目）
router.get('/:id', authOptional, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '世界书不存在' });
  if (!w.is_public && (!req.user || req.user.id !== w.owner_id)) return res.status(403).json({ error: '无权访问' });
  const owner = db.prepare('SELECT id, display_name, avatar, verified FROM users WHERE id = ?').get(w.owner_id);
  const worldbook = { ...w, entries: loadEntries(w.id), owner_name: owner?.display_name, owner_avatar: owner?.avatar, owner_verified: !!owner?.verified };
  res.json({ worldbook });
});

// 创建
router.post('/', authRequired, contentLimiter, (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== 'string' || b.name.length > 60) return res.status(400).json({ error: '世界书名称必填（60字内）' });
  const entries = Array.isArray(b.entries) ? b.entries.filter(e => e && typeof e === 'object').slice(0, 200) : [];
  const info = db.prepare('INSERT INTO worldbooks (owner_id, name, description, tags, is_public) VALUES (?,?,?,?,?)')
    .run(req.user.id, str(b.name, 60), str(b.description, 500), str(b.tags, 200), b.is_public ? 1 : 0);
  saveEntries(info.lastInsertRowid, entries);
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ worldbook: { ...w, entries: loadEntries(w.id) } });
});

// 更新（含条目，整体替换）
router.put('/:id', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || w.owner_id !== req.user.id) return res.status(403).json({ error: '无权编辑' });
  const b = req.body || {};
  db.prepare('UPDATE worldbooks SET name=?, description=?, tags=?, is_public=? WHERE id=?')
    .run(str(b.name ?? w.name, 60), str(b.description ?? w.description, 500), str(b.tags ?? w.tags, 200), (b.is_public ? 1 : 0), w.id);
  if (Array.isArray(b.entries)) saveEntries(w.id, b.entries.filter(e => e && typeof e === 'object').slice(0, 200));
  const updated = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(w.id);
  res.json({ worldbook: { ...updated, entries: loadEntries(w.id) } });
});

router.delete('/:id', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || w.owner_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM worldbooks WHERE id = ?').run(w.id);
  res.json({ ok: true });
});

// 关联世界书到角色（角色 owner 才能操作）
router.post('/:id/attach/:characterId', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '世界书不存在' });
  if (!w.is_public && w.owner_id !== req.user.id) return res.status(403).json({ error: '无权使用该世界书' });
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.characterId);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权操作该角色' });
  db.prepare('INSERT OR IGNORE INTO character_worldbooks (character_id, worldbook_id) VALUES (?,?)').run(c.id, w.id);
  db.prepare('UPDATE worldbooks SET uses = uses + 1 WHERE id = ?').run(w.id);
  res.json({ ok: true });
});

router.delete('/:id/attach/:characterId', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.characterId);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权操作该角色' });
  db.prepare('DELETE FROM character_worldbooks WHERE character_id = ? AND worldbook_id = ?').run(c.id, req.params.id);
  db.prepare('UPDATE worldbooks SET uses = MAX(0, uses - 1) WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 把角色内嵌世界书另存为独立世界书
router.post('/from-character/:characterId', authRequired, contentLimiter, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.characterId);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权操作该角色' });
  const entries = db.prepare('SELECT keys, content, enabled, position FROM world_entries WHERE character_id = ?').all(c.id);
  const b = req.body || {};
  const info = db.prepare('INSERT INTO worldbooks (owner_id, name, description, tags, is_public) VALUES (?,?,?,?,?)')
    .run(req.user.id, str(b.name || (c.name + ' 的世界书'), 60), str(b.description, 500), str(b.tags, 200), 0);
  saveEntries(info.lastInsertRowid, entries);
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ worldbook: { ...w, entries: loadEntries(w.id) } });
});

function saveEntries(wbId, entries) {
  db.prepare('DELETE FROM worldbook_entries WHERE worldbook_id = ?').run(wbId);
  if (!Array.isArray(entries)) return;
  const stmt = db.prepare(`INSERT INTO worldbook_entries
    (worldbook_id, keys, content, enabled, position, mode, inject_pos, priority, case_sensitive, group_name, comment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  entries.forEach((e, i) => {
    if (!e || (!e.content && !e.keys)) return;
    const mode = e.mode === 'regex' ? 'regex' : e.mode === 'always' ? 'always' : 'keyword';
    const injectPos = e.inject_pos === 'before' ? 'before' : 'after';
    const pri = Math.max(0, Math.min(100, parseInt(e.priority) || 50));
    stmt.run(
      wbId, str(e.keys, 500), str(e.content, 4000), e.enabled === false ? 0 : 1, i,
      mode, injectPos, pri, e.case_sensitive ? 1 : 0, str(e.group_name, 60), str(e.comment, 500)
    );
  });
}

export default router;
