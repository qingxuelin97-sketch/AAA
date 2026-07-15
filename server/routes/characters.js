import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { bumpDaily } from '../daily.js';
import { creatorTier } from '../creator.js';
import { contentLimiter } from '../limiters.js';
import { broadcast } from '../realtime.js';
import { log } from '../logger.js';
import { str } from '../validate.js';

const router = Router();

function loadWorld(characterId) {
  return db.prepare('SELECT * FROM world_entries WHERE character_id = ? ORDER BY position, id').all(characterId);
}

// Voice speed is a 0.5–2.0 multiplier; default 1 (normal). Guards bad input.
const clampSpeed = (v) => { const n = Number(v); return n >= 0.5 && n <= 2 ? Math.round(n * 100) / 100 : 1; };
// Voice pitch is a 0.5–1.5 multiplier; default 1 (natural).
const clampPitch = (v) => { const n = Number(v); return n >= 0.5 && n <= 1.5 ? Math.round(n * 100) / 100 : 1; };

// 独立世界书可在角色创建时一并挂载。只接受正整数、去重且限制数量，
// 后续仍需由路由校验「本人拥有或公开」的使用权限。
const linkedWorldbookIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 20);

function ownerView(c) {
  if (!c) return c;
  c.world = loadWorld(c.id);
  // 附加角色关联的独立世界书（供前端展示/管理）
  c.linked_worldbooks = db.prepare(`SELECT w.id, w.name, w.is_public, w.owner_id,
    (SELECT COUNT(*) FROM worldbook_entries WHERE worldbook_id = w.id) AS entry_count
    FROM character_worldbooks cw JOIN worldbooks w ON w.id = cw.worldbook_id
    WHERE cw.character_id = ? ORDER BY w.id`).all(c.id);
  return c;
}

// 角色卡「秒级广播」用的精简预览：只携带前端弹提示/插到列表头部所需的最小字段，
// 避免把 persona/intro 等大字段全量广播给所有在线用户。
function cardPreview(c, ownerName, ownerAvatar, ownerTier) {
  if (!c) return null;
  return {
    id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline || '',
    category: c.category || '', tags: c.tags || '', nsfw: !!c.nsfw, featured: !!c.featured,
    owner_id: c.owner_id, owner_name: ownerName || '', owner_avatar: ownerAvatar || '', owner_tier: ownerTier || 0,
    created_at: c.created_at,
  };
}

// List my characters
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM characters WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ characters: rows });
});

// Public gallery of characters, with category + search filters.
// 支持 limit/offset 分页：沉浸式信息流按页加载，避免一次性返回全量。
router.get('/public', authOptional, (req, res) => {
  const { category, q, sort } = req.query;
  let sql = `SELECT c.*, u.display_name AS owner_name FROM characters c
    JOIN users u ON u.id = c.owner_id WHERE c.is_public = 1`;
  const args = [];
  if (category && category !== 'all') { sql += ' AND c.category = ?'; args.push(category); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.tags LIKE ? OR c.tagline LIKE ?)'; const k = `%${q}%`; args.push(k, k, k); }
  // 「关注」流：只看已关注创作者的公开角色（发现页方案B 顶部分段）。
  if (req.query.scope === 'following' && req.user) {
    sql += ' AND c.owner_id IN (SELECT following_id FROM follows WHERE follower_id = ?)';
    args.push(req.user.id);
  }
  sql += sort === 'new' ? ' ORDER BY c.created_at DESC' : ' ORDER BY c.uses DESC, c.likes DESC';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  sql += ' LIMIT ? OFFSET ?';
  args.push(limit, offset);
  const rows = db.prepare(sql).all(...args);
  if (req.user) {
    const fav = new Set(db.prepare('SELECT character_id FROM favorites WHERE user_id = ?').all(req.user.id).map(r => r.character_id));
    rows.forEach(r => (r.faved = fav.has(r.id)));
  }
  res.json({ characters: rows });
});

