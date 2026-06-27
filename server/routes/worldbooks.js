import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';

const router = Router();

const str = (v, max) => v == null ? '' : String(v).slice(0, max);

// tier 不再作单选档位（简单/标准/专家能力可在同一本世界书共存）。
// 此处保留 TIERS 仅用于公开广场的展示分类（按世界书实际启用的能力派生），不再用于字段开关。
const TIERS = ['normal', 'advanced', 'expert'];
// 软上限：仅作防恶意超大请求的安全阀。
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
    image_urls, image_keys, image_position, front_slot, probability, min_turns, exclude_keys,
    max_turns, cooldown, required_keys, sticky, depth, variable_write, branch, vectorize, tone, folder
    FROM worldbook_entries WHERE worldbook_id = ? ORDER BY priority DESC, position, id`).all(wbId);
}

// 列表卡片：附条目数与已启用的能力徽章（图片注入 / 自构前端 / 提示词叠加 / 递归），
// 能力按字段是否有数据派生，不再依赖 tier 单选。
function withCount(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const counts = db.prepare('SELECT worldbook_id, COUNT(*) n FROM worldbook_entries WHERE worldbook_id IN (' + ids.map(() => '?').join(',') + ') GROUP BY worldbook_id').all(...ids);
  const countMap = new Map(counts.map(c => [c.worldbook_id, c.n]));
  // 任意条目配置了 image_urls+image_keys 即视为启用图片注入
  const imgRows = db.prepare(`SELECT DISTINCT worldbook_id FROM worldbook_entries
    WHERE worldbook_id IN (${ids.map(() => '?').join(',')}) AND image_urls != '' AND image_keys != ''`).all(...ids);
  const imgSet = new Set(imgRows.map(r => r.worldbook_id));
  // 专家能力派生：变量写入 / 分支 / 语义检索
  const varRows = db.prepare(`SELECT DISTINCT worldbook_id FROM worldbook_entries
    WHERE worldbook_id IN (${ids.map(() => '?').join(',')}) AND variable_write != ''`).all(...ids);
  const varSet = new Set(varRows.map(r => r.worldbook_id));
  const branchRows = db.prepare(`SELECT DISTINCT worldbook_id FROM worldbook_entries
    WHERE worldbook_id IN (${ids.map(() => '?').join(',')}) AND branch != ''`).all(...ids);
  const branchSet = new Set(branchRows.map(r => r.worldbook_id));
  const vectorRows = db.prepare(`SELECT DISTINCT worldbook_id FROM worldbook_entries
    WHERE worldbook_id IN (${ids.map(() => '?').join(',')}) AND vectorize = 1`).all(...ids);
  const vectorSet = new Set(vectorRows.map(r => r.worldbook_id));
  return rows.map(r => ({
    ...r,
    entry_count: countMap.get(r.id) || 0,
    cap_image: imgSet.has(r.id) || false,
    cap_front: !!(r.front_schema && r.front_schema.trim()),
    cap_overlay: !!(r.prompt_overlay && r.prompt_overlay.trim()),
    cap_recursion: !!r.recursion,
    cap_variable: varSet.has(r.id) || !!(r.variable_schema && r.variable_schema.trim()),
    cap_branch: branchSet.has(r.id) || false,
    cap_vector: vectorSet.has(r.id) || false
  }));
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

// 触发预览：给定一段「最近对话文本」，返回会被命中的条目（含触发原因、排除关键词、图片注入、高级/专家配置回显）。
// 注意：probability / min_turns / recursion / cooldown / sticky 涉及运行时上下文，预览不强制模拟，仅回显配置供创作者参考。
router.post('/:id/test-trigger', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || (!w.is_public && w.owner_id !== req.user.id)) return res.status(403).json({ error: '无权访问' });
  // 支持多段文本批量测试：body.texts 为字符串数组，回退到 body.text 单段
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.map(t => str(t, 4000)).filter(Boolean) : null;
  const singleText = str(req.body?.text, 4000) || '';
  const samples = texts && texts.length ? texts : (singleText ? [singleText] : ['']);
  const entries = loadEntries(w.id).filter(e => e.enabled !== false && e.enabled !== 0);
  // 互斥分组冲突告警：同组内多条命中视为冲突
  const groupHits = new Map();
  const runOne = (text) => entries.map(e => {
    const mode = e.mode || 'keyword';
    const keysRaw = (e.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    let triggered;
    if (mode === 'always' || keysRaw.length === 0) triggered = true;
    else if (mode === 'regex') triggered = keysRaw.some(k => { try { return new RegExp(k, e.case_sensitive ? '' : 'i').test(text); } catch { return false; } });
    else triggered = keysRaw.some(k => { const hay = e.case_sensitive ? text : text.toLowerCase(); return hay.includes(e.case_sensitive ? k : k.toLowerCase()); });
    // required_keys：AND 逻辑，全部命中才触发
    const reqRaw = (e.required_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (triggered && reqRaw.length) triggered = reqRaw.every(k => { const hay = e.case_sensitive ? text : text.toLowerCase(); return hay.includes(e.case_sensitive ? k : k.toLowerCase()); });
    // 排除关键词命中则不触发（黑名单优先）
    const exRaw = (e.exclude_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (triggered && exRaw.length) triggered = !exRaw.some(k => text.toLowerCase().includes(k.toLowerCase()));
    // 图片触发关键词独立判定（命中后展示创建者预注入的图片）
    let imgTriggered = false;
    const urls = e.image_urls ? e.image_urls.split(',').map(u => u.trim()).filter(Boolean) : [];
    if (urls.length && e.image_keys) {
      const ik = e.image_keys.split(',').map(k => k.trim()).filter(Boolean);
      imgTriggered = ik.length === 0 || ik.some(k => text.toLowerCase().includes(k.toLowerCase()));
    }
    if (triggered && e.group_name) {
      if (!groupHits.has(e.group_name)) groupHits.set(e.group_name, []);
      groupHits.get(e.group_name).push(e.id);
    }
    return { id: e.id, keys: e.keys, content: e.content.slice(0, 200), mode, priority: e.priority,
      inject_pos: e.inject_pos, group_name: e.group_name, front_slot: e.front_slot,
      probability: e.probability ?? 100, min_turns: e.min_turns ?? 0, exclude_keys: e.exclude_keys || '',
      max_turns: e.max_turns ?? 0, cooldown: e.cooldown ?? 0, required_keys: e.required_keys || '',
      sticky: e.sticky ?? 0, depth: e.depth ?? 0, tone: e.tone || '',
      variable_write: e.variable_write || '', branch: e.branch || '', vectorize: !!e.vectorize,
      triggered, imgTriggered, image_urls: urls, image_position: e.image_position };
  }).filter(r => r.triggered || r.imgTriggered);
  const results = samples.map((text, i) => ({ text: text.slice(0, 80) + (text.length > 80 ? '…' : ''), hits: runOne(text) }));
  // 互斥组冲突告警
  const conflicts = [...groupHits.entries()].filter(([, arr]) => arr.length > 1).map(([g, arr]) => ({ group: g, entries: arr }));
  // Token 消耗估算：4 字符 ≈ 1 token（仅世界书命中条目内容）
  const estChars = results.reduce((s, r) => s + r.hits.reduce((s2, h) => s2 + (h.content?.length || 0), 0), 0);
  res.json({ results, scan_depth: w.scan_depth, token_budget: w.token_budget, recursion: !!w.recursion,
    max_active: w.max_active ?? 6, system_pos: w.system_pos || 'after', recursion_depth: w.recursion_depth ?? 2,
    variable_schema: w.variable_schema || '',
    est_tokens: Math.ceil(estChars / 4), conflicts, total: entries.length });
});

// 创建
router.post('/', authRequired, contentLimiter, (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== 'string' || b.name.length > 60) return res.status(400).json({ error: '世界书名称必填（60字内）' });
  const entries = (Array.isArray(b.entries) ? b.entries.filter(e => e && typeof e === 'object') : []).slice(0, SAFE_ENTRY_LIMIT);
  const info = db.prepare(`INSERT INTO worldbooks (owner_id, name, description, tags, tier, is_public, front_schema, prompt_overlay,
    scan_depth, token_budget, recursion, max_active, variable_schema, system_pos, recursion_depth)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, str(b.name, 60), str(b.description, 500), str(b.tags, 200), 'expert', b.is_public ? 1 : 0,
      sanitizeSchema(b.front_schema), str(b.prompt_overlay, 2000),
      Math.max(1, Math.min(50, parseInt(b.scan_depth) || 4)), Math.max(0, Math.min(8000, parseInt(b.token_budget) || 0)), b.recursion ? 1 : 0,
      Math.max(1, Math.min(50, parseInt(b.max_active) || 6)), str(b.variable_schema, 4000),
      ['before', 'after', 'front'].includes(b.system_pos) ? b.system_pos : 'after',
      Math.max(1, Math.min(10, parseInt(b.recursion_depth) || 2)));
  saveEntries(info.lastInsertRowid, entries);
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ worldbook: { ...w, entries: loadEntries(w.id) } });
});

