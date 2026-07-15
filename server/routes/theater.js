import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { assertPublicUrl, safeFetch } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';
import { push } from '../realtime.js';

const router = Router();
const memberOf = (tid, uid) => !!db.prepare('SELECT 1 FROM theater_members WHERE theater_id = ? AND user_id = ?').get(tid, uid);

// 新段落 SSE 秒推给其他在线读者 —— 此前只靠前端 4s 轮询，联机共读时
// 别人的行动/AI 续写要等 0~4s 才出现；轮询保留为断连兜底（前端已放宽）。
// removedId：「重写」场景先摘旧段再插新段，客户端按此同步。
function pushTheaterMsg(t, message, exceptUid, removedId = null) {
  const ids = db.prepare('SELECT user_id FROM theater_members WHERE theater_id = ?').all(t.id).map(r => r.user_id);
  for (const uid of new Set([...ids, t.owner_id])) {
    if (uid !== exceptUid) push(uid, 'theater_msg', { theater_id: t.id, message, removedId });
  }
}

function castOf(tid) {
  return db.prepare(`SELECT c.* FROM theater_cast tc JOIN characters c ON c.id = tc.character_id WHERE tc.theater_id = ?`).all(tid);
}

// API responses expose only presentation fields. Persona, prompts, voice
// credentials and private character metadata remain server-side for generation.
function publicCastOf(tid) {
  return db.prepare(`SELECT c.id, c.name, c.avatar, c.background, c.background_type,
      c.tagline, c.category
    FROM theater_cast tc JOIN characters c ON c.id = tc.character_id
    WHERE tc.theater_id = ? ORDER BY c.id`).all(tid);
}

const castIdsOf = (raw) => [...new Set((Array.isArray(raw) ? raw : [])
  .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 20);

// 舞台设定（互动小说背景系统，全部由创作者自定义）：
//   charAuto — 角色发言时是否自动切到该角色背景
//   charBg   — { 角色id: 背景图 }，覆盖该角色在本小说里的背景（留空则用角色自带背景）
//   scenes   — [{ name, keys, image }]，剧情命中关键词时切到对应场景背景
// 入库前做大小/数量/类型收敛，防止超长字段与脏数据。
function cleanStage(raw) {
  let cfg = raw;
  if (typeof raw === 'string') { try { cfg = JSON.parse(raw); } catch { cfg = {}; } }
  if (!cfg || typeof cfg !== 'object') cfg = {};
  const charBg = {};
  if (cfg.charBg && typeof cfg.charBg === 'object') {
    for (const [k, v] of Object.entries(cfg.charBg)) {
      if (/^\d+$/.test(String(k)) && typeof v === 'string' && v && v.length < 2000) charBg[k] = v;
    }
  }
  const scenes = (Array.isArray(cfg.scenes) ? cfg.scenes : []).slice(0, 30).map(s => ({
    name: String(s?.name || '').slice(0, 40),
    keys: String(s?.keys || '').slice(0, 300),
    image: typeof s?.image === 'string' ? s.image.slice(0, 2000) : '',
  })).filter(s => s.image && s.keys);
  return { charAuto: cfg.charAuto !== false, charBg, scenes };
}

// 互动小说专属世界书（创作者自定义）：叠加在所有登场角色之上的额外设定。
//   每条 { keys（关键词，逗号分隔）, content（设定内容）, always（常驻：始终注入） }
function cleanWorld(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) arr = [];
  return arr.slice(0, 60).map(e => ({
    keys: String(e?.keys || '').slice(0, 200),
    content: String(e?.content || '').slice(0, 2000),
    always: !!e?.always,
  })).filter(e => e.content.trim());
}

