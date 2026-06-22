import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { isVip } from '../wallet.js';
import { getPlatform, voiceReady, imageReady, featureFee, platformFee, memberDiscount, VOICE_FEE, IMAGE_FEE, PLATFORM_FEE } from '../platform.js';

const router = Router();

const PUBLIC_FIELDS = [
  'llm_provider', 'llm_protocol', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens',
  'voice_provider', 'voice_protocol', 'voice_base_url', 'voice_model', 'voice_name', 'theme', 'nsfw', 'notify_email',
  'privacy_profile', 'allow_dm', 'show_online', 'discoverable', 'activity_visible', 'leaderboard_visible', 'read_receipts', 'personalize',
];

function publicSettings(row, me) {
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f];
  out.llm_api_key_set = !!row.llm_api_key;
  out.voice_api_key_set = !!row.voice_api_key;
  const usingPlatform = !row.llm_api_key;
  const usingPlatformVoice = !row.voice_api_key && voiceReady();
  out.using_platform = usingPlatform;
  out.platform_fee = usingPlatform ? { base: platformFee(me, 0), heavy: platformFee(me, PLATFORM_FEE.heavy_threshold + 1), heavy_threshold: PLATFORM_FEE.heavy_threshold, discount: memberDiscount(me) } : null;
  out.using_platform_voice = usingPlatformVoice;
  out.voice_fee = usingPlatformVoice ? { per: featureFee(me, VOICE_FEE), base: VOICE_FEE, discount: memberDiscount(me) } : null;
  out.image_fee = { per: featureFee(me, IMAGE_FEE), base: IMAGE_FEE, discount: memberDiscount(me), ready: imageReady() };
  return out;
}

router.get('/', authRequired, (req, res) => {
  let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!row) { db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.user.id); row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id); }
  res.json({ settings: publicSettings(row, req.user) });
});

router.put('/', authRequired, (req, res) => {
  const b = req.body || {};
  let cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!cur) { db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.user.id); cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id); }
  const str = (k) => (typeof b[k] === 'string' ? b[k] : cur[k]);
  const bool = (k) => (b[k] === undefined ? cur[k] : (b[k] ? 1 : 0));
  const next = {
    user_id: req.user.id,
    llm_provider: str('llm_provider'), llm_protocol: str('llm_protocol'), llm_base_url: str('llm_base_url'),
    llm_api_key: (b.llm_api_key === undefined || b.llm_api_key === '') ? cur.llm_api_key : b.llm_api_key,
    llm_model: str('llm_model'), llm_temperature: b.llm_temperature ?? cur.llm_temperature, llm_max_tokens: b.llm_max_tokens ?? cur.llm_max_tokens,
    voice_provider: str('voice_provider'), voice_protocol: str('voice_protocol'), voice_base_url: str('voice_base_url'),
    voice_api_key: (b.voice_api_key === undefined || b.voice_api_key === '') ? cur.voice_api_key : b.voice_api_key,
    voice_model: str('voice_model'), voice_name: str('voice_name'), theme: str('theme'),
    nsfw: bool('nsfw'), notify_email: bool('notify_email'),
    privacy_profile: typeof b.privacy_profile === 'string' ? b.privacy_profile : cur.privacy_profile,
    allow_dm: typeof b.allow_dm === 'string' ? b.allow_dm : cur.allow_dm,
    show_online: bool('show_online'), discoverable: bool('discoverable'), activity_visible: bool('activity_visible'),
    leaderboard_visible: bool('leaderboard_visible'), read_receipts: bool('read_receipts'), personalize: bool('personalize'),
  };
  db.prepare(`UPDATE settings SET
    llm_provider=@llm_provider, llm_protocol=@llm_protocol, llm_base_url=@llm_base_url, llm_api_key=@llm_api_key, llm_model=@llm_model,
    llm_temperature=@llm_temperature, llm_max_tokens=@llm_max_tokens,
    voice_provider=@voice_provider, voice_protocol=@voice_protocol, voice_base_url=@voice_base_url, voice_api_key=@voice_api_key,
    voice_model=@voice_model, voice_name=@voice_name, theme=@theme, nsfw=@nsfw, notify_email=@notify_email,
    privacy_profile=@privacy_profile, allow_dm=@allow_dm, show_online=@show_online, discoverable=@discoverable,
    activity_visible=@activity_visible, leaderboard_visible=@leaderboard_visible, read_receipts=@read_receipts, personalize=@personalize
    WHERE user_id=@user_id`).run(next);
  res.json({ settings: publicSettings(db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id), req.user) });
});

