import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { bumpDaily } from '../daily.js';
import { creatorTier } from '../creator.js';
import { contentLimiter } from '../limiters.js';

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
  // 附加角色关联的独立世界书（供前端展示/管理）
  c.linked_worldbooks = db.prepare(`SELECT w.id, w.name, w.is_public, w.owner_id,
    (SELECT COUNT(*) FROM worldbook_entries WHERE worldbook_id = w.id) AS entry_count
    FROM character_worldbooks cw JOIN worldbooks w ON w.id = cw.worldbook_id
    WHERE cw.character_id = ? ORDER BY w.id`).all(c.id);
  return c;
}

// List my characters
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM characters WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ characters: rows });
});

// Public gallery of characters, with category + search filters
router.get('/public', authOptional, (req, res) => {
  const { category, q, sort } = req.query;
  let sql = `SELECT c.*, u.display_name AS owner_name FROM characters c
    JOIN users u ON u.id = c.owner_id WHERE c.is_public = 1`;
  const args = [];
  if (category && category !== 'all') { sql += ' AND c.category = ?'; args.push(category); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.tags LIKE ? OR c.tagline LIKE ?)'; const k = `%${q}%`; args.push(k, k, k); }
  sql += sort === 'new' ? ' ORDER BY c.created_at DESC' : ' ORDER BY c.uses DESC, c.likes DESC';
  sql += ' LIMIT 80';
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
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw)`)
    .run({
      owner_id: req.user.id,
      name: b.name, avatar: b.avatar || null,
      background: b.background || null, background_type: b.background_type || 'image', bgm: b.bgm || '',
      tagline: b.tagline || '', intro: b.intro || '', greeting: b.greeting || '',
      persona: b.persona || '', voice_name: b.voice_name || '', voice_speed: clampSpeed(b.voice_speed), voice_pitch: clampPitch(b.voice_pitch),
      category: b.category || '', tags: b.tags || '',
      is_public: b.is_public ? 1 : 0, nsfw: b.nsfw ? 1 : 0
    });
  saveWorld(info.lastInsertRowid, b.world);
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  res.json({ character: ownerView(c) });
});

router.put('/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c || c.owner_id !== req.user.id) return res.status(403).json({ error: '无权编辑' });
  const b = req.body || {};
  db.prepare(`UPDATE characters SET
    name=@name, avatar=@avatar, background=@background, background_type=@background_type, bgm=@bgm,
    tagline=@tagline, intro=@intro, greeting=@greeting, persona=@persona,
    voice_name=@voice_name, voice_speed=@voice_speed, voice_pitch=@voice_pitch, category=@category, tags=@tags, is_public=@is_public, nsfw=@nsfw WHERE id=@id`)
    .run({
      id: c.id,
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
  const stmt = db.prepare('INSERT INTO world_entries (character_id, keys, content, enabled, position) VALUES (?,?,?,?,?)');
  world.forEach((w, i) => {
    if (!w || (!w.content && !w.keys)) return;
    stmt.run(characterId, w.keys || '', w.content || '', w.enabled === false ? 0 : 1, i);
  });
}

// ── 角色卡 JSON 导出 ──────────────────────────────────────────────
// 返回可移植的角色卡 JSON：含元信息 + 角色字段 + 世界书条目。
// 公开角色任何人可导出；私有角色仅 owner 可导出。
router.get('/:id/export', authOptional, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  if (!c.is_public && (!req.user || req.user.id !== c.owner_id)) return res.status(403).json({ error: '无权导出' });
  const world = loadWorld(c.id).map(w => ({ keys: w.keys, content: w.content, enabled: !!w.enabled, position: w.position }));
  const card = {
    platform: 'huanyu',
    spec: 1,
    exported_at: new Date().toISOString(),
    character: {
      name: c.name, avatar: c.avatar, background: c.background, background_type: c.background_type, bgm: c.bgm,
      tagline: c.tagline, intro: c.intro, greeting: c.greeting, persona: c.persona,
      voice_name: c.voice_name, voice_speed: c.voice_speed, voice_pitch: c.voice_pitch,
      category: c.category, tags: c.tags, nsfw: !!c.nsfw
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
  if (world.length > 200) return res.status(400).json({ error: '世界书条目过多（上限 200）' });
  const str = (v, max) => v == null ? '' : String(v).slice(0, max);
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw)`)
    .run({
      owner_id: req.user.id,
      name: str(ch.name, 60),
      avatar: str(ch.avatar, 500),
      background: str(ch.background, 500), background_type: ['image', 'color', 'video'].includes(ch.background_type) ? ch.background_type : 'image', bgm: str(ch.bgm, 500),
      tagline: str(ch.tagline, 200), intro: str(ch.intro, 4000), greeting: str(ch.greeting, 4000),
      persona: str(ch.persona, 8000), voice_name: str(ch.voice_name, 60),
      voice_speed: clampSpeed(ch.voice_speed), voice_pitch: clampPitch(ch.voice_pitch),
      category: str(ch.category, 40), tags: str(ch.tags, 200),
      is_public: 0, nsfw: ch.nsfw ? 1 : 0
    });
  saveWorld(info.lastInsertRowid, world);
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  res.json({ character: ownerView(c) });
});

export default router;
