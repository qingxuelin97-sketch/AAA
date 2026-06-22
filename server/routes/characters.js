import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { bumpDaily } from '../daily.js';

const router = Router();

function loadWorld(characterId) {
  return db.prepare('SELECT * FROM world_entries WHERE character_id = ? ORDER BY position, id').all(characterId);
}

function ownerView(c) {
  if (!c) return c;
  c.world = loadWorld(c.id);
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
  res.json({ character: ownerView(c) });
});

router.post('/', authRequired, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '角色名必填' });
  const info = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, tagline, intro, greeting, persona, voice_name, category, tags, is_public, nsfw)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@tagline,@intro,@greeting,@persona,@voice_name,@category,@tags,@is_public,@nsfw)`)
    .run({
      owner_id: req.user.id,
      name: b.name, avatar: b.avatar || null,
      background: b.background || null, background_type: b.background_type || 'image',
      tagline: b.tagline || '', intro: b.intro || '', greeting: b.greeting || '',
      persona: b.persona || '', voice_name: b.voice_name || '', category: b.category || '', tags: b.tags || '',
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
    name=@name, avatar=@avatar, background=@background, background_type=@background_type,
    tagline=@tagline, intro=@intro, greeting=@greeting, persona=@persona,
    voice_name=@voice_name, category=@category, tags=@tags, is_public=@is_public, nsfw=@nsfw WHERE id=@id`)
    .run({
      id: c.id,
      name: b.name ?? c.name, avatar: b.avatar ?? c.avatar,
      background: b.background ?? c.background, background_type: b.background_type ?? c.background_type,
      tagline: b.tagline ?? c.tagline, intro: b.intro ?? c.intro, greeting: b.greeting ?? c.greeting,
      persona: b.persona ?? c.persona, voice_name: b.voice_name ?? c.voice_name,
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

export default router;