const splitKeys = (s) => String(s || '').split(/[，,]/).map(k => k.trim().toLowerCase()).filter(Boolean);
// 关键词触发：留空关键词或标记常驻 => 始终注入；否则任一关键词命中近期剧情即注入。
function triggerEntries(entries, hay) {
  const out = [];
  for (const e of entries) {
    const keys = splitKeys(e.keys);
    if (e.always || keys.length === 0 || keys.some(k => hay.includes(k))) { if (e.content) out.push(e.content); }
  }
  return out;
}
// 取登场角色的「角色世界书」：内嵌 world_entries + 关联的独立世界书条目（默认关键词触发）。
function charWorldEntries(charIds) {
  if (!charIds.length) return [];
  const ph = charIds.map(() => '?').join(',');
  const own = db.prepare(`SELECT keys, content FROM world_entries WHERE enabled = 1 AND character_id IN (${ph})`).all(...charIds);
  let linked = [];
  try {
    linked = db.prepare(`SELECT we.keys, we.content FROM worldbook_entries we
      JOIN character_worldbooks cw ON cw.worldbook_id = we.worldbook_id
      WHERE we.enabled = 1 AND cw.character_id IN (${ph})`).all(...charIds);
  } catch { /* 极简部署可能无独立世界书表 */ }
  return [...own, ...linked];
}
// 汇总注入文本：剧情近况扫描 + 小说世界书 + 相关角色世界书，去重并截断。
function buildWorldBlock(theater, transcript, charIds) {
  const hay = transcript.slice(-12).map(m => (m.content || '')).join('\n').toLowerCase();
  const hits = [
    ...triggerEntries(cleanWorld(theater.worldbook), hay),
    ...triggerEntries(charWorldEntries(charIds), hay),
  ];
  if (!hits.length) return '';
  const seen = new Set(), uniq = [];
  for (const c of hits) { const k = c.trim(); if (k && !seen.has(k)) { seen.add(k); uniq.push(k); } }
  let block = '\n\n【世界设定（务必遵守，可自然融入叙述，但不要直接复述原文）】\n' + uniq.join('\n---\n');
  if (block.length > 4000) block = block.slice(0, 4000);
  return block;
}

// 文风白名单之外也允许自定义短语；密令与 BGM 有长度上限。
const cleanStyle = (s) => String(s || '').slice(0, 30);
const cleanDirective = (s) => String(s || '').slice(0, 1000);
const cleanStatus = (s) => (s === 'finished' ? 'finished' : 'ongoing');

router.get('/', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  let sql = `SELECT t.id, t.name, t.owner_id, t.scene, t.cover, t.is_public, t.created_at, t.style, t.status,
    u.display_name AS owner_name,
    (SELECT COUNT(*) FROM theater_members tm WHERE tm.theater_id = t.id) AS member_count,
    (SELECT COUNT(*) FROM theater_cast tc WHERE tc.theater_id = t.id) AS cast_count,
    (SELECT COUNT(*) FROM theater_messages tm2 WHERE tm2.theater_id = t.id) AS message_count,
    (SELECT MAX(tm3.created_at) FROM theater_messages tm3 WHERE tm3.theater_id = t.id) AS last_at,
    EXISTS(SELECT 1 FROM theater_members tj WHERE tj.theater_id = t.id AND tj.user_id = ?) AS joined
    FROM theaters t JOIN users u ON u.id = t.owner_id
    WHERE (t.is_public = 1 OR t.owner_id = ? OR EXISTS(
      SELECT 1 FROM theater_members tv WHERE tv.theater_id = t.id AND tv.user_id = ?
    ))`;
  const args = [req.user.id, req.user.id, req.user.id];
  if (q) { sql += ' AND (t.name LIKE ? OR t.scene LIKE ?)'; const k = `%${q}%`; args.push(k, k); }
  sql += ' ORDER BY COALESCE(last_at, t.created_at) DESC LIMIT 200';
  res.json({ theaters: db.prepare(sql).all(...args) });
});

