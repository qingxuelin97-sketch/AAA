import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { bumpDaily } from '../daily.js';
import { creatorTier } from '../creator.js';
import { contentLimiter } from '../limiters.js';
import { broadcast } from '../realtime.js';
import { log } from '../logger.js';
import { str } from '../validate.js';

// 剧本自动生成的「主持人」卡不算用户自己的角色。
// scripts.js 的 /play 会为每个剧本建一张 tags = 'script:<id>' 的私有角色作为 GM，
// 那是实现细节，不是用户创作 —— 但「我的角色库」「创作中心」「成就计数」此前都
// 没有排除它，于是每玩一个剧本，角色库里就多一张幽灵卡，创作数与成就也跟着虚高。
// mock 一直用 from_script 字段过滤，可真后端根本没有这一列（全仓 grep 为 0），
// 照 mock 的写法搬过来会直接失效 —— 真后端只能按 tags 前缀判。
const NOT_SCRIPT_CARD = "AND (tags IS NULL OR tags NOT LIKE 'script:%')";

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
    owner_id: c.owner_id, owner_name: ownerName || '', owner_avatar: ownerAvatar || '', owner_tier: ownerTier ?? null,   // 统一为 null；此前这里兜底成数字 0，与详情/列表两种类型
    created_at: c.created_at,
  };
}

