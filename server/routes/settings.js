import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { isVip } from '../wallet.js';
import { getPlatform, voiceReady, imageReady, featureFee, platformFee, memberDiscount, VOICE_FEE, IMAGE_FEE, PLATFORM_FEE } from '../platform.js';
import { assertPublicUrl } from '../safeUrl.js';

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
  const disc = memberDiscount(me);
  out.using_platform = usingPlatform;
  // Always expose pricing (with full + member-discounted figures) so the UI can
  // label the cost — and the discount for VIP/SVIP — regardless of whether the
  // platform service is the one currently active for this user.
  out.platform_fee = {
    base: platformFee(me, 0), heavy: platformFee(me, PLATFORM_FEE.heavy_threshold + 1),
    base_full: PLATFORM_FEE.base, heavy_full: PLATFORM_FEE.heavy,
    heavy_threshold: PLATFORM_FEE.heavy_threshold, discount: disc, active: usingPlatform,
  };
  out.using_platform_voice = usingPlatformVoice;
  out.voice_fee = { per: featureFee(me, VOICE_FEE), base: VOICE_FEE, discount: disc, active: usingPlatformVoice, ready: voiceReady() };
  out.image_fee = { per: featureFee(me, IMAGE_FEE), base: IMAGE_FEE, discount: disc, active: true, ready: imageReady() };
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
  if (proto === 'minimax') {
    // MiniMax /v1/models（OpenAI 兼容）：返回账户可用的全部模型。
    //   · 该端点不需要 GroupId，需从 base_url 中剥离 ?GroupId=… 查询串；
    //   · 密钥可能写作「GroupId:APIKey」，取冒号后部分作为 Bearer；
    //   · TTS 适配器走 /t2a_v2，仅保留 speech-* 开头的语音合成模型；若 /v1/models
    //     未返回任何 speech-*（MiniMax 当前 /v1/models 仅暴露 LLM 模型），则把全部
    //     模型回显，由前端 placeholder 提示用户手动输入 speech-02-hd 等 TTS 模型名。
    const mmBase = raw.split('?')[0].replace(/\/$/, '');
    let mmKey = String(key || '').trim();
    if (mmKey.includes(':')) { const c = mmKey.indexOf(':'); mmKey = mmKey.slice(c + 1).trim(); }
    if (!mmBase) return res.status(400).json({ error: '请先填写 API Base URL' });
    if (!mmKey) return res.status(400).json({ error: '请先填写 API Key（MiniMax 接口密钥）' });
    try {
      assertPublicUrl(mmBase);
      const r = await fetch(`${mmBase}/models`, { headers: { Authorization: `Bearer ${mmKey}` } });
      if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] minimax /models 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: `MiniMax 模型列表获取失败 (HTTP ${r.status})，请检查 API Key 与 Base URL` }); }
      const d = await r.json().catch(() => null);
      const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
      const ids = list.map(m => (typeof m === 'string' ? m : (m.id || m.model_id || m.name))).filter(Boolean);
      const tts = ids.filter(id => /^speech[-_.]/i.test(id));
      res.json({ models: tts.length ? tts : ids });
    } catch (e) {
      console.error('[settings] minimax /models 连接失败', e.message);
      res.status(502).json({ error: 'MiniMax 模型列表获取失败：' + e.message });
    }
    return;
  }
  if (proto === 'volcano') return res.json({ models: ['volcano_tts', 'volcano_icl'] });
  if (proto === 'tencent') return res.json({ models: ['ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-hongkong'] });
  if (proto === 'baidu' || proto === 'browser') return res.json({ models: [] });
  if (!base) return res.status(400).json({ error: '请先填写 API Base URL' });
  if (!key) return res.status(400).json({ error: '请先填写 API Key' });
  // SSRF 防护：发起 fetch 前校验 base_url 不指向内网/本机。
  assertPublicUrl(base);
  const url = proto === 'anthropic' ? base.replace(/\/v1$/, '') + '/v1/models' : base + '/models';
  const headers = proto === 'elevenlabs' ? { 'xi-api-key': key }
    : proto === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${key}` };
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] /models 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: '获取模型列表失败，请检查 API Base URL 与 Key 是否正确' }); }
    const d = await r.json();
    const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
    res.json({ models: list.map(m => (typeof m === 'string' ? m : (m.model_id || m.id || m.name))).filter(Boolean) });
  } catch (e) { console.error('[settings] /models 连接失败', e.message); res.status(502).json({ error: '获取模型列表失败，请检查 API Base URL 与 Key 是否正确' }); }
});

// Connection test — verify the configured/posted LLM credentials respond.
router.post('/test-llm', authRequired, async (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const base = String(req.body?.base_url || cur.llm_base_url || '').replace(/\/$/, '');
  const key = req.body?.api_key || cur.llm_api_key;
  const model = req.body?.model || cur.llm_model;
  const proto = req.body?.protocol || cur.llm_protocol || 'openai';
  if (!key) return res.status(400).json({ error: '请先填写 API Key' });
  // SSRF 防护：发起 fetch 前校验 base_url 不指向内网/本机。
  assertPublicUrl(base);
  try {
    let reply = '';
    if (proto === 'anthropic') {
      const r = await fetch(base.replace(/\/v1$/, '') + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] /test-llm 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: '连接测试失败：请检查 API Key 与 Base URL 是否正确' }); }
      const d = await r.json(); reply = d?.content?.[0]?.text || 'OK';
    } else {
      const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] /test-llm 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: '连接测试失败：请检查 API Key 与 Base URL 是否正确' }); }
      const d = await r.json(); reply = d?.choices?.[0]?.message?.content || 'OK';
    }
    res.json({ ok: true, reply: String(reply).slice(0, 40) });
  } catch (e) { console.error('[settings] /test-llm 连接失败', e.message); res.status(502).json({ error: '连接测试失败：请检查 API Key 与 Base URL 是否正确' }); }
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