router.post('/', authRequired, (req, res) => {
  const { name, scene, cover, cast, is_public, stage_config, worldbook, style } = req.body || {};
  if (!name) return res.status(400).json({ error: '剧场名称必填' });
  const castIds = castIdsOf(cast);
  if (!castIds.length || castIds.length !== cast.length) return res.status(400).json({ error: '登场角色列表无效' });
  const characters = db.prepare(`SELECT id, owner_id, is_public FROM characters
    WHERE id IN (${castIds.map(() => '?').join(',')})`).all(...castIds);
  if (characters.length !== castIds.length) return res.status(404).json({ error: '登场角色不存在' });
  const publicTheater = is_public !== false;
  // Public theaters may contain only public cards. A private theater may also
  // use the creator's own private cards, never another user's private card.
  if (characters.some(c => publicTheater ? !c.is_public : (!c.is_public && c.owner_id !== req.user.id))) {
    return res.status(403).json({ error: '含有私有或无权使用的登场角色' });
  }
  let tid;
  db.transaction(() => {
    const info = db.prepare('INSERT INTO theaters (name, owner_id, scene, cover, is_public, stage_config, worldbook, style) VALUES (?,?,?,?,?,?,?,?)')
      .run(String(name).slice(0, 80), req.user.id, String(scene || '').slice(0, 4000), cover || null, publicTheater ? 1 : 0,
        JSON.stringify(cleanStage(stage_config)), JSON.stringify(cleanWorld(worldbook)), cleanStyle(style));
    tid = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(tid, req.user.id);
    const add = db.prepare('INSERT INTO theater_cast (theater_id, character_id) VALUES (?,?)');
    castIds.forEach(cid => add.run(tid, cid));
    if (scene) db.prepare('INSERT INTO theater_messages (theater_id, sender_type, name, content) VALUES (?,?,?,?)')
      .run(tid, 'narrator', '旁白', String(scene).slice(0, 4000));
  }).immediate();
  res.json({ theater: db.prepare('SELECT * FROM theaters WHERE id = ?').get(tid) });
});