// List my characters
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT * FROM characters WHERE owner_id = ? ${NOT_SCRIPT_CARD} ORDER BY created_at DESC`).all(req.user.id);
  res.json({ characters: rows });
});

// Public gallery of characters, with category + search filters.
// 支持 limit/offset 分页：沉浸式信息流按页加载，避免一次性返回全量。
// —— owner_tier 是列表卡片上的创作者 V 徽章 ——
// 前端 DiscoverFeed / Home / Spotlight / WebHome 都读这个字段，但三个列表端点
// （/public、/recommended、/favorites/list）一个都不返回，只有 SSE 推送与详情页返回。
// 于是首页、发现流、聚光灯上的 V 徽章**永远不显示**；别人新发的卡经 SSE 推上来时
// 反而有，刷新一下又没了 —— 典型的「功能静默失效」。
// 而 mock 的同名端点是返回的，所以静态试玩里一切正常，接上真后端才消失。
// creatorTier 会逐个用户查库，这里按 owner 去重后批量算，避免 N+1。
function attachOwnerTier(rows) {
  const tiers = new Map();
  for (const r of rows) {
    if (!tiers.has(r.owner_id)) tiers.set(r.owner_id, creatorTier(r.owner_id) ?? null);
    r.owner_tier = tiers.get(r.owner_id);
  }
  return rows;
}

router.get('/public', authOptional, (req, res) => {
  const { category, q, sort } = req.query;
  // 显式列清单，不再 SELECT c.*。列表接口默认一次返回 80 行，而 c.* 会把三个
  // 重量级字段一并带上：
  //   front_regex —— 落库上限是 4,000,000 字符（characters.js 的写入处），
  //                  而旁边注释写的是「约 60KB」，窄了 66 倍。一张卡就能让
  //                  发现流吐出几 MB。
  //   persona     —— 完整人设，列表页一个字都不显示。
  //   alt_greetings —— 备用开场白数组，同样只在详情页用得到。
  // 保留 greeting：发现流的卡片会截取它做预览（DiscoverFeed.jsx:327）。
  // owner_avatar 一并带出——此前一级 tab 上作者的脸是隐形的。
  let sql = `SELECT c.id, c.owner_id, c.name, c.avatar, c.background, c.background_type,
      c.tagline, c.intro, c.greeting, c.voice_name, c.voice_speed, c.voice_pitch,
      c.category, c.tags, c.is_public, c.nsfw, c.likes, c.uses, c.views, c.featured, c.created_at, c.bgm,
      u.display_name AS owner_name, u.avatar AS owner_avatar
    FROM characters c
    JOIN users u ON u.id = c.owner_id WHERE c.is_public = 1`;
  const args = [];
  if (category && category !== 'all') { sql += ' AND c.category = ?'; args.push(category); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.tags LIKE ? OR c.tagline LIKE ?)'; const k = `%${q}%`; args.push(k, k, k); }
  // 「关注」流：只看已关注创作者的公开角色（发现页方案B 顶部分段）。
  if (req.query.scope === 'following' && req.user) {
    sql += ' AND c.owner_id IN (SELECT following_id FROM follows WHERE follower_id = ?)';
    args.push(req.user.id);
  }
  // ⚠ 排序键必须唯一，否则 LIMIT/OFFSET 分页会重复发牌或漏牌。
  // created_at 是 datetime('now') 的秒级精度（同秒创建即并列），热门分支的
  // uses/likes 并列面更大 —— 新站上大量角色 uses=0 & likes=0，全都并列。
  // 这是全仓唯一一个真 OFFSET 分页端点，而前端 DiscoverFeed 真的在无限滚动：
  // 并列行在相邻两页之间顺序不稳，同一张卡出现两次、另一张永远刷不出来。
  // worldbooks.js:88 早就写对了（带 w.id DESC），这里照抄。
  sql += sort === 'new' ? ' ORDER BY c.created_at DESC, c.id DESC' : ' ORDER BY c.uses DESC, c.likes DESC, c.id DESC';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  sql += ' LIMIT ? OFFSET ?';
  args.push(limit, offset);
  const rows = db.prepare(sql).all(...args);
  if (req.user) {
    const fav = new Set(db.prepare('SELECT character_id FROM favorites WHERE user_id = ?').all(req.user.id).map(r => r.character_id));
    rows.forEach(r => (r.faved = fav.has(r.id)));
  }
  res.json({ characters: attachOwnerTier(rows) });
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
  // 发现流「心动」：轻量私有喜欢，介于聊过与收藏之间，取同档 +1。
  db.prepare(`SELECT c.category FROM hearts h JOIN characters c ON c.id = h.character_id WHERE h.user_id = ?`).all(uid).forEach(r => bump(r.category, 1));
  // S7 兴趣画像：用户显式选择的分类各 +2（与收藏同权），仅在 personalize 开启时生效。
  const st = db.prepare('SELECT interests, personalize FROM settings WHERE user_id = ?').get(uid);
  if (st && st.personalize !== 0 && st.interests) {
    String(st.interests).split(',').filter(Boolean).forEach((slug) => bump(slug, 2));
  }
  const personalized = Object.keys(weight).length > 0;
  const pool = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c
    JOIN users u ON u.id = c.owner_id
    WHERE c.is_public = 1 AND c.owner_id != ?`).all(uid);
  const rows = pool
    .filter(c => !favIds.has(c.id))
    .map(c => ({ c, score: (weight[c.category] || 0) * 3 + Math.log10((c.uses || 0) + (c.likes || 0) + 1) + (c.featured ? 0.4 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 12)
    .map(({ c }) => ({ ...c, faved: false }));
  res.json({ characters: attachOwnerTier(rows), personalized });
});

// Favorites
router.get('/favorites/list', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM favorites f
    JOIN characters c ON c.id = f.character_id JOIN users u ON u.id = c.owner_id
    WHERE f.user_id = ? AND (c.is_public = 1 OR c.owner_id = ?) ORDER BY c.id DESC`)
    .all(req.user.id, req.user.id);
  res.json({ characters: attachOwnerTier(rows) });
});
// characters.likes 是 favorites 的**缓存列**，不是独立账本。
//
// 原写法是「先查、再增删、再给计数器 ±1」，三步无事务，于是：
//   · 并发收藏时裸 INSERT 撞 PK 抛错（路由无 try/catch → 500），而计数器可能已经加过；
//   · favorites 行会随用户/角色被删经 ON DELETE CASCADE 无声消失，likes 却不会跟着动；
//   · MAX(0, likes-1) 把负漂移吃掉而不是修正，误差只增不减。
// 而这个数字最终是钱：creator.js:8 里 likes 以 ×2 权重进 creatorScore，直接决定
// 创作者等级与分成。所以改成「增删与重算在同一个事务里完成」，likes 恒等于实算值。
const setFavorite = db.transaction((userId, charId, want) => {
  if (want) db.prepare("INSERT OR IGNORE INTO favorites (user_id, character_id, created_at) VALUES (?,?,datetime('now'))").run(userId, charId);
  else db.prepare('DELETE FROM favorites WHERE user_id = ? AND character_id = ?').run(userId, charId);
  db.prepare('UPDATE characters SET likes = (SELECT COUNT(*) FROM favorites WHERE character_id = ?) WHERE id = ?').run(charId, charId);
});

router.post('/:id/favorite', authRequired, (req, res) => {
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND character_id = ?').get(req.user.id, req.params.id);
  if (has) { setFavorite.immediate(req.user.id, Number(req.params.id), false);
    log({ category: 'character', level: 'info', event: 'favorite', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: Number(req.params.id), faved: false }, message: '取消收藏角色' });
    return res.json({ faved: false }); }
  const character = db.prepare('SELECT id, owner_id, is_public FROM characters WHERE id = ?').get(req.params.id);
  // Return 404 for an inaccessible private card so the favorite endpoint is
  // not an existence oracle. Owners may still organize their own private cards.
  if (!character || (!character.is_public && character.owner_id !== req.user.id)) {
    return res.status(404).json({ error: '角色不存在或不可收藏' });
  }
  setFavorite.immediate(req.user.id, Number(req.params.id), true);
  bumpDaily(req.user.id, 'fav');
  log({ category: 'character', level: 'info', event: 'favorite', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: Number(req.params.id), faved: true }, message: '收藏角色' });
  res.json({ faved: true });
});

// 心动（发现流轻量喜欢）：私有信号，不动 characters.likes 公开计数，
// 只作为推荐排序的行为输入。toggle 语义与收藏一致。
router.get('/hearts/list', authRequired, (req, res) => {
  const ids = db.prepare('SELECT character_id FROM hearts WHERE user_id = ?').all(req.user.id).map(r => r.character_id);
  res.json({ ids });
});
router.post('/:id/heart', authRequired, (req, res) => {
  const has = db.prepare('SELECT 1 FROM hearts WHERE user_id = ? AND character_id = ?').get(req.user.id, req.params.id);
  if (has) {
    db.prepare('DELETE FROM hearts WHERE user_id = ? AND character_id = ?').run(req.user.id, req.params.id);
    return res.json({ hearted: false });
  }
  // 与收藏同规则：私密角色对外 404，不当存在性探针；作者可标记自己的私密卡。
  const character = db.prepare('SELECT id, owner_id, is_public FROM characters WHERE id = ?').get(req.params.id);
  if (!character || (!character.is_public && character.owner_id !== req.user.id)) {
    return res.status(404).json({ error: '角色不存在' });
  }
  db.prepare("INSERT INTO hearts (user_id, character_id, created_at) VALUES (?,?,datetime('now'))").run(req.user.id, req.params.id);
  res.json({ hearted: true });
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
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, alt_greetings, post_history)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw,@alt_greetings,@post_history)`)
    .run({
      owner_id: req.user.id,
      name: b.name, avatar: b.avatar || null,
      background: b.background || null, background_type: b.background_type || 'image', bgm: b.bgm || '',
      tagline: b.tagline || '', intro: b.intro || '', greeting: b.greeting || '',
      persona: b.persona || '', voice_name: b.voice_name || '', voice_speed: clampSpeed(b.voice_speed), voice_pitch: clampPitch(b.voice_pitch),
      category: b.category || '', tags: b.tags || '',
      is_public: b.is_public ? 1 : 0, nsfw: b.nsfw ? 1 : 0,
      alt_greetings: normAltGreetings(b.alt_greetings),
      post_history: str(b.post_history, 8000)
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
    voice_name=@voice_name, voice_speed=@voice_speed, voice_pitch=@voice_pitch, category=@category, tags=@tags, is_public=@is_public, nsfw=@nsfw, front_regex=@front_regex, alt_greetings=@alt_greetings, post_history=@post_history WHERE id=@id`)
    .run({
      id: c.id,
      alt_greetings: normAltGreetings(b.alt_greetings, c.alt_greetings || '[]'),
      // 未提交该字段时保留原值，避免编辑其它字段时把后置指令清空
      post_history: b.post_history == null ? (c.post_history || '') : str(b.post_history, 8000),
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
// —— 导出 ——
// ?format=tavern_v2 输出 SillyTavern V2 规范卡（可直接导回酒馆）；缺省输出幻域格式。
// 两种格式都会带上**关联的独立世界书**：此前只导内嵌 world、不导 linked_worldbooks，
// 于是把世界书做在独立书里的角色导出后是残的——连自有格式都存在这个洞。
router.get('/:id/export', authOptional, (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  if (!c.is_public && (!req.user || req.user.id !== c.owner_id)) return res.status(403).json({ error: '无权导出' });

  const embedded = loadWorld(c.id).map(w => ({
    keys: w.keys, content: w.content, enabled: !!w.enabled, position: w.position, constant: !!w.constant,
  }));
  // 关联的独立世界书条目：全字段带出，导回酒馆时不丢选择性触发 / 概率 / 分组等能力。
  const linked = db.prepare(`SELECT we.* FROM worldbook_entries we
    JOIN character_worldbooks cw ON cw.worldbook_id = we.worldbook_id
    WHERE cw.character_id = ? ORDER BY we.priority DESC, we.position, we.id`).all(c.id);

  const parseJson = (v, fallback) => { try { const x = JSON.parse(v || ''); return x ?? fallback; } catch { return fallback; } };
  const altGreetings = parseJson(c.alt_greetings, []);
  const splitKeys = (v) => String(v || '').split(',').map(k => k.trim()).filter(Boolean);

  if (req.query.format === 'tavern_v2') {
    // character_book：内嵌 + 关联合并为一本，字段按 V2 规范反向映射。
    const bookEntries = [
      ...embedded.map((w, i) => ({
        keys: splitKeys(w.keys), secondary_keys: [], comment: '', content: w.content,
        constant: !!w.constant, selective: false, insertion_order: i, enabled: w.enabled,
        position: 'before_char', extensions: {},
      })),
      ...linked.map((w, i) => ({
        keys: splitKeys(w.keys),
        secondary_keys: splitKeys(w.required_keys),
        comment: w.comment || '',
        content: w.content,
        constant: w.mode === 'always',
        selective: !!splitKeys(w.required_keys).length,
        insertion_order: Number.isFinite(w.priority) ? w.priority : embedded.length + i,
        enabled: !!w.enabled,
        position: w.inject_pos === 'before' ? 'before_char' : 'after_char',
        case_sensitive: !!w.case_sensitive,
        probability: Number.isFinite(w.probability) ? w.probability : 100,
        useProbability: true,
        group: w.group_name || '',
        depth: w.depth || 0,
        sticky: w.sticky || 0,
        cooldown: w.cooldown || 0,
        extensions: {},
      })),
    ];
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: c.name,
        description: c.persona || '',
        personality: '',
        scenario: '',
        first_mes: c.greeting || '',
        mes_example: '',
        creator_notes: c.intro || '',
        // 后置指令按语义放回它自己的字段，而不是混进 description。
        post_history_instructions: c.post_history || '',
        system_prompt: '',
        alternate_greetings: Array.isArray(altGreetings) ? altGreetings : [],
        tags: String(c.tags || '').split(',').map(t => t.trim()).filter(Boolean),
        creator: '',
        character_version: '',
        extensions: { huanyu: { front_regex: parseJson(c.front_regex, []) } },
        ...(bookEntries.length ? { character_book: { name: `${c.name} 世界书`, entries: bookEntries, extensions: {} } } : {}),
      },
    };
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(c.name)}.tavern.json"`);
    return res.json(card);
  }

  const card = {
    platform: 'huanyu',
    spec: 1,
    exported_at: new Date().toISOString(),
    character: {
      name: c.name, avatar: c.avatar, background: c.background, background_type: c.background_type, bgm: c.bgm,
      tagline: c.tagline, intro: c.intro, greeting: c.greeting, persona: c.persona,
      voice_name: c.voice_name, voice_speed: c.voice_speed, voice_pitch: c.voice_pitch,
      category: c.category, tags: c.tags, nsfw: !!c.nsfw,
      front_regex: c.front_regex || '[]', alt_greetings: c.alt_greetings || '[]',
      post_history: c.post_history || '',
    },
    world: embedded,
    // 关联世界书不再被丢掉
    linked_worldbooks: linked.map(w => ({
      keys: w.keys, required_keys: w.required_keys || '', content: w.content, comment: w.comment || '',
      enabled: !!w.enabled, mode: w.mode || 'keyword', inject_pos: w.inject_pos || 'after',
      priority: w.priority ?? 50, case_sensitive: !!w.case_sensitive, group_name: w.group_name || '',
      probability: w.probability ?? 100, depth: w.depth || 0, sticky: w.sticky || 0, cooldown: w.cooldown || 0,
    })),
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
    (owner_id, name, avatar, background, background_type, bgm, tagline, intro, greeting, persona, voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, front_regex, alt_greetings, post_history)
    VALUES (@owner_id,@name,@avatar,@background,@background_type,@bgm,@tagline,@intro,@greeting,@persona,@voice_name,@voice_speed,@voice_pitch,@category,@tags,@is_public,@nsfw,@front_regex,@alt_greetings,@post_history)`)
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
      alt_greetings: normAltGreetings(ch.alt_greetings),
      post_history: str(ch.post_history, 8000)
    });
  saveWorld(info.lastInsertRowid, world);
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  log({ category: 'character', level: 'info', event: 'import', user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '', extra: { character_id: c.id, name: c.name, is_public: !!c.is_public }, message: '导入角色卡' });
  res.json({ character: ownerView(c) });
});

export default router;
