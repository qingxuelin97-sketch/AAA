import { Router } from 'express';
import crypto from 'crypto';
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

// Split a combined "a:b" credential (Baidu APIKey:SecretKey / Volcano AppID:Token).
const splitPair = (k) => { const s = String(k || ''); const i = s.indexOf(':'); return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; };

// Tencent Cloud TC3-HMAC-SHA256 request signature (used by 腾讯云 TTS TextToVoice).
function tc3Authorization({ secretId, secretKey, service, host, action, version, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const ct = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${ct}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hashedCanonical}`;
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d, 'utf8').digest();
  const kSigning = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return { authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, ct };
}

// Resolve MiniMax pieces: root URL (no query), GroupId, bearer apiKey. GroupId may live
// in the Base URL query (?GroupId=…) or be prefixed onto the key as "GroupId:apikey".
function minimaxParts(base, key) {
  let root = base, gid = '';
  const q = base.indexOf('?');
  if (q >= 0) { const p = new URLSearchParams(base.slice(q + 1)); gid = p.get('GroupId') || p.get('group_id') || ''; root = base.slice(0, q); }
  root = root.replace(/\/$/, '');
  let apiKey = String(key || '').trim();
  if (!gid) { const c = apiKey.indexOf(':'); if (c > 0) { gid = apiKey.slice(0, c).trim(); apiKey = apiKey.slice(c + 1).trim(); } }
  return { root, gid, apiKey };
}

// Baidu access-token cache. Tokens are valid ~30 days; we refresh a day early.
const baiduTokens = new Map();
async function baiduToken(apiKey, secretKey) {
  const hit = baiduTokens.get(apiKey);
  if (hit && hit.exp > Date.now()) return hit.tok;
  const r = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`, { method: 'POST' });
  const d = await r.json().catch(() => null);
  if (!d?.access_token) throw new Error('百度语音鉴权失败：' + (d?.error_description || d?.error || '请检查 API Key / Secret Key 是否正确'));
  baiduTokens.set(apiKey, { tok: d.access_token, exp: Date.now() + (Number(d.expires_in || 2592000) - 86400) * 1000 });
  return d.access_token;
}