router.get('/:id', authRequired, (req, res) => {
  const t = db.prepare(`SELECT t.*, u.display_name AS owner_name FROM theaters t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  // 私有剧场仅 owner 与成员可见，防 IDOR。
  if (!t.is_public && t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '无权访问该剧场' });
  const cast = publicCastOf(t.id);
  const members = db.prepare(`SELECT u.id, u.display_name, u.avatar FROM theater_members tm JOIN users u ON u.id = tm.user_id WHERE tm.theater_id = ?`).all(t.id);
  const messages = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id').all(t.id);
  t.stage_config = cleanStage(t.stage_config);
  // 世界书条目与导演密令仅作者可见可编（避免泄露隐藏设定给普通读者）。
  if (t.owner_id === req.user.id) { t.worldbook = cleanWorld(t.worldbook); }
  else { t.worldbook = undefined; t.directive = undefined; }
  res.json({ theater: t, cast, members, messages, joined: memberOf(t.id, req.user.id) });
});

// 更新舞台设定（背景系统）—— 仅作者可改。也可顺带改名称 / 序章 / 封面。
router.patch('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id) return res.status(403).json({ error: '仅作者可修改舞台设定' });
  const fields = [], vals = [];
  if (req.body?.stage_config !== undefined) { fields.push('stage_config = ?'); vals.push(JSON.stringify(cleanStage(req.body.stage_config))); }
  if (req.body?.worldbook !== undefined) { fields.push('worldbook = ?'); vals.push(JSON.stringify(cleanWorld(req.body.worldbook))); }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) { fields.push('name = ?'); vals.push(req.body.name.trim().slice(0, 80)); }
  if (typeof req.body?.scene === 'string') { fields.push('scene = ?'); vals.push(req.body.scene.slice(0, 4000)); }
  if (req.body?.cover !== undefined) { fields.push('cover = ?'); vals.push(req.body.cover || null); }
  // 导演台：文风 / 密令 / 连载状态 / 背景音乐
  if (req.body?.style !== undefined) { fields.push('style = ?'); vals.push(cleanStyle(req.body.style)); }
  if (req.body?.directive !== undefined) { fields.push('directive = ?'); vals.push(cleanDirective(req.body.directive)); }
  if (req.body?.status !== undefined) { fields.push('status = ?'); vals.push(cleanStatus(req.body.status)); }
  if (req.body?.bgm !== undefined) { fields.push('bgm = ?'); vals.push(String(req.body.bgm || '').slice(0, 500)); }
  if (fields.length) { vals.push(t.id); db.prepare(`UPDATE theaters SET ${fields.join(', ')} WHERE id = ?`).run(...vals); }
  const updated = db.prepare('SELECT * FROM theaters WHERE id = ?').get(t.id);
  updated.stage_config = cleanStage(updated.stage_config);
  updated.worldbook = cleanWorld(updated.worldbook);
  res.json({ theater: updated });
});

router.post('/:id/join', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (!t.is_public && t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) {
    return res.status(403).json({ error: '私有剧场仅限受邀成员加入' });
  }
  if (!memberOf(t.id, req.user.id)) db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(t.id, req.user.id);
  res.json({ ok: true });
});

// 离开故事（此前仅 mock 有此接口，真实服务端缺失导致「离开」按钮报错）。
router.post('/:id/leave', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id === req.user.id) return res.status(400).json({ error: '作者不能离开自己的作品，可在导演台完结或删除' });
  db.prepare('DELETE FROM theater_members WHERE theater_id = ? AND user_id = ?').run(t.id, req.user.id);
  res.json({ ok: true });
});

// 删除作品（仅作者）：级联清理成员 / 阵容 / 段落（外键 ON DELETE CASCADE）。
router.delete('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id) return res.status(403).json({ error: '仅作者可删除作品' });
  db.prepare('DELETE FROM theaters WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// A human speaks — 仅成员可发言，不再自动加成员，防任意用户干扰他人剧场。
router.post('/:id/say', authRequired, aiLimiter, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  if (t.status === 'finished') return res.status(400).json({ error: '本作已完结，作者可在导演台重新开启连载' });
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const u = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(req.user.id);
  const info = db.prepare('INSERT INTO theater_messages (theater_id, sender_type, sender_id, name, avatar, content) VALUES (?,?,?,?,?,?)')
    .run(t.id, 'user', req.user.id, u.display_name, u.avatar, String(content).slice(0, 2000));
  const msg = db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid);
  pushTheaterMsg(t, msg, req.user.id);
  res.json({ message: msg });
});

// 生成一段续写（旁白 / 角色），含世界书注入。excludeId 用于「重写」时排除被替换的那段。
// 成功返回 { target, content, narrator }，失败 throw 带 code 的错误（由调用方决定状态码）。
async function runGeneration(t, settings, body, excludeId) {
  const cast = castOf(t.id);
  let transcript = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id DESC LIMIT 31').all(t.id).reverse();
  if (excludeId) transcript = transcript.filter(m => m.id !== excludeId);
  transcript = transcript.slice(-30);
  // 章节分隔在剧情日志里呈现为醒目的章节标记，让模型理解叙事节奏。
  const log = transcript.map(m => m.sender_type === 'chapter' ? `【新章节 · ${m.content}】` : `${m.name}：${m.content}`).join('\n');
  const castList = cast.map(c => `「${c.name}」(${c.tagline || '登场角色'})`).join('、');

  let target, system;
  if (body?.narrator) {
    target = { id: null, name: '旁白', avatar: null };
    system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。你是「旁白」，请用富有画面感的第三人称，推进剧情、描写环境氛围或引出转折，控制在 2-4 句话，不要替具体角色说出对白。`;
  } else {
    const c = cast.find(x => x.id === body?.character_id) || cast[0];
    if (!c) { const e = new Error('剧场没有 AI 角色'); e.code = 400; throw e; }
    target = c;
    system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。\n你现在只扮演其中的「${c.name}」。${c.persona || c.intro || ''}\n请严格以「${c.name}」的身份，根据下面的剧情进展生成一段符合人设的台词与动作（可含 *动作描写*），只说这一个角色的内容，不要替玩家或其他角色发言，控制在 1-3 句。`;
  }
  // 导演台：文风约束对所有生成生效；导演密令仅注入旁白（角色不知晓幕后安排，读者不可见）。
  if (t.style) system += `\n【文风要求】整体行文风格：${t.style}。`;
  if (t.directive && body?.narrator) system += `\n【导演密令（读者不可见，请在续写中悄然遵循，勿直接透露）】${cleanDirective(t.directive)}`;

  // 注入世界书：小说专属世界书 + 相关角色世界书（默认关键词触发）。
  // 旁白通晓全局，故扫描全体登场角色的世界书；角色发言仅注入该角色自己的世界书。
  const wbCharIds = body?.narrator ? cast.map(c => c.id) : [target.id].filter(Boolean);
  system += buildWorldBlock(t, transcript, wbCharIds);

  // SSRF 防护：剧场恒为用户自填 llm_base_url，除同步预检外必须走 safeFetch
  //（DNS 复检 + 逐跳重定向复检 + 请求头超时），防解析到内网/重定向绕过。
  assertPublicUrl(settings.llm_base_url);
  const r = await safeFetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
    body: JSON.stringify({
      model: settings.llm_model, temperature: settings.llm_temperature, max_tokens: 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请继续：` }]
    })
  }, { timeoutMs: 60000 });
  if (!r.ok) { const e = new Error('模型服务暂不可用'); e.code = 502; throw e; }
  const data = await r.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();
  if (!content) { const e = new Error('模型未返回内容'); e.code = 502; throw e; }
  return { target, content, narrator: !!body?.narrator };
}
const insertReply = (t, gen) => db.prepare('INSERT INTO theater_messages (theater_id, sender_type, sender_id, name, avatar, content) VALUES (?,?,?,?,?,?)')
  .run(t.id, gen.narrator ? 'narrator' : 'ai', gen.target.id || null, gen.target.name, gen.target.avatar, gen.content);

