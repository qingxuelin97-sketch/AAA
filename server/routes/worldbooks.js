import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';

const router = Router();

const str = (v, max) => v == null ? '' : String(v).slice(0, max);

// tier 是世界书自身的「设置级别」（normal/advanced/expert），仅决定启用哪些特性面板，
// 不对创作者上锁、不设配额、不限制升档/降档。所有字段始终可写，由前端按 tier 控制可见性。
const TIERS = ['normal', 'advanced', 'expert'];
// 软上限：仅作防恶意超大请求的安全阀，不按 tier 区分。
const SAFE_ENTRY_LIMIT = 500;

// 安全白名单：避免恶意脚本注入到 front_schema 中。
const sanitizeSchema = (raw) => {
  if (!raw) return '';
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return ''; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const layout = ['single', 'split', 'cinematic', 'journal'].includes(obj.layout) ? obj.layout : 'single';
  const accent = typeof obj.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(obj.accent) ? obj.accent : '';
  const slots = Array.isArray(obj.slots) ? obj.slots.filter(s => s && typeof s === 'object').slice(0, 12).map(s => ({
    id: str(s.id, 32), type: ['image', 'image-carousel', 'text-bar', 'banner'].includes(s.type) ? s.type : 'image',
    bind: str(s.bind, 32), src: str(s.src, 500)
  })).filter(s => s.id) : [];
  return JSON.stringify({ layout, accent, slots });
};

function loadEntries(wbId) {
  return db.prepare(`SELECT id, keys, content, enabled, position, mode, inject_pos, priority, case_sensitive, group_name, comment,
    image_urls, image_keys, image_position, front_slot FROM worldbook_entries WHERE worldbook_id = ? ORDER BY priority DESC, position, id`).all(wbId);
}

// 列表卡片：附条目数与 tier，供广场/我的列表展示。
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
  const { q, tier } = req.query;
  let sql = `SELECT w.*, u.display_name AS owner_name FROM worldbooks w
    JOIN users u ON u.id = w.owner_id WHERE w.is_public = 1`;
  const args = [];
  if (tier && TIERS.includes(tier)) { sql += ' AND w.tier = ?'; args.push(tier); }
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

// 触发预览：给定一段「最近对话文本」，返回会被命中的条目（含触发原因、图片提示词），
// 让专家档创作者在编辑器里实时预览世界书在对话中如何被激活。
router.post('/:id/test-trigger', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || (!w.is_public && w.owner_id !== req.user.id)) return res.status(403).json({ error: '无权访问' });
  const text = str(req.body?.text, 4000) || '';
  const entries = loadEntries(w.id).filter(e => e.enabled !== false && e.enabled !== 0);
  const isExpert = w.tier === 'expert';
  const results = entries.map(e => {
    const mode = e.mode || 'keyword';
    const keysRaw = (e.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    let triggered;
    if (mode === 'always' || keysRaw.length === 0) triggered = true;
    else if (mode === 'regex') triggered = keysRaw.some(k => { try { return new RegExp(k, e.case_sensitive ? '' : 'i').test(text); } catch { return false; } });
    else triggered = keysRaw.some(k => { const hay = e.case_sensitive ? text : text.toLowerCase(); return hay.includes(e.case_sensitive ? k : k.toLowerCase()); });
    // 专家档：图片触发关键词独立判定（命中后展示创建者预注入的图片，非即时生成）
    let imgTriggered = false;
    const urls = isExpert && e.image_urls ? e.image_urls.split(',').map(u => u.trim()).filter(Boolean) : [];
    if (isExpert && urls.length && e.image_keys) {
      const ik = e.image_keys.split(',').map(k => k.trim()).filter(Boolean);
      imgTriggered = ik.length === 0 || ik.some(k => text.toLowerCase().includes(k.toLowerCase()));
    }
    return { id: e.id, keys: e.keys, content: e.content.slice(0, 200), mode, priority: e.priority,
      inject_pos: e.inject_pos, group_name: e.group_name, front_slot: e.front_slot,
      triggered, imgTriggered, image_urls: isExpert ? urls : [], image_position: e.image_position };
  }).filter(r => r.triggered || r.imgTriggered);
  res.json({ results, tier: w.tier, total: entries.length });
});