// Personalized recommendations — rank public characters by the categories the
// caller has favorited / chatted with, blended with popularity. Excludes the
// caller's own characters and ones already favorited.
router.get('/recommended', authRequired, (req, res) => {
  const uid = req.user.id;
  const favIds = new Set(db.prepare('SELECT character_id FROM favorites WHERE user_id = ?').all(uid).map(r => r.character_id));
  const weight = {};
  const bump = (cat, w) => { if (cat) weight[cat] = (weight[cat] || 0) + w; };
  db.prepare(`SELECT c.category FROM favorites f JOIN characters c ON c.id = f.character_id WHERE f.user_id = ?`).all(uid).forEach(r => bump(r.category, 2));
  db.prepare(`SELECT c.category FROM conversations cv JOIN characters c ON c.id = cv.character_id WHERE cv.user_id = ?`).all(uid).forEach(r => bump(r.category, 1));
  const personalized = Object.keys(weight).length > 0;
  const pool = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c
    JOIN users u ON u.id = c.owner_id
    WHERE c.is_public = 1 AND c.owner_id != ?`).all(uid);
  const rows = pool
    .filter(c => !favIds.has(c.id))
    .map(c => ({ c, score: (weight[c.category] || 0) * 3 + Math.log10((c.uses || 0) + (c.likes || 0) + 1) + (c.featured ? 0.4 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 12)
    .map(({ c }) => ({ ...c, faved: false }));
  res.json({ characters: rows, personalized });
});

// Favorites
router.get('/favorites/list', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM favorites f
    JOIN characters c ON c.id = f.character_id JOIN users u ON u.id = c.owner_id
    WHERE f.user_id = ? AND (c.is_public = 1 OR c.owner_id = ?) ORDER BY c.id DESC`)
    .all(req.user.id, req.user.id);
  res.json({ characters: rows });
});
router.post('/:id/favorite', authRequired, (req, res) => {
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND character_id = ?').get(req.user.id, req.params.id);
  if (has) { db.prepare('DELETE FROM favorites WHERE user_id = ? AND character_id = ?').run(req.user.id, req.params.id);
    db.prepare('UPDATE characters SET likes = MAX(0, likes - 1) WHERE id = ?').run(req.params.id);
    log({ category: 'character', level: 'info', event: 'favorite', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: Number(req.params.id), faved: false }, message: '取消收藏角色' });
    return res.json({ faved: false }); }
  const character = db.prepare('SELECT id, owner_id, is_public FROM characters WHERE id = ?').get(req.params.id);
  // Return 404 for an inaccessible private card so the favorite endpoint is
  // not an existence oracle. Owners may still organize their own private cards.
  if (!character || (!character.is_public && character.owner_id !== req.user.id)) {
    return res.status(404).json({ error: '角色不存在或不可收藏' });
  }
  db.prepare('INSERT INTO favorites (user_id, character_id) VALUES (?,?)').run(req.user.id, req.params.id);
  db.prepare('UPDATE characters SET likes = likes + 1 WHERE id = ?').run(req.params.id);
  bumpDaily(req.user.id, 'fav');
  log({ category: 'character', level: 'info', event: 'favorite', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: Number(req.params.id), faved: true }, message: '收藏角色' });
  res.json({ faved: true });
});

router.get('/:id', authOptional, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  if (!c.is_public && (!req.user || req.user.id !== c.owner_id)) return res.status(403).json({ error: '无权访问' });
  const owner = db.prepare('SELECT id, display_name, avatar, verified FROM users WHERE id = ?').get(c.owner_id);
  const fav_count = db.prepare('SELECT COUNT(*) n FROM favorites WHERE character_id = ?').get(c.id).n;
  const related = db.prepare(`SELECT id, name, avatar, tagline, uses, category FROM characters
    WHERE is_public = 1 AND id != ? AND (category = ? OR owner_id = ?) ORDER BY uses DESC LIMIT 6`).all(c.id, c.category, c.owner_id);
  const author_char_count = db.prepare('SELECT COUNT(*) n FROM characters WHERE is_public = 1 AND owner_id = ? AND id != ?').get(c.owner_id, c.id).n;
  const character = { ...ownerView(c), owner_name: owner?.display_name, owner_avatar: owner?.avatar, owner_verified: !!owner?.verified, owner_tier: creatorTier(c.owner_id), fav_count, author_char_count };
  if (req.user) character.faved = !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND character_id=?').get(req.user.id, c.id);
  res.json({ character, related });
});