// Detect available models (OpenAI-compatible GET /models; Anthropic uses /v1/models).
router.post('/models', authRequired, async (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const proto = req.body?.protocol || 'openai';
  const raw = String(req.body?.base_url || cur.llm_base_url || '');
  const base = raw.split('?')[0].replace(/\/$/, '');
  const key = req.body?.api_key || cur.llm_api_key;
  if (proto === 'minimax') return res.json({ models: ['speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo', 'speech-01-240228'] });
  if (proto === 'browser') return res.json({ models: [] });
  if (!base) return res.status(400).json({ error: '请先填写 API Base URL' });
  if (!key) return res.status(400).json({ error: '请先填写 API Key' });
  const url = proto === 'anthropic' ? base.replace(/\/v1$/, '') + '/v1/models' : base + '/models';
  const headers = proto === 'elevenlabs' ? { 'xi-api-key': key }
    : proto === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${key}` };
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: `服务商返回 ${r.status}：${t.slice(0, 200)}` }); }
    const d = await r.json();
    const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
    res.json({ models: list.map(m => (typeof m === 'string' ? m : (m.model_id || m.id || m.name))).filter(Boolean) });
  } catch (e) { res.status(502).json({ error: '连接服务商失败：' + e.message }); }
});

// Connection test — verify the configured/posted LLM credentials respond.
router.post('/test-llm', authRequired, async (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const base = String(req.body?.base_url || cur.llm_base_url || '').replace(/\/$/, '');
  const key = req.body?.api_key || cur.llm_api_key;
  const model = req.body?.model || cur.llm_model;
  const proto = req.body?.protocol || cur.llm_protocol || 'openai';
  if (!key) return res.status(400).json({ error: '请先填写 API Key' });
  try {
    let reply = '';
    if (proto === 'anthropic') {
      const r = await fetch(base.replace(/\/v1$/, '') + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: '连接失败：' + t.slice(0, 200) }); }
      const d = await r.json(); reply = d?.content?.[0]?.text || 'OK';
    } else {
      const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: '连接失败：' + t.slice(0, 200) }); }
      const d = await r.json(); reply = d?.choices?.[0]?.message?.content || 'OK';
    }
    res.json({ ok: true, reply: String(reply).slice(0, 40) });
  } catch (e) { res.status(502).json({ error: '连接失败：' + e.message }); }
});

// Privacy / data management.
router.post('/clear-conversations', authRequired, (req, res) => {
  const ids = db.prepare('SELECT id FROM conversations WHERE user_id = ?').all(req.user.id).map(r => r.id);
  db.prepare('DELETE FROM conversations WHERE user_id = ?').run(req.user.id);
  if (ids.length) db.prepare(`DELETE FROM messages WHERE conversation_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  res.json({ ok: true, removed: ids.length });
});

router.get('/export', authRequired, (req, res) => {
  const uid = req.user.id;
  const convs = db.prepare('SELECT * FROM conversations WHERE user_id = ?').all(uid);
  res.json({
    exported_at: new Date().toISOString(), app: '幻域 HUANYU',
    profile: db.prepare('SELECT id, username, display_name, avatar, banner, bio, gold, diamond FROM users WHERE id = ?').get(uid),
    settings: publicSettings(db.prepare('SELECT * FROM settings WHERE user_id=?').get(uid) || {}, req.user),
    characters: db.prepare('SELECT * FROM characters WHERE owner_id = ?').all(uid),
    scripts: db.prepare('SELECT * FROM scripts WHERE author_id = ?').all(uid),
    conversations: convs.map(c => ({ ...c, messages: db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(c.id) })),
    favorites: db.prepare('SELECT character_id FROM favorites WHERE user_id = ?').all(uid).map(f => f.character_id),
  });
});

export default router;