// Synthesize speech via the right vendor adapter. Returns { ok, contentType, buffer } or { ok:false, status, error }.
export async function synthesize({ proto, base, key, model, voice, text, speed, pitch }) {
  const b = (base || '').replace(/\/$/, '');
  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1)); // shared playback-rate tuning
  const pit = Math.min(1.5, Math.max(0.5, Number(pitch) || 1)); // shared pitch tuning (1 = natural)
  const pitPct = Math.round((pit - 1) * 100);                   // SSML pitch as +/-N%
  const pitSemi = Math.max(-12, Math.min(12, Math.round((pit - 1) * 24))); // semitone-based vendors
  try {
    if (proto === 'baidu') {
      // Baidu 智能云 短文本在线合成: OAuth token from APIKey:SecretKey, then POST form to /text2audio.
      const [ak, sk] = splitPair(key);
      if (!ak || !sk) return { ok: false, status: 400, error: '百度语音需在 API Key 处填「API Key:Secret Key」（用英文冒号分隔）' };
      let tok; try { tok = await baiduToken(ak, sk); } catch (e) { return { ok: false, status: 502, error: e.message }; }
      const spd = Math.max(0, Math.min(15, Math.round(rate * 5)));   // 语速 0-15（默认 5 ≈ 1×）
      const pitB = Math.max(0, Math.min(15, Math.round(pit * 5)));   // 音调 0-15（默认 5 ≈ 1×）
      const form = new URLSearchParams({ tok, tex: text, cuid: 'huanyu', ctp: '1', lan: 'zh', spd: String(spd), pit: String(pitB), vol: '5', per: String(voice || '0'), aue: '3' });
      const r = await fetch(`${b || 'https://tsn.baidu.com'}/text2audio`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.includes('json')) { const t = await r.text().catch(() => ''); return { ok: false, status: 502, error: `百度语音失败：${t.slice(0, 200)}` }; }
      return { ok: true, contentType: ct.includes('audio') ? ct : 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'volcano') {
      // 火山引擎语音合成: AppID:AccessToken, cluster=model, voice_type=voice. Auth header uses "Bearer;".
      const [appid, vtok] = splitPair(key);
      if (!appid || !vtok) return { ok: false, status: 400, error: '火山语音需在 API Key 处填「AppID:AccessToken」（用英文冒号分隔）' };
      const cluster = model || 'volcano_tts';
      const reqid = (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      const r = await fetch(`${b || 'https://openspeech.bytedance.com'}/api/v1/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer;${vtok}` },
        body: JSON.stringify({ app: { appid, token: vtok, cluster }, user: { uid: 'huanyu' }, audio: { voice_type: voice || 'BV001_streaming', encoding: 'mp3', speed_ratio: rate, volume_ratio: 1, pitch_ratio: pit }, request: { reqid, text, operation: 'query' } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null);
      if (d?.code !== 3000 || !d?.data) return { ok: false, status: 502, error: '火山语音失败：' + (d?.message || JSON.stringify(d || {}).slice(0, 200)) };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(d.data, 'base64') };
    }
    if (proto === 'tencent') {
      // 腾讯云语音合成 TextToVoice: TC3 签名, SecretId:SecretKey, voice=VoiceType, model=地域(Region).
      const [secretId, secretKey] = splitPair(key);
      if (!secretId || !secretKey) return { ok: false, status: 400, error: '腾讯云语音需在 API Key 处填「SecretId:SecretKey」（用英文冒号分隔）' };
      const host = (b || 'https://tts.tencentcloudapi.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const region = model || 'ap-guangzhou';
      const tcSpeed = Math.max(-2, Math.min(6, Number(((rate - 1) * 2).toFixed(2)))); // 0=正常, 区间 [-2,6]
      const payload = JSON.stringify({ Text: text, SessionId: (globalThis.crypto?.randomUUID?.() || ('s' + Date.now())), Volume: 0, Speed: tcSpeed, ModelType: 1, VoiceType: Number(voice) || 101001, PrimaryLanguage: 1, SampleRate: 16000, Codec: 'mp3' });
      const timestamp = Math.floor(Date.now() / 1000);
      const { authorization, ct } = tc3Authorization({ secretId, secretKey, service: 'tts', host, action: 'TextToVoice', version: '2019-08-23', payload, timestamp });
      const r = await fetch(`https://${host}/`, { method: 'POST', headers: { 'Content-Type': ct, Host: host, Authorization: authorization, 'X-TC-Action': 'TextToVoice', 'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2019-08-23', 'X-TC-Region': region }, body: payload });
      const d = await r.json().catch(() => null);
      const resp = d?.Response;
      if (!resp || resp.Error) return { ok: false, status: 502, error: '腾讯云语音失败：' + (resp?.Error?.Message || JSON.stringify(d || {}).slice(0, 200)) };
      if (!resp.Audio) return { ok: false, status: 502, error: '腾讯云语音未返回音频' };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(resp.Audio, 'base64') };
    }
    if (proto === 'elevenlabs') {
      const r = await fetch(`${b}/text-to-speech/${encodeURIComponent(voice || '21m00Tcm4TlvDq8ikWAM')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model || 'eleven_multilingual_v2' }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'minimax') {
      // MiniMax T2A v2: GroupId is a query param on the *request* URL (after the path),
      // the API key is the bearer. Accept GroupId from the Base URL query (?GroupId=…)
      // or appended to the key as "GroupId:apikey"; rebuild the URL so /t2a_v2 stays a path.
      const mm = minimaxParts(b, key);
      if (!mm.gid) return { ok: false, status: 400, error: 'MiniMax 缺少 GroupId：请在 Base URL 后附 ?GroupId=你的GroupId（或在密钥处填「GroupId:APIKey」）' };
      const r = await fetch(`${mm.root}/t2a_v2?GroupId=${encodeURIComponent(mm.gid)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mm.apiKey}` },
        body: JSON.stringify({ model: model || 'speech-01-turbo', text, stream: false, voice_setting: { voice_id: voice || 'male-qn-qingse', speed: rate, vol: 1, pitch: pitSemi }, audio_setting: { format: 'mp3', sample_rate: 32000 } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null); const hex = d?.data?.audio;
      if (!hex) return { ok: false, status: 502, error: 'MiniMax 未返回音频：' + (d?.base_resp?.status_msg || JSON.stringify(d || {}).slice(0, 200)) + '（请检查 GroupId / APIKey / 音色是否匹配）' };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(hex, 'hex') };
    }
    if (proto === 'aliyun') {
      // Aliyun Bailian / DashScope Qwen-TTS — single key, synchronous HTTP, returns
      // an audio URL we then fetch. base default https://dashscope.aliyuncs.com
      const url = `${b}/api/v1/services/aigc/multimodal-generation/generation`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: model || 'qwen-tts', input: { text, voice: voice || 'Cherry' } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null);
      const au = d?.output?.audio || {};
      if (au.url) {
        const ar = await fetch(au.url);
        if (!ar.ok) return { ok: false, status: 502, error: '语音音频下载失败' };
        return { ok: true, contentType: ar.headers.get('content-type') || 'audio/wav', buffer: Buffer.from(await ar.arrayBuffer()) };
      }
      if (au.data) return { ok: true, contentType: 'audio/wav', buffer: Buffer.from(au.data, 'base64') };
      return { ok: false, status: 502, error: '语音服务未返回音频：' + JSON.stringify(d?.output || d?.message || d).slice(0, 200) };
    }
    if (proto === 'azure') {
      const rPct = Math.round((rate - 1) * 100); // SSML prosody rate as +/-N%
      const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${voice || 'zh-CN-XiaoxiaoNeural'}'><prosody rate='${rPct >= 0 ? '+' : ''}${rPct}%' pitch='${pitPct >= 0 ? '+' : ''}${pitPct}%'>${text.replace(/[<&>]/g, '')}</prosody></voice></speak>`;
      const r = await fetch(`${b}/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' }, body: ssml });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'google') {
      const sep = b.includes('?') ? '&' : '?';
      const r = await fetch(`${b}/v1/text:synthesize${sep}key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: (voice || 'cmn-CN-Wavenet-A').split('-').slice(0, 2).join('-') || 'cmn-CN', name: voice || 'cmn-CN-Wavenet-A' }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate, pitch: pitSemi } }) });
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
      body: JSON.stringify({ model, input: text, voice, speed: rate }) });
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

