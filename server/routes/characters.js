import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { bumpDaily } from '../daily.js';
import { creatorTier } from '../creator.js';
import { contentLimiter } from '../limiters.js';
import { broadcast } from '../realtime.js';

const router = Router();

function loadWorld(characterId) {
  return db.prepare('SELECT * FROM world_entries WHERE character_id = ? ORDER BY position, id').all(characterId);
}

// Voice speed is a 0.5–2.0 multiplier; default 1 (normal). Guards bad input.
const clampSpeed = (v) => { const n = Number(v); return n >= 0.5 && n <= 2 ? Math.round(n * 100) / 100 : 1; };
// Voice pitch is a 0.5–1.5 multiplier; default 1 (natural).
const clampPitch = (v) => { const n = Number(v); return n >= 0.5 && n <= 1.5 ? Math.round(n * 100) / 100 : 1; };

function ownerView(c) {
  if (!c) return c;
  c.world = loadWorld(c.id);
  // 附加角色关联的独立世界书（供前端展示/管理）。
  // front_schema / prompt_overlay 一并下发 —— 专家世界书的自构前端与提示词叠加
  // 在角色详情/编辑器里可见可管理（与 APP 端 mock charView 同构）。
  c.linked_worldbooks = db.prepare(`SELECT w.id, w.name, w.is_public, w.owner_id,
    w.front_schema, w.prompt_overlay,
    (SELECT COUNT(*) FROM worldbook_entries WHERE worldbook_id = w.id) AS entry_count
    FROM character_worldbooks cw JOIN worldbooks w ON w.id = cw.worldbook_id
    WHERE cw.character_id = ? ORDER BY w.id`).all(c.id);
  // 图片触发映射：专家世界书条目的预注入图片（id → urls/position/slot），
  // 聊天页与角色详情按此直接渲染创作者预设插图（与 mock 后端 wb_image_map 同构）。
  c.wb_image_map = {};
  const imgRows = db.prepare(`SELECT we.id, we.image_urls, we.image_position, we.front_slot, we.worldbook_id
    FROM worldbook_entries we JOIN character_worldbooks cw ON cw.worldbook_id = we.worldbook_id
    WHERE cw.character_id = ? AND we.enabled = 1 AND we.image_urls != '' AND we.image_keys != ''`).all(c.id);
  for (const r of imgRows) {
    const urls = String(r.image_urls).split(',').map(u => u.trim()).filter(Boolean);
    if (urls.length) c.wb_image_map[r.id] = { urls, position: r.image_position || 'inline', slot: r.front_slot || '', worldbook_id: r.worldbook_id };
  }
  return c;
}

// front_regex（酒馆 regex_scripts）：接受数组或已序列化字符串，落库为 JSON 文本；坏输入回退。
function normFrontRegex(v, fallback = '[]') {
  if (v == null) return fallback || '[]';
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? JSON.stringify(a).slice(0, 4000000) : (fallback || '[]');
  } catch { return fallback || '[]'; }
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
    WHERE f.user_id = ? ORDER BY c.id DESC`).all(req.user.id);
  res.json({ characters: rows });
});
router.post('/:id/favorite', authRequired, (req, res) => {
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND character_id = ?').get(req.user.id, req.params.id);
  if (has) { db.prepare('DELETE FROM favorites WHERE user_id = ? AND character_id = ?').run(req.user.id, req.params.id);
    db.prepare('UPDATE characters SET likes = MAX(0, likes - 1) WHERE id = ?').run(req.params.id); return res.json({ faved: false }); }
  db.prepare('INSERT INTO favorites (user_id, character_id) VALUES (?,?)').run(req.user.id, req.params.id);
  db.prepare('UPDATE characters SET likes = likes + 1 WHERE id = ?').run(req.params.id);
  bumpDaily(req.user.id, 'fav');
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
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, front_regex, alt_greetings)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw,@front_regex,@alt_greetings)`)
    .run({
      owner_id: req.user.id,
      name: b.name, avatar: b.avatar || null,
      background: b.background || null, background_type: b.background_type || 'image', bgm: b.bgm || '',
      tagline: b.tagline || '', intro: b.intro || '', greeting: b.greeting || '',
      persona: b.persona || '', voice_name: b.voice_name || '', voice_speed: clampSpeed(b.voice_speed), voice_pitch: clampPitch(b.voice_pitch),
      category: b.category || '', tags: b.tags || '',
      is_public: b.is_public ? 1 : 0, nsfw: b.nsfw ? 1 : 0,
      // 创建即支持前端显示正则（此前仅 PUT/导入支持，带正则的酒馆卡首存会丢字段）
      front_regex: normFrontRegex(b.front_regex),
      alt_greetings: normAltGreetings(b.alt_greetings)
    });
  saveWorld(info.lastInsertRowid, b.world);
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  // 新建即公开的角色卡：秒级广播给所有在线用户（排除发布者本人，避免自打扰）。
  if (b.is_public) {
    broadcast('character_new', { character: cardPreview(c, req.user.display_name, req.user.avatar, creatorTier(req.user.id)) }, req.user.id);
  }
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
      front_regex: normFrontRegex(b.front_regex, c.front_regex || '[]'),
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
  res.json({ character: ownerView(updated) });
});

router.delete('/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM characters WHERE id = ?').run(c.id);
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
  const str = (v, max) => v == null ? '' : String(v).slice(0, max);
  const frontRegex = normFrontRegex(ch.front_regex);
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
  res.json({ character: ownerView(c) });
});

export default router;