router.post('/', authRequired, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '角色名必填' });
  const wbIds = linkedWorldbookIds(b.linked_worldbook_ids);
  if (wbIds.length) {
    const usable = db.prepare(`SELECT COUNT(*) AS n FROM worldbooks
      WHERE id IN (${wbIds.map(() => '?').join(',')}) AND (is_public = 1 OR owner_id = ?)`)
      .get(...wbIds, req.user.id).n;
    if (usable !== wbIds.length) return res.status(403).json({ error: '含有不存在、私有或无权使用的世界书' });
  }
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, alt_greetings)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw,@alt_greetings)`)
    .run({
      owner_id: req.user.id,
      name: b.name, avatar: b.avatar || null,
      background: b.background || null, background_type: b.background_type || 'image', bgm: b.bgm || '',
      tagline: b.tagline || '', intro: b.intro || '', greeting: b.greeting || '',
      persona: b.persona || '', voice_name: b.voice_name || '', voice_speed: clampSpeed(b.voice_speed), voice_pitch: clampPitch(b.voice_pitch),
      category: b.category || '', tags: b.tags || '',
      is_public: b.is_public ? 1 : 0, nsfw: b.nsfw ? 1 : 0,
      alt_greetings: normAltGreetings(b.alt_greetings)
    });
  saveWorld(info.lastInsertRowid, b.world);
  // 创建时一并落库，避免「先保存角色、再返回编辑页关联」的断裂流程。
  if (wbIds.length) {
    const attach = db.prepare('INSERT OR IGNORE INTO character_worldbooks (character_id, worldbook_id) VALUES (?,?)');
    const bumpUses = db.prepare('UPDATE worldbooks SET uses = uses + 1 WHERE id = ?');
    const linkAll = db.transaction(() => wbIds.forEach(wbId => { attach.run(info.lastInsertRowid, wbId); bumpUses.run(wbId); }));
    linkAll();
  }
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  // 新建即公开的角色卡：秒级广播给所有在线用户（排除发布者本人，避免自打扰）。
  if (b.is_public) {
    broadcast('character_new', { character: cardPreview(c, req.user.display_name, req.user.avatar, creatorTier(req.user.id)) }, req.user.id);
  }
  log({ category: 'character', level: 'info', event: 'character_create', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: c.id, name: c.name, is_public: !!c.is_public }, message: '创建角色' });
  res.json({ character: ownerView(c) });
});

router.put('/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权编辑' });
  const b = req.body || {};
  db.prepare(`UPDATE characters SET
    name=@name, avatar=@avatar, background=@background, background_type=@background_type, bgm=@bgm,
    tagline=@tagline, intro=@intro, greeting=@greeting, persona=@persona,
    voice_name=@voice_name, voice_speed=@voice_speed, voice_pitch=@voice_pitch, category=@category, tags=@tags, is_public=@is_public, nsfw=@nsfw, front_regex=@front_regex, alt_greetings=@alt_greetings WHERE id=@id`)
    .run({
      id: c.id,
      alt_greetings: normAltGreetings(b.alt_greetings, c.alt_greetings || '[]'),
      front_regex: (() => { if (b.front_regex == null) return c.front_regex || '[]'; try { const v = typeof b.front_regex === 'string' ? JSON.parse(b.front_regex) : b.front_regex; return Array.isArray(v) ? JSON.stringify(v).slice(0, 4000000) : (c.front_regex || '[]'); } catch { return c.front_regex || '[]'; } })(),
      name: b.name ?? c.name, avatar: b.avatar ?? c.avatar,
      background: b.background ?? c.background, background_type: b.background_type ?? c.background_type,
      bgm: b.bgm ?? c.bgm,
      tagline: b.tagline ?? c.tagline, intro: b.intro ?? c.intro, greeting: b.greeting ?? c.greeting,
      persona: b.persona ?? c.persona, voice_name: b.voice_name ?? c.voice_name,
      voice_speed: b.voice_speed != null ? clampSpeed(b.voice_speed) : (c.voice_speed ?? 1),
      voice_pitch: b.voice_pitch != null ? clampPitch(b.voice_pitch) : (c.voice_pitch ?? 1),
      category: b.category ?? c.category, tags: b.tags ?? c.tags,
      is_public: (b.is_public ? 1 : 0), nsfw: (b.nsfw ? 1 : 0)
    });
  if (b.world) saveWorld(c.id, b.world);
  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(c.id);
  log({ category: 'character', level: 'info', event: 'character_update', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: updated.id, name: updated.name, is_public: !!updated.is_public }, message: '更新角色' });
  res.json({ character: ownerView(updated) });
});

router.delete('/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM characters WHERE id = ?').run(c.id);
  log({ category: 'character', level: 'info', event: 'character_delete', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: c.id, name: c.name, is_public: !!c.is_public }, message: '删除角色' });
  res.json({ ok: true });
});

function saveWorld(characterId, world) {
  db.prepare('DELETE FROM world_entries WHERE character_id = ?').run(characterId);
  if (!Array.isArray(world)) return;
  const stmt = db.prepare('INSERT INTO world_entries (character_id, keys, content, enabled, position, constant) VALUES (?,?,?,?,?,?)');
  world.forEach((w, i) => {
    if (!w || (!w.content && !w.keys)) return;
    // constant（酒馆常驻条目）：无视关键词恒注入 —— 驱动酒馆卡游戏引擎的规则条目多依赖此标记
    stmt.run(characterId, w.keys || '', w.content || '', w.enabled === false ? 0 : 1, i, w.constant ? 1 : 0);
  });
}

// alt_greetings（备用开场白）：接受数组或已序列化字符串，落库为 JSON 文本。
function normAltGreetings(v, fallback = '[]') {
  if (v == null) return fallback;
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return fallback;
    return JSON.stringify(arr.filter(g => typeof g === 'string' && g.trim()).slice(0, 10).map(g => g.slice(0, 24000)));
  } catch { return fallback; }
}

// ── 角色卡 JSON 导出 ──────────────────────────────────────────────
// 返回可移植的角色卡 JSON：含元信息 + 角色字段 + 世界书条目。
// 公开角色任何人可导出；私有角色仅 owner 可导出。
router.get('/:id/export', authOptional, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  if (!c.is_public && (!req.user || req.user.id !== c.owner_id)) return res.status(403).json({ error: '无权导出' });
  const world = loadWorld(c.id).map(w => ({ keys: w.keys, content: w.content, enabled: !!w.enabled, position: w.position, constant: !!w.constant }));
  const card = {
    platform: 'huanyu',
    spec: 1,
    exported_at: new Date().toISOString(),
    character: {
      name: c.name, avatar: c.avatar, background: c.background, background_type: c.background_type, bgm: c.bgm,
      tagline: c.tagline, intro: c.intro, greeting: c.greeting, persona: c.persona,
      voice_name: c.voice_name, voice_speed: c.voice_speed, voice_pitch: c.voice_pitch,
      category: c.category, tags: c.tags, nsfw: !!c.nsfw,
      front_regex: c.front_regex || '[]', alt_greetings: c.alt_greetings || '[]'
    },
    world
  };
  res.setHeader('Content-Disposition', `attachment; filename="character-${c.id}-${encodeURIComponent(c.name)}.json"`);
  res.json(card);
});

// ── 角色卡 JSON 导入 ──────────────────────────────────────────────
// 接收导出格式 JSON，创建为当前用户的新角色（私有，需用户自行发布）。
// 限频 contentLimiter 防止批量灌入。字段严格白名单，忽略 id/owner/uses 等元数据。
router.post('/import', authRequired, contentLimiter, (req, res) => {
  const body = req.body || {};
  const ch = body.character || body;   // 兼容裸 character 对象
  if (!ch || !ch.name || typeof ch.name !== 'string' || ch.name.length > 60) {
    return res.status(400).json({ error: '角色卡格式无效：缺少 name 或长度超限' });
  }
  const world = Array.isArray(body.world) ? body.world.filter(w => w && typeof w === 'object') : [];
  if (world.length > 1000) return res.status(400).json({ error: '世界书条目过多（上限 1000）' });
  // front_regex：接受数组或已序列化字符串，落库为 JSON 文本（上限约 60KB，容纳大 HTML 面板）。
  const frontRegex = (() => {
    try { const v = typeof ch.front_regex === 'string' ? JSON.parse(ch.front_regex) : ch.front_regex; return Array.isArray(v) ? JSON.stringify(v).slice(0, 4000000) : '[]'; }
    catch { return '[]'; }
  })();
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, front_regex, alt_greetings)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw,@front_regex,@alt_greetings)`)
    .run({
      owner_id: req.user.id,
      name: str(ch.name, 60),
      avatar: str(ch.avatar, 500),
      background: str(ch.background, 500), background_type: ['image', 'color', 'video'].includes(ch.background_type) ? ch.background_type : 'image', bgm: str(ch.bgm, 500),
      tagline: str(ch.tagline, 200), intro: str(ch.intro, 8000), greeting: str(ch.greeting, 24000),
      persona: str(ch.persona, 24000), voice_name: str(ch.voice_name, 60),
      voice_speed: clampSpeed(ch.voice_speed), voice_pitch: clampPitch(ch.voice_pitch),
      category: str(ch.category, 40), tags: str(ch.tags, 200),
      is_public: 0, nsfw: ch.nsfw ? 1 : 0, front_regex: frontRegex,
      alt_greetings: normAltGreetings(ch.alt_greetings)
    });
  saveWorld(info.lastInsertRowid, world);
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  log({ category: 'character', level: 'info', event: 'import', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: c.id, name: c.name, is_public: !!c.is_public }, message: '导入角色卡' });
  res.json({ character: ownerView(c) });
});

export default router;