const parseMem = (conv) => { try { conv.memories = JSON.parse(conv.memories || '[]'); } catch { conv.memories = []; } return conv; };
const withWorld = (c) => { if (c) c.world = db.prepare('SELECT * FROM world_entries WHERE character_id = ? ORDER BY position, id').all(c.id); return c; };

router.get('/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = withWorld(db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id));
  const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  res.json({ conversation: parseMem(conv), character, messages });
});

router.patch('/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  if (typeof req.body?.title === 'string' && req.body.title.trim()) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(req.body.title.trim().slice(0, 60), conv.id);
  if (req.body?.clear) {
    const ch = db.prepare('SELECT greeting FROM characters WHERE id = ?').get(conv.character_id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
    if (ch?.greeting) db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', ch.greeting);
    db.prepare('UPDATE conversations SET affinity = 0 WHERE id = ?').run(conv.id);
  }
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
  const updated = parseMem(db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id));
  res.json({ conversation: updated, messages: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id) });
});

router.delete('/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
  res.json({ ok: true });
});

// ---- memories ----
const ownConv = (req, res) => { const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id); if (!conv || conv.user_id !== req.user.id) { res.status(403).json({ error: '无权访问' }); return null; } return conv; };
router.post('/conversations/:id/memories', authRequired, (req, res) => {
  const conv = ownConv(req, res); if (!conv) return;
  const text = String(req.body?.content || '').trim(); if (!text) return res.status(400).json({ error: '记忆内容不能为空' });
  let mem = []; try { mem = JSON.parse(conv.memories || '[]'); } catch { /* */ }
  const mid = mem.reduce((mx, x) => Math.max(mx, x.id || 0), 0) + 1;
  mem.push({ id: mid, content: text.slice(0, 300) });
  db.prepare('UPDATE conversations SET memories = ? WHERE id = ?').run(JSON.stringify(mem), conv.id);
  res.json({ memories: mem });
});
router.delete('/conversations/:id/memories/:mid', authRequired, (req, res) => {
  const conv = ownConv(req, res); if (!conv) return;
  let mem = []; try { mem = JSON.parse(conv.memories || '[]'); } catch { /* */ }
  mem = mem.filter(x => x.id !== +req.params.mid);
  db.prepare('UPDATE conversations SET memories = ? WHERE id = ?').run(JSON.stringify(mem), conv.id);
  res.json({ memories: mem });
});

