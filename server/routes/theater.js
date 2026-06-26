import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
const memberOf = (tid, uid) => !!db.prepare('SELECT 1 FROM theater_members WHERE theater_id = ? AND user_id = ?').get(tid, uid);

function castOf(tid) {
  return db.prepare(`SELECT c.* FROM theater_cast tc JOIN characters c ON c.id = tc.character_id WHERE tc.theater_id = ?`).all(tid);
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
  const { name, scene, cover, cast, is_public } = req.body || {};
  if (!name) return res.status(400).json({ error: '剧场名称必填' });
  if (!Array.isArray(cast) || cast.length === 0) return res.status(400).json({ error: '请至少选择一位 AI 角色登场' });
  const info = db.prepare('INSERT INTO theaters (name, owner_id, scene, cover, is_public) VALUES (?,?,?,?,?)')
    .run(name, req.user.id, scene || '', cover || null, is_public === false ? 0 : 1);
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
  res.json({ theater: t, cast, members, messages, joined: memberOf(t.id, req.user.id) });
});

router.post('/:id/join', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '剧场不存在' });
  if (!memberOf(t.id, req.user.id)) db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(t.id, req.user.id);
  res.json({ ok: true });
});

// A human speaks — 仅成员可发言，不再自动加成员，防任意用户干扰他人剧场。
router.post('/:id/say', authRequired, (req, res) => {
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
router.post('/:id/act', authRequired, async (req, res) => {
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