// Drive an AI character (or narrator) to speak. Uses the caller's LLM settings.
router.post('/:id/act', authRequired, aiLimiter, async (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  if (t.status === 'finished') return res.status(400).json({ error: '本作已完结，作者可在导演台重新开启连载' });
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!settings?.llm_api_key) return res.status(400).json({ error: '请先在设置中配置语言模型 API' });
  try {
    const gen = await runGeneration(t, settings, req.body || {});
    const info = insertReply(t, gen);
    const msg = db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid);
    pushTheaterMsg(t, msg, req.user.id);
    res.json({ message: msg });
  } catch (e) { res.status(e.status === 400 || e.code === 400 ? 400 : 502).json({ error: e.message || '模型服务暂不可用' }); }
});

// 重写最近一段 AI 续写（旁白 / 角色）：先生成新内容，成功后替换旧段，失败则保留原文。
router.post('/:id/retry', authRequired, aiLimiter, async (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  if (t.status === 'finished') return res.status(400).json({ error: '本作已完结，作者可在导演台重新开启连载' });
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!settings?.llm_api_key) return res.status(400).json({ error: '请先在设置中配置语言模型 API' });
  const last = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
  if (!last || (last.sender_type !== 'ai' && last.sender_type !== 'narrator')) return res.status(400).json({ error: '最近一段不是 AI 续写，无法重写' });
  const body = last.sender_type === 'narrator' ? { narrator: true } : { character_id: last.sender_id };
  try {
    const gen = await runGeneration(t, settings, body, last.id);
    db.prepare('DELETE FROM theater_messages WHERE id = ?').run(last.id);
    const info = insertReply(t, gen);
    const msg = db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid);
    pushTheaterMsg(t, msg, req.user.id, last.id);
    res.json({ removedId: last.id, message: msg });
  } catch (e) { res.status(e.status === 400 || e.code === 400 ? 400 : 502).json({ error: e.message || '模型服务暂不可用' }); }
});

// —— 章节分隔：作者在正文中插入一个章节标记（sender_type = 'chapter'）。
// 阅读器据此渲染装饰性分章与目录；剧情日志里呈现为【新章节】提示模型换幕。
router.post('/:id/chapter', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id) return res.status(403).json({ error: '仅作者可以分章' });
  const title = String(req.body?.title || '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: '请填写章节标题' });
  const info = db.prepare('INSERT INTO theater_messages (theater_id, sender_type, name, content) VALUES (?,?,?,?)')
    .run(t.id, 'chapter', '章节', title);
  const msg = db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid);
  pushTheaterMsg(t, msg, req.user.id);
  res.json({ message: msg });
});