// ---- message edit / delete / react ----
router.patch('/conversations/:id/messages/:mid', authRequired, (req, res) => {
  const conv = ownConv(req, res); if (!conv) return;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(req.params.mid, conv.id);
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  const c = String(req.body?.content || '').trim(); if (!c) return res.status(400).json({ error: '内容不能为空' });
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(c, msg.id);
  res.json({ message: { ...msg, content: c } });
});
router.delete('/conversations/:id/messages/:mid', authRequired, (req, res) => {
  const conv = ownConv(req, res); if (!conv) return;
  db.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?').run(req.params.mid, conv.id);
  res.json({ ok: true });
});
router.post('/conversations/:id/messages/:mid/react', authRequired, (req, res) => {
  const conv = ownConv(req, res); if (!conv) return;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(req.params.mid, conv.id);
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  const r = String(req.body?.reaction || '').slice(0, 8);
  const next = msg.reaction === r ? '' : r;
  db.prepare('UPDATE messages SET reaction = ? WHERE id = ?').run(next, msg.id);
  res.json({ message: { ...msg, reaction: next } });
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
      // 仅在服务端日志记录上游详情，对客户端只返回通用提示，避免泄露内部信息
      console.error('[chat] 上游模型服务错误', upstream.status, text.slice(0, 300));
      res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用，请稍后再试' })}\n\n`);
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
    console.error('[chat] 连接模型服务失败', err.message);
    res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用，请稍后再试' })}\n\n`);
  }
  if (full.trim()) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', full.trim());
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    if (userContent) { try { db.prepare('UPDATE conversations SET affinity = COALESCE(affinity,0) + 3 WHERE id = ?').run(conv.id); } catch { /* */ } }
    // Deduct the platform fee only after a successful reply (no charge on failure).
    if (feeDue) { try { const w = applyTx(me.id, { kind: 'ai_fee', gold: -feeDue, memo: `平台 AI · 对话《${character?.name || ''}》`, ref_owner: character?.owner_id }); sse({ fee: feeDue, balance: w.gold }); } catch { /* */ } }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

// ---- Text to speech proxy ----
router.post('/tts', authRequired, async (req, res) => {
  const settings = getSettings(req.user.id);
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  const { text: rawText, voice: reqVoice, speed: reqSpeed, pitch: reqPitch, character_id } = req.body || {};
  if (!rawText) return res.status(400).json({ error: '缺少文本' });
  const text = String(rawText).slice(0, 4000);
  const speed = reqSpeed != null ? Math.min(2, Math.max(0.5, Number(reqSpeed) || 1)) : 1;
  const pitch = reqPitch != null ? Math.min(1.5, Math.max(0.5, Number(reqPitch) || 1)) : 1;
  const ttsRefOwner = character_id ? db.prepare('SELECT owner_id FROM characters WHERE id = ?').get(character_id)?.owner_id : null;

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

  const out = await synthesize({ proto, base, key, model, voice, text, speed, pitch });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  if (fee) {
    try { const w = applyTx(me.id, { kind: 'voice_fee', gold: -fee, memo: `平台语音 · ${text.slice(0, 16)}`, ref_owner: ttsRefOwner }); res.setHeader('X-Gold-Fee', String(fee)); res.setHeader('X-Gold-Balance', String(w.gold)); }
    catch (e) { return res.status(402).json({ error: e.message }); }
  }
  res.setHeader('Content-Type', out.contentType);
  res.send(out.buffer);
});

export default router;