// 创建
router.post('/', authRequired, contentLimiter, (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== 'string' || b.name.length > 60) return res.status(400).json({ error: '世界书名称必填（60字内）' });
  const tier = TIERS.includes(b.tier) ? b.tier : 'normal';
  const entries = (Array.isArray(b.entries) ? b.entries.filter(e => e && typeof e === 'object') : []).slice(0, SAFE_ENTRY_LIMIT);
  const info = db.prepare('INSERT INTO worldbooks (owner_id, name, description, tags, tier, is_public, front_schema, prompt_overlay) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.user.id, str(b.name, 60), str(b.description, 500), str(b.tags, 200), tier, b.is_public ? 1 : 0,
      sanitizeSchema(b.front_schema), str(b.prompt_overlay, 2000));
  saveEntries(info.lastInsertRowid, entries);
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ worldbook: { ...w, entries: loadEntries(w.id) } });
});

// 更新（含条目，整体替换）
router.put('/:id', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || w.owner_id !== req.user.id) return res.status(403).json({ error: '无权编辑' });
  const b = req.body || {};
  // tier 自由切换（无升降档限制）；front_schema / prompt_overlay 始终保存，由 tier 决定运行时是否启用。
  const tier = TIERS.includes(b.tier) ? b.tier : (w.tier || 'normal');
  db.prepare('UPDATE worldbooks SET name=?, description=?, tags=?, tier=?, is_public=?, front_schema=?, prompt_overlay=? WHERE id=?')
    .run(str(b.name ?? w.name, 60), str(b.description ?? w.description, 500), str(b.tags ?? w.tags, 200),
      tier, (b.is_public ? 1 : 0), sanitizeSchema(b.front_schema ?? w.front_schema), str(b.prompt_overlay ?? w.prompt_overlay, 2000), w.id);
  if (Array.isArray(b.entries)) saveEntries(w.id, b.entries.filter(e => e && typeof e === 'object').slice(0, SAFE_ENTRY_LIMIT));
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
  const info = db.prepare('INSERT INTO worldbooks (owner_id, name, description, tags, tier, is_public) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, str(b.name || (c.name + ' 的世界书'), 60), str(b.description, 500), str(b.tags, 200), 'normal', 0);
  saveEntries(info.lastInsertRowid, entries);
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ worldbook: { ...w, entries: loadEntries(w.id) } });
});

// 全字段保存：tier 不再决定字段是否入库（不剥离），仅运行时控制特性启用与否。
function saveEntries(wbId, entries) {
  db.prepare('DELETE FROM worldbook_entries WHERE worldbook_id = ?').run(wbId);
  if (!Array.isArray(entries)) return;
  const stmt = db.prepare(`INSERT INTO worldbook_entries
    (worldbook_id, keys, content, enabled, position, mode, inject_pos, priority, case_sensitive, group_name, comment,
     image_urls, image_keys, image_position, front_slot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  entries.forEach((e, i) => {
    if (!e || (!e.content && !e.keys)) return;
    const mode = e.mode === 'regex' ? 'regex' : e.mode === 'always' ? 'always' : 'keyword';
    const injectPos = e.inject_pos === 'before' ? 'before' : 'after';
    const pri = Math.max(0, Math.min(100, parseInt(e.priority) || 50));
    stmt.run(
      wbId, str(e.keys, 500), str(e.content, 4000), e.enabled === false ? 0 : 1, i,
      mode, injectPos, pri,
      e.case_sensitive ? 1 : 0, str(e.group_name, 60), str(e.comment, 500),
      str(e.image_urls, 2000), str(e.image_keys, 300),
      ['inline', 'before', 'after', 'side'].includes(e.image_position) ? e.image_position : 'inline',
      str(e.front_slot, 32)
    );
  });
}

export default router;
