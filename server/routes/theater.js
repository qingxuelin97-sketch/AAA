import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { assertPublicUrl } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';

const router = Router();
const memberOf = (tid, uid) => !!db.prepare('SELECT 1 FROM theater_members WHERE theater_id = ? AND user_id = ?').get(tid, uid);

function castOf(tid) {
  return db.prepare(`SELECT c.* FROM theater_cast tc JOIN characters c ON c.id = tc.character_id WHERE tc.theater_id = ?`).all(tid);
}

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

router.get('/', authRequired, (req, res) => {
  const theaters = db.prepare(`SELECT t.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM theater_members tm WHERE tm.theater_id = t.id) AS member_count,
    (SELECT COUNT(*) FROM theater_cast tc WHERE tc.theater_id = t.id) AS cast_count
    FROM theaters t JOIN users u ON u.id = t.owner_id
    WHERE t.is_public = 1 OR t.owner_id = ? ORDER BY t.created_at DESC`).all(req.user.id);
  res.json({ theaters });
});

router.post('/', authRequired, (req, res) => {
  const { name, scene, cover, cast, is_public, stage_config, worldbook } = req.body || {};
  if (!name) return res.status(400).json({ error: '剧场名称必填' });
  if (!Array.isArray(cast) || cast.length === 0) return res.status(400).json({ error: '请至少选择一位 AI 角色登场' });
  const info = db.prepare('INSERT INTO theaters (name, owner_id, scene, cover, is_public, stage_config, worldbook) VALUES (?,?,?,?,?,?,?)')
    .run(name, req.user.id, scene || '', cover || null, is_public === false ? 0 : 1, JSON.stringify(cleanStage(stage_config)), JSON.stringify(cleanWorld(worldbook)));
  const tid = info.lastInsertRowid;
  db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(tid, req.user.id);
  const add = db.prepare('INSERT OR IGNORE INTO theater_cast (theater_id, character_id) VALUES (?,?)');
  cast.forEach(cid => add.run(tid, cid));
  if (scene) db.prepare('INSERT INTO theater_messages (theater_id, sender_type, name, content) VALUES (?,?,?,?)').run(tid, 'narrator', '旁白', scene);
  res.json({ theater: db.prepare('SELECT * FROM theaters WHERE id = ?').get(tid) });
});

router.get('/:id', authRequired, (req, res) => {
  const t = db.prepare(`SELECT t.*, u.display_name AS owner_name FROM theaters t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  // 私有剧场仅 owner 与成员可见，防 IDOR。
  if (!t.is_public && t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '无权访问该剧场' });
  const cast = castOf(t.id);
  const members = db.prepare(`SELECT u.id, u.display_name, u.avatar FROM theater_members tm JOIN users u ON u.id = tm.user_id WHERE tm.theater_id = ?`).all(t.id);
  const messages = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id').all(t.id);
  t.stage_config = cleanStage(t.stage_config);
  // 世界书条目仅作者可见可编（避免泄露隐藏设定给普通读者）。
  t.worldbook = (t.owner_id === req.user.id) ? cleanWorld(t.worldbook) : undefined;
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
  if (fields.length) { vals.push(t.id); db.prepare(`UPDATE theaters SET ${fields.join(', ')} WHERE id = ?`).run(...vals); }
  const updated = db.prepare('SELECT * FROM theaters WHERE id = ?').get(t.id);
  updated.stage_config = cleanStage(updated.stage_config);
  updated.worldbook = cleanWorld(updated.worldbook);
  res.json({ theater: updated });
});

router.post('/:id/join', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (!memberOf(t.id, req.user.id)) db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(t.id, req.user.id);
  res.json({ ok: true });
});

// A human speaks — 仅成员可发言，不再自动加成员，防任意用户干扰他人剧场。
router.post('/:id/say', authRequired, aiLimiter, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const u = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(req.user.id);
  const info = db.prepare('INSERT INTO theater_messages (theater_id, sender_type, sender_id, name, avatar, content) VALUES (?,?,?,?,?,?)')
    .run(t.id, 'user', req.user.id, u.display_name, u.avatar, String(content).slice(0, 2000));
  res.json({ message: db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid) });
});

// Drive an AI character (or narrator) to speak. Uses the caller's LLM settings.
router.post('/:id/act', authRequired, aiLimiter, async (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (t.owner_id !== req.user.id && !memberOf(t.id, req.user.id)) return res.status(403).json({ error: '请先加入该剧场' });
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!settings?.llm_api_key) return res.status(400).json({ error: '请先在设置中配置语言模型 API' });

  const cast = castOf(t.id);
  const transcript = db.prepare('SELECT * FROM theater_messages WHERE theater_id = ? ORDER BY id DESC LIMIT 30').all(t.id).reverse();
  const log = transcript.map(m => `${m.name}：${m.content}`).join('\n');
  const castList = cast.map(c => `「${c.name}」(${c.tagline || '登场角色'})`).join('、');

  let target, system;
  if (req.body?.narrator) {
    target = { name: '旁白', avatar: null, persona: '' };
    system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。你是「旁白」，请用富有画面感的第三人称，推进剧情、描写环境氛围或引出转折，控制在 2-4 句话，不要替具体角色说出对白。`;
  } else {
    const c = cast.find(x => x.id === req.body?.character_id) || cast[0];
    if (!c) return res.status(400).json({ error: '剧场没有 AI 角色' });
    target = c;
    system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。\n你现在只扮演其中的「${c.name}」。${c.persona || c.intro || ''}\n请严格以「${c.name}」的身份，根据下面的剧情进展生成一段符合人设的台词与动作（可含 *动作描写*），只说这一个角色的内容，不要替玩家或其他角色发言，控制在 1-3 句。`;
  }

  // 注入世界书：小说专属世界书 + 相关角色世界书（默认关键词触发）。
  // 旁白通晓全局，故扫描全体登场角色的世界书；角色发言仅注入该角色自己的世界书。
  const wbCharIds = req.body?.narrator ? cast.map(c => c.id) : [target.id].filter(Boolean);
  system += buildWorldBlock(t, transcript, wbCharIds);

  // SSRF 防护：发起 fetch 前校验用户配置的 llm_base_url 不指向内网/本机。
  assertPublicUrl(settings.llm_base_url);
  try {
    const r = await fetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
      body: JSON.stringify({
        model: settings.llm_model, temperature: settings.llm_temperature, max_tokens: 400,
        messages: [{ role: 'system', content: system }, { role: 'user', content: `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请继续：` }]
      })
    });
    if (!r.ok) { return res.status(502).json({ error: '模型服务暂不可用' }); }
    const data = await r.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (!content) return res.status(502).json({ error: '模型未返回内容' });
    const info = db.prepare('INSERT INTO theater_messages (theater_id, sender_type, sender_id, name, avatar, content) VALUES (?,?,?,?,?,?)')
      .run(t.id, req.body?.narrator ? 'narrator' : 'ai', target.id || null, target.name, target.avatar, content);
    res.json({ message: db.prepare('SELECT * FROM theater_messages WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) { res.status(502).json({ error: '模型服务暂不可用' }); }
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