// 更新（含条目，整体替换）
router.put('/:id', authRequired, (req, res) => {
  const w = db.prepare('SELECT * FROM worldbooks WHERE id = ?').get(req.params.id);
  if (!w || w.owner_id !== req.user.id) return res.status(403).json({ error: '无权编辑' });
  const b = req.body || {};
  db.prepare(`UPDATE worldbooks SET name=?, description=?, tags=?, is_public=?, front_schema=?, prompt_overlay=?,
    scan_depth=?, token_budget=?, recursion=?, max_active=?, variable_schema=?, system_pos=?, recursion_depth=? WHERE id=?`)
    .run(str(b.name ?? w.name, 60), str(b.description ?? w.description, 500), str(b.tags ?? w.tags, 200),
      (b.is_public ? 1 : 0), sanitizeSchema(b.front_schema ?? w.front_schema), str(b.prompt_overlay ?? w.prompt_overlay, 2000),
      Math.max(1, Math.min(50, parseInt(b.scan_depth ?? w.scan_depth) || 4)), Math.max(0, Math.min(8000, parseInt(b.token_budget ?? w.token_budget) || 0)),
      (b.recursion ?? w.recursion) ? 1 : 0,
      Math.max(1, Math.min(50, parseInt(b.max_active ?? w.max_active) || 6)), str(b.variable_schema ?? w.variable_schema, 4000),
      ['before', 'after', 'front'].includes(b.system_pos ?? w.system_pos) ? (b.system_pos ?? w.system_pos) : 'after',
      Math.max(1, Math.min(10, parseInt(b.recursion_depth ?? w.recursion_depth) || 2)), w.id);
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

// 全字段保存：所有字段始终入库（不再按 tier 剥离），运行时按「字段是否有数据」决定特性是否启用。
function saveEntries(wbId, entries) {
  db.prepare('DELETE FROM worldbook_entries WHERE worldbook_id = ?').run(wbId);
  if (!Array.isArray(entries)) return;
  const stmt = db.prepare(`INSERT INTO worldbook_entries
    (worldbook_id, keys, content, enabled, position, mode, inject_pos, priority, case_sensitive, group_name, comment,
     image_urls, image_keys, image_position, front_slot, probability, min_turns, exclude_keys,
     max_turns, cooldown, required_keys, sticky, depth, variable_write, branch, vectorize, tone, folder)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  entries.forEach((e, i) => {
    if (!e || (!e.content && !e.keys)) return;
    const mode = e.mode === 'regex' ? 'regex' : e.mode === 'always' ? 'always' : 'keyword';
    const injectPos = e.inject_pos === 'before' ? 'before' : 'after';
    const pri = Math.max(0, Math.min(100, parseInt(e.priority) || 50));
    const prob = Math.max(0, Math.min(100, parseInt(e.probability) ?? 100));
    const minTurns = Math.max(0, Math.min(999, parseInt(e.min_turns) || 0));
    const maxTurns = Math.max(0, Math.min(999, parseInt(e.max_turns) || 0));
    const cooldown = Math.max(0, Math.min(999, parseInt(e.cooldown) || 0));
    const stickyN = Math.max(0, Math.min(99, parseInt(e.sticky) || 0));
    const depthN = Math.max(0, Math.min(50, parseInt(e.depth) || 0));
    stmt.run(
      wbId, str(e.keys, 500), str(e.content, 4000), e.enabled === false ? 0 : 1, i,
      mode, injectPos, pri,
      e.case_sensitive ? 1 : 0, str(e.group_name, 60), str(e.comment, 500),
      str(e.image_urls, 2000), str(e.image_keys, 300),
      ['inline', 'before', 'after', 'side'].includes(e.image_position) ? e.image_position : 'inline',
      str(e.front_slot, 32),
      prob, minTurns, str(e.exclude_keys, 300),
      maxTurns, cooldown, str(e.required_keys, 500), stickyN, depthN,
      str(e.variable_write, 1000), str(e.branch, 4000), e.vectorize ? 1 : 0, str(e.tone, 100), str(e.folder, 60)
    );
  });
}

export default router;
