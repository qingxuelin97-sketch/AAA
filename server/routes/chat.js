import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

function getSettings(userId) {
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
}

// Build the system prompt from persona, intro and triggered world-book entries.
function buildSystemPrompt(character, recentText) {
  const parts = [];
  if (character.persona) parts.push(character.persona.trim());
  if (character.intro) parts.push(`【角色简介】\n${character.intro.trim()}`);

  const world = db.prepare('SELECT * FROM world_entries WHERE character_id = ? AND enabled = 1 ORDER BY position, id').all(character.id);
  const triggered = [];
  const haystack = (recentText || '').toLowerCase();
  for (const w of world) {
    const keys = (w.keys || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const always = keys.length === 0; // no keys => always-on lore
    if (always || keys.some(k => haystack.includes(k))) triggered.push(w.content);
  }
  if (triggered.length) parts.push('【世界书 / 设定】\n' + triggered.join('\n---\n'));
  parts.push(`你正在扮演「${character.name}」。请始终保持角色设定，使用沉浸式的第一人称叙述，不要跳出角色，不要提及你是 AI。`);
  return parts.join('\n\n');
}

// ---- Conversations ----
router.get('/conversations', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT cv.*, c.name AS character_name, c.avatar AS character_avatar
    FROM conversations cv JOIN characters c ON c.id = cv.character_id
    WHERE cv.user_id = ? ORDER BY cv.updated_at DESC`).all(req.user.id);
  res.json({ conversations: rows });
});

router.post('/conversations', authRequired, (req, res) => {
  const { character_id } = req.body || {};
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(character_id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  if (!c.is_public && c.owner_id !== req.user.id) return res.status(403).json({ error: '无权使用该角色' });
  const info = db.prepare('INSERT INTO conversations (user_id, character_id, title) VALUES (?,?,?)')
    .run(req.user.id, character_id, c.name);
  db.prepare('UPDATE characters SET uses = uses + 1 WHERE id = ?').run(character_id);
  if (c.greeting) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)')
      .run(info.lastInsertRowid, 'assistant', c.greeting);
  }
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  res.json({ conversation: conv });
});

router.get('/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  res.json({ conversation: conv, character, messages });
});

router.delete('/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
  res.json({ ok: true });
});

// ---- Streaming completion ----
router.post('/conversations/:id/complete', authRequired, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const settings = getSettings(req.user.id);
  if (!settings?.llm_api_key) {
    return res.status(400).json({ error: '尚未配置语言模型 API。请前往「设置」填写 API Key。' });
  }

  const userContent = (req.body?.content || '').trim();
  if (userContent) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'user', userContent);
  }

  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  const recentText = history.slice(-6).map(m => m.content).join(' ');
  const system = buildSystemPrompt(character, recentText + ' ' + userContent);
  const payloadMessages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let full = '';
  try {
    const upstream = await fetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
      body: JSON.stringify({
        model: settings.llm_model,
        messages: payloadMessages,
        temperature: settings.llm_temperature,
        max_tokens: settings.llm_max_tokens,
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `模型服务返回 ${upstream.status}：${text.slice(0, 300)}` })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch { /* partial chunk, ignore */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: '连接模型服务失败：' + err.message })}\n\n`);
  }

  if (full.trim()) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', full.trim());
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// ---- Text to speech proxy ----
router.post('/tts', authRequired, async (req, res) => {
  const settings = getSettings(req.user.id);
  if (!settings?.voice_api_key) return res.status(400).json({ error: '尚未配置语音模型 API' });
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: '缺少文本' });
  try {
    const upstream = await fetch(settings.voice_base_url.replace(/\/$/, '') + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.voice_api_key}` },
      body: JSON.stringify({ model: settings.voice_model, input: text.slice(0, 4000), voice: voice || settings.voice_name })
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      return res.status(502).json({ error: `语音服务返回 ${upstream.status}：${t.slice(0, 200)}` });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: '语音服务连接失败：' + err.message });
  }
});

export default router;