// —— 命运抉择：让 AI 根据当前剧情给主角生成 3 个可选行动（不入库，选中后走 /say）。
router.post('/:id/choices', authRequired, aiLimiter, async (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  if (t.status === 'finished') return res.status(400).json({ error: '本作已完结' });
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!settings?.llm_api_key) return res.status(400).json({ error: '请先在设置中配置语言模型 API' });
  const transcript = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id DESC LIMIT 20').all(t.id).reverse();
  const log = transcript.map(m => m.sender_type === 'chapter' ? `【新章节 · ${m.content}】` : `${m.name}：${m.content}`).join('\n');
  let system = `这是一部互动小说，读者是故事的主角。场景：${t.scene || '自由发挥'}。`;
  if (t.style) system += `文风：${t.style}。`;
  system += `\n请根据剧情进展，为主角设计 3 个风格迥异、都能推动剧情的下一步行动（每个 8-24 字，第一人称视角的行动或台词，不要编号），只输出 JSON 字符串数组，例如 ["推开吱呀作响的门","质问薇尔为何隐瞒","悄悄退回阴影中"]。`;
  try {
    // 同上：用户自填地址必须走 safeFetch，防 DNS/重定向绕过同步预检。
    assertPublicUrl(settings.llm_base_url);
    const r = await safeFetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
      body: JSON.stringify({
        model: settings.llm_model, temperature: Math.min(1.2, (settings.llm_temperature || 0.8) + 0.15), max_tokens: 200,
        messages: [{ role: 'system', content: system }, { role: 'user', content: `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请给出 3 个抉择：` }]
      })
    }, { timeoutMs: 60000 });
    if (!r.ok) return res.status(502).json({ error: '模型服务暂不可用' });
    const data = await r.json();
    let raw = (data.choices?.[0]?.message?.content || '').trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) raw = fence[1].trim();
    let choices = [];
    try { const arr = JSON.parse(raw); if (Array.isArray(arr)) choices = arr; } catch { /* 走行解析回退 */ }
    if (!choices.length) choices = raw.split('\n').map(s => s.replace(/^[\s\d\-.、*"'\[\]]+|["'\],]+$/g, '').trim()).filter(Boolean);
    choices = choices.map(c => String(c).slice(0, 60)).filter(Boolean).slice(0, 3);
    if (!choices.length) return res.status(502).json({ error: '模型未返回可用抉择' });
    res.json({ choices });
  } catch { res.status(502).json({ error: '模型服务暂不可用' }); }
});

// —— 段落反应：读者对任意段落点 emoji，同一 emoji 再点一次取消。
const REACT_EMOJI = ['❤️', '🔥', '😂', '😮', '👏', '😢'];
router.post('/:id/messages/:mid/react', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (!t.is_public && t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  const msg = db.prepare('SELECT * FROM theater_messages WHERE id = ? AND theater_id = ?').get(req.params.mid, t.id);
  if (!msg) return res.status(404).json({ error: '段落不存在' });
  const emoji = String(req.body?.emoji || '');
  if (!REACT_EMOJI.includes(emoji)) return res.status(400).json({ error: '不支持的反应' });
  let map = {};
  try { map = JSON.parse(msg.reactions || '{}') || {}; } catch { map = {}; }
  const uids = Array.isArray(map[emoji]) ? map[emoji] : [];
  map[emoji] = uids.includes(req.user.id) ? uids.filter(u => u !== req.user.id) : [...uids, req.user.id];
  if (!map[emoji].length) delete map[emoji];
  db.prepare('UPDATE theater_messages SET reactions = ? WHERE id = ?').run(JSON.stringify(map), msg.id);
  res.json({ id: msg.id, reactions: map });
});

// 仅成员可拉取消息，防 IDOR 读取他人剧场历史。
router.get('/:id/messages', authRequired, (req, res) => {
  const t = db.prepare('SELECT owner_id, is_public FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(req.params.id, req.user.id) && !t.is_public) return res.status(403).json({ error: '无权访问该剧场' });
  const after = parseInt(req.query.after, 10) || 0;
  res.json({ messages: db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? AND id > ? ORDER BY id').all(req.params.id, after) });
});

export default router;
