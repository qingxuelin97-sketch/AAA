import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx } from '../wallet.js';
import { getPlatform, voiceReady, featureFee, platformFee, VOICE_FEE } from '../platform.js';
import { bumpDaily } from '../daily.js';

const router = Router();

function getSettings(userId) {
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
}

// Resolve which LLM creds a request uses: the user's own key (free) takes priority,
// otherwise fall back to the platform language service (billed per reply).
function effectiveLLM(settings) {
  if (settings?.llm_api_key) {
    return { base_url: settings.llm_base_url, api_key: settings.llm_api_key, model: settings.llm_model,
      temperature: settings.llm_temperature, max_tokens: settings.llm_max_tokens, system_prompt: '', platform: false };
  }
  const p = getPlatform();
  if (p.key && p.base_url) {
    return { base_url: p.base_url, api_key: p.key, model: p.model,
      temperature: settings?.llm_temperature ?? 0.8, max_tokens: settings?.llm_max_tokens || 1024,
      system_prompt: p.system_prompt || '', platform: true };
  }
  return null;
}

// Synthesize speech via the right vendor adapter. Returns { ok, contentType, buffer } or { ok:false, status, error }.
async function synthesize({ proto, base, key, model, voice, text }) {
  const b = (base || '').replace(/\/$/, '');
  try {
    if (proto === 'elevenlabs') {
      const r = await fetch(`${b}/text-to-speech/${encodeURIComponent(voice || '21m00Tcm4TlvDq8ikWAM')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model || 'eleven_multilingual_v2' }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'minimax') {
      const r = await fetch(`${b}/t2a_v2`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: model || 'speech-01-turbo', text, stream: false, voice_setting: { voice_id: voice || 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: 'mp3', sample_rate: 32000 } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null); const hex = d?.data?.audio;
      if (!hex) return { ok: false, status: 502, error: '语音服务未返回音频（MiniMax 需在 Base URL 后附 ?GroupId=）' };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(hex, 'hex') };
    }
    if (proto === 'azure') {
      const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${voice || 'zh-CN-XiaoxiaoNeural'}'>${text.replace(/[<&>]/g, '')}</voice></speak>`;
      const r = await fetch(`${b}/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' }, body: ssml });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'google') {
      const sep = b.includes('?') ? '&' : '?';
      const r = await fetch(`${b}/v1/text:synthesize${sep}key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: (voice || 'cmn-CN-Wavenet-A').split('-').slice(0, 2).join('-') || 'cmn-CN', name: voice || 'cmn-CN-Wavenet-A' }, audioConfig: { audioEncoding: 'MP3' } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null);
      if (!d?.audioContent) return { ok: false, status: 502, error: '语音服务未返回音频' };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(d.audioContent, 'base64') };
    }
    if (proto === 'deepgram') {
      const r = await fetch(`${b}/v1/speak?model=${encodeURIComponent(model || 'aura-asteria-en')}`, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    // OpenAI-compatible /audio/speech
    const r = await fetch(b + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: text, voice }) });
    if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true, contentType: r.headers.get('content-type') || 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { ok: false, status: 502, error: '语音服务连接失败：' + e.message }; }
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
  bumpDaily(req.user.id, 'chat');
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

  const userContent = (req.body?.content || '').trim();
  if (userContent) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'user', userContent);
  }
  await streamReply(res, conv, character, settings, userContent);
});

// Regenerate: drop the trailing assistant message, then produce a fresh reply.
router.post('/conversations/:id/regenerate', authRequired, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const settings = getSettings(req.user.id);
  const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id);
  if (last && last.role === 'assistant') db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
  await streamReply(res, conv, character, settings, '');
});

// Shared SSE streaming of a model reply; persists the assistant message.
async function streamReply(res, conv, character, settings, userContent) {
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(conv.user_id);
  const eff = effectiveLLM(settings);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  if (!eff) { sse({ error: '尚未配置语言模型 API，且平台服务未开启。请前往「设置 → 语言模型」填写 API Key。' }); sse('[DONE]'); return res.end(); }

  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  // Platform service is billed per reply — verify balance up-front, deduct only on success.
  let feeDue = 0;
  if (eff.platform) {
    feeDue = platformFee(me, history.length);
    if (me.gold < feeDue) { sse({ error: `金币不足，本次平台 AI 服务需 ${feeDue} 金币（当前 ${me.gold}）。可前往钱包签到/兑换，或在设置中填写自己的 API。` }); sse('[DONE]'); return res.end(); }
  }
  const recentText = history.slice(-6).map(m => m.content).join(' ');
  let system = buildSystemPrompt(character, recentText + ' ' + userContent);
  if (eff.platform && eff.system_prompt.trim()) system = eff.system_prompt.trim() + '\n\n' + system;
  const payloadMessages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];

  let full = '';
  try {
    const upstream = await fetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
      body: JSON.stringify({
        model: eff.model, messages: payloadMessages,
        temperature: eff.temperature, max_tokens: eff.max_tokens, stream: true
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
          if (delta) { full += delta; res.write(`data: ${JSON.stringify({ delta })}\n\n`); }
        } catch { /* partial chunk */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: '连接模型服务失败：' + err.message })}\n\n`);
  }
  if (full.trim()) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', full.trim());
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    // Deduct the platform fee only after a successful reply (no charge on failure).
    if (feeDue) { try { const w = applyTx(me.id, { kind: 'ai_fee', gold: -feeDue, memo: `平台 AI · 对话《${character?.name || ''}》` }); sse({ fee: feeDue, balance: w.gold }); } catch { /* */ } }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

// ---- Text to speech proxy ----
router.post('/tts', authRequired, async (req, res) => {
  const settings = getSettings(req.user.id);
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  const { text: rawText, voice: reqVoice } = req.body || {};
  if (!rawText) return res.status(400).json({ error: '缺少文本' });
  const text = String(rawText).slice(0, 4000);

  // Own voice API (free) takes priority; otherwise fall back to the platform service, billed per sentence.
  let proto, base, key, model, voice, fee = 0;
  if (settings?.voice_api_key) {
    proto = settings.voice_protocol || 'openai'; base = settings.voice_base_url; key = settings.voice_api_key;
    model = settings.voice_model; voice = reqVoice || settings.voice_name;
  } else if (voiceReady()) {
    const pv = getPlatform().voice; proto = pv.protocol || 'openai'; base = pv.base_url; key = pv.key; model = pv.model; voice = reqVoice || pv.voice_name;
    fee = featureFee(me, VOICE_FEE);
    if (me.gold < fee) return res.status(402).json({ error: `金币不足，平台语音每句需 ${fee} 金币（当前 ${me.gold}）。可在「设置 → 语音模型」填写自己的语音 API 免费朗读。` });
  } else {
    return res.status(503).json({ error: '尚未配置语音模型 API，且平台语音服务暂未开启。' });
  }

  const out = await synthesize({ proto, base, key, model, voice, text });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  if (fee) {
    try { const w = applyTx(me.id, { kind: 'voice_fee', gold: -fee, memo: `平台语音 · ${text.slice(0, 16)}` }); res.setHeader('X-Gold-Fee', String(fee)); res.setHeader('X-Gold-Balance', String(w.gold)); }
    catch (e) { return res.status(402).json({ error: e.message }); }
  }
  res.setHeader('Content-Type', out.contentType);
  res.send(out.buffer);
});

export default router;
