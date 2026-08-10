import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { isVip } from '../wallet.js';
import { getPlatform, voiceReady, imageReady, featureFee, platformFee, memberDiscount, VOICE_FEE, IMAGE_FEE, PLATFORM_FEE } from '../platform.js';
import { assertPublicUrl, safeFetch } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';
import { clampInt, clampFloat } from '../validate.js';
import { CATEGORIES } from './meta.js';

const router = Router();

const PUBLIC_FIELDS = [
  'llm_provider', 'llm_protocol', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens',
  'voice_provider', 'voice_protocol', 'voice_base_url', 'voice_model', 'voice_name', 'theme', 'nsfw', 'notify_email',
  'privacy_profile', 'allow_dm', 'show_online', 'discoverable', 'activity_visible', 'leaderboard_visible', 'read_receipts', 'personalize',
  'interests',
];

// 兴趣画像：slug 白名单 = 分类目录；接受数组或逗号串，去重、上限 6，存逗号串。
const CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));
export function sanitizeInterests(input, fallback = '') {
  if (input === undefined) return fallback;
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const clean = [...new Set(list.map((s) => String(s).trim()).filter((s) => CATEGORY_SLUGS.has(s)))];
  return clean.slice(0, 6).join(',');
}

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
  // 字符串字段一律截断。此前这个 str 直接回传原值、不限长度，一次 PUT 就能往
  // 每个文本列塞进任意大小的内容（settings 行随后被每次对话读取）。
  const str = (k, max) => (typeof b[k] === 'string' ? b[k].slice(0, max) : cur[k]);
  const secret = (k, max) => ((b[k] === undefined || b[k] === '') ? cur[k] : String(b[k]).slice(0, max));
  const bool = (k) => (b[k] === undefined ? cur[k] : (b[k] ? 1 : 0));
  const next = {
    user_id: req.user.id,
    llm_provider: str('llm_provider', 40), llm_protocol: str('llm_protocol', 40), llm_base_url: str('llm_base_url', 300),
    llm_api_key: secret('llm_api_key', 500),
    llm_model: str('llm_model', 120),
    // 采样参数必须夹紧。llm_max_tokens 此前完全不校验，而它是平台侧输出长度的
    // 唯一天花板（llm.js:24 会把用户值直接带进平台调用），填 200000 就等于取消上限。
    llm_temperature: clampFloat(b.llm_temperature, 0, 2, cur.llm_temperature ?? 0.8),
    llm_max_tokens: clampInt(b.llm_max_tokens, 64, 32768, cur.llm_max_tokens ?? 1024),
    voice_provider: str('voice_provider', 40), voice_protocol: str('voice_protocol', 40), voice_base_url: str('voice_base_url', 300),
    voice_api_key: secret('voice_api_key', 500),
    voice_model: str('voice_model', 120), voice_name: str('voice_name', 80), theme: str('theme', 20),
    nsfw: bool('nsfw'), notify_email: bool('notify_email'),
    privacy_profile: str('privacy_profile', 20),
    allow_dm: str('allow_dm', 20),
    show_online: bool('show_online'), discoverable: bool('discoverable'), activity_visible: bool('activity_visible'),
    leaderboard_visible: bool('leaderboard_visible'), read_receipts: bool('read_receipts'), personalize: bool('personalize'),
    interests: sanitizeInterests(b.interests, cur.interests || ''),
  };
  db.prepare(`UPDATE settings SET
    llm_provider=@llm_provider, llm_protocol=@llm_protocol, llm_base_url=@llm_base_url, llm_api_key=@llm_api_key, llm_model=@llm_model,
    llm_temperature=@llm_temperature, llm_max_tokens=@llm_max_tokens,
    voice_provider=@voice_provider, voice_protocol=@voice_protocol, voice_base_url=@voice_base_url, voice_api_key=@voice_api_key,
    voice_model=@voice_model, voice_name=@voice_name, theme=@theme, nsfw=@nsfw, notify_email=@notify_email,
    privacy_profile=@privacy_profile, allow_dm=@allow_dm, show_online=@show_online, discoverable=@discoverable,
    activity_visible=@activity_visible, leaderboard_visible=@leaderboard_visible, read_receipts=@read_receipts, personalize=@personalize,
    interests=@interests
    WHERE user_id=@user_id`).run(next);
  res.json({ settings: publicSettings(db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id), req.user) });
});

// Detect available models (OpenAI-compatible GET /models; Anthropic uses /v1/models).
router.post('/models', authRequired, aiLimiter, async (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const proto = req.body?.protocol || 'openai';
  const raw = String(req.body?.base_url || cur.llm_base_url || '');
  const base = raw.split('?')[0].replace(/\/$/, '');
  const key = req.body?.api_key || cur.llm_api_key;
  if (proto === 'minimax') {
    // MiniMax TTS 模型：官方未提供「TTS 模型列表」端点。
    //   · /v1/models 是 OpenAI 兼容端点，只返回 LLM 模型（MiniMax-M3 等），
    //     不能拿来当 TTS 模型，否则会把文字模型错误地路由进语音合成。
    //   · 因此这里返回 MiniMax 官方文档公开的 T2A 模型清单（同步语音合成接口
    //     POST /v1/t2a_v2 实际支持的 model 取值），由前端 datalist 供选择。
    //   · 音色（voice_id）的自动检测走另一个端点 /v1/get_voice，见 /admin/platform/detect-voices（GM）与 /settings/voices（用户自备）。
    return res.json({
      models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'],
      source: '官方文档公开 T2A 模型清单（MiniMax 未提供 TTS 模型列表端点）',
    });
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
    const r = await safeFetch(url, { headers });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] /models 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: '获取模型列表失败，请检查 API Base URL 与 Key 是否正确' }); }
    const d = await r.json();
    const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
    res.json({ models: list.map(m => (typeof m === 'string' ? m : (m.model_id || m.id || m.name))).filter(Boolean) });
  } catch (e) { console.error('[settings] /models 连接失败', e.message); res.status(502).json({ error: '获取模型列表失败，请检查 API Base URL 与 Key 是否正确' }); }
});

// Detect available voices for TTS providers that expose a voice-list endpoint.
// Currently supports MiniMax (POST /v1/get_voice, voice_type:"all").
router.post('/voices', authRequired, aiLimiter, async (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const proto = req.body?.protocol || cur.voice_protocol || 'openai';
  if (proto !== 'minimax') return res.status(400).json({ error: '当前语音服务商未提供音色列表端点' });
  // MiniMax /v1/get_voice：POST，Bearer 鉴权，body {voice_type:"all"}。
  //   · 不需要 GroupId，从 base_url 剥离 ?GroupId=…；密钥可能是「GroupId:APIKey」，取冒号后部分。
  //   · 响应含 system_voice / voice_cloning / voice_generation 三类，每项含 voice_id、voice_name、description。
  const raw = String(req.body?.base_url || cur.voice_base_url || '');
  const mmBase = raw.split('?')[0].replace(/\/$/, '');
  let mmKey = String(req.body?.api_key || cur.voice_api_key || '').trim();
  if (mmKey.includes(':')) { const c = mmKey.indexOf(':'); mmKey = mmKey.slice(c + 1).trim(); }
  if (!mmBase) return res.status(400).json({ error: '请先填写 API Base URL' });
  if (!mmKey) return res.status(400).json({ error: '请先填写 API Key（MiniMax 接口密钥）' });
  try {
    assertPublicUrl(mmBase);
    const r = await safeFetch(`${mmBase}/get_voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mmKey}` },
      body: JSON.stringify({ voice_type: 'all' }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] minimax /get_voice 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: `音色列表获取失败 (HTTP ${r.status})，请检查 API Key 与 Base URL` }); }
    const d = await r.json().catch(() => null);
    if (d?.base_resp?.status_code && d.base_resp.status_code !== 0)
      return res.status(502).json({ error: 'MiniMax 返回错误：' + (d.base_resp.status_msg || ('status_code=' + d.base_resp.status_code)) });
    const norm = (arr, group) => (Array.isArray(arr) ? arr.map(v => ({ voice_id: v.voice_id, voice_name: v.voice_name || '', group, description: Array.isArray(v.description) ? v.description.join('；') : (v.description || '') })).filter(x => x.voice_id) : []);
    const voices = [...norm(d?.system_voice, '系统音色'), ...norm(d?.voice_cloning, '复刻音色'), ...norm(d?.voice_generation, '生成音色')];
    res.json({ voices });
  } catch (e) { console.error('[settings] minimax /get_voice 连接失败', e.message); res.status(502).json({ error: '音色列表获取失败：' + e.message }); }
});

// Connection test — verify the configured/posted LLM credentials respond.
router.post('/test-llm', authRequired, aiLimiter, async (req, res) => {
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
      const r = await safeFetch(base.replace(/\/v1$/, '') + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[settings] /test-llm 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: '连接测试失败：请检查 API Key 与 Base URL 是否正确' }); }
      const d = await r.json(); reply = d?.content?.[0]?.text || 'OK';
    } else {
      const r = await safeFetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: '请只回复两个字：在线' }] }) });
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

// 导入 /settings/export 生成的 JSON 包（数据互通：网页试玩/mock 数据带入真账号）。
// 只导创作与对话数据；经济字段（gold/diamond/vip/流水）一概不触碰（防作弊）。
// 白名单列插入 + 归属改写为调用者 + 传播计数清零；conversation.character_id
// 按「导出角色 id → 新角色 id」映射重连，映射不到的会话跳过并计数。
const IMPORT_LIMITS = { characters: 200, scripts: 200, conversations: 500, messages: 20000, field: 200000 };
const clip = (v, n = IMPORT_LIMITS.field) => String(v ?? '').slice(0, n);
router.post('/import', authRequired, (req, res) => {
  const data = req.body || {};
  if (data.app !== '幻域 HUANYU') return res.status(400).json({ error: '不是本产品导出的数据包' });
  const chars = Array.isArray(data.characters) ? data.characters : [];
  const scripts = Array.isArray(data.scripts) ? data.scripts : [];
  const convs = Array.isArray(data.conversations) ? data.conversations : [];
  const msgTotal = convs.reduce((n, c) => n + (Array.isArray(c?.messages) ? c.messages.length : 0), 0);
  if (chars.length > IMPORT_LIMITS.characters) return res.status(400).json({ error: `角色数量超上限（${IMPORT_LIMITS.characters}）` });
  if (scripts.length > IMPORT_LIMITS.scripts) return res.status(400).json({ error: `剧本数量超上限（${IMPORT_LIMITS.scripts}）` });
  if (convs.length > IMPORT_LIMITS.conversations) return res.status(400).json({ error: `对话数量超上限（${IMPORT_LIMITS.conversations}）` });
  if (msgTotal > IMPORT_LIMITS.messages) return res.status(400).json({ error: `消息总量超上限（${IMPORT_LIMITS.messages}）` });

  const uid = req.user.id;
  // affinity_dropped：包里带了好感、但被服务端清零的会话数。如实回报，
  // 免得用户以为导入丢了数据（前端可据此提示「好感需重新培养」）。
  const out = { characters: 0, scripts: 0, conversations: 0, messages: 0, affinity_dropped: 0 };
  let skipped = 0;
  const charMap = new Map(); // 导出包里的角色 id → 新插入 id

  const insChar = db.prepare(`INSERT INTO characters
    (owner_id, name, avatar, background, background_type, tagline, intro, greeting, persona,
     voice_name, voice_speed, voice_pitch, category, tags, is_public, nsfw, bgm, front_regex, alt_greetings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`);
  const insScript = db.prepare(`INSERT INTO scripts
    (author_id, title, summary, cover, content, category, tags, price_gold, nsfw)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`);
  const insConv = db.prepare(`INSERT INTO conversations (user_id, character_id, title, affinity, memories)
    VALUES (?, ?, ?, ?, ?)`);
  const insMsg = db.prepare(`INSERT INTO messages (conversation_id, role, content, created_at, reaction)
    VALUES (?, ?, ?, ?, ?)`);

  try {
    db.transaction(() => {
      for (const c of chars) {
        if (!c || !String(c.name || '').trim()) { skipped++; continue; }
        const r = insChar.run(uid, clip(c.name, 80), clip(c.avatar, 4000) || null, clip(c.background, 4000) || null,
          clip(c.background_type, 20) || 'image', clip(c.tagline, 400), clip(c.intro), clip(c.greeting), clip(c.persona),
          clip(c.voice_name, 120), Number(c.voice_speed) || 1, Number(c.voice_pitch) || 1,
          clip(c.category, 40), clip(c.tags, 400), c.nsfw ? 1 : 0,
          clip(c.bgm, 4000), clip(c.front_regex), clip(c.alt_greetings));
        charMap.set(c.id, r.lastInsertRowid);
        out.characters++;
      }
      for (const s of scripts) {
        if (!s || !String(s.title || '').trim()) { skipped++; continue; }
        insScript.run(uid, clip(s.title, 120), clip(s.summary, 2000), clip(s.cover, 4000) || null,
          clip(s.content), clip(s.category, 40), clip(s.tags, 400), s.nsfw ? 1 : 0);
        out.scripts++;
      }
      for (const cv of convs) {
        const cid = charMap.get(cv?.character_id);
        if (!cid) { skipped++; continue; } // 只重连到本次导入的角色，避免挂到他人角色上
        // ⚠ affinity 恒为 0，绝不采信包里的值。
        // 好感是**服务端权威**字段：affinity.js 的全部意义就是把它锁在每日 40 点
        // 的共享配额内（grantAffinity 是唯一发放口），而 achievements.js 的
        // affinity_max 直接拿它发金币奖励（aff_close 100 /aff_love 250）。
        // 这个端点原本把客户端传来的数字直写入库，等于绕开配额一次性铸币 ——
        // 与本文件开头「经济字段一概不触碰（防作弊）」的既定口径自相矛盾。
        // 代价是导出再导入会丢好感；这是可接受的：好感记录的是相处过程，不是可搬运的资产。
        const r = insConv.run(uid, cid, clip(cv.title, 200), 0, clip(cv.memories) || '[]');
        if (Number(cv.affinity) > 0) out.affinity_dropped++;
        out.conversations++;
        for (const m of (Array.isArray(cv.messages) ? cv.messages : [])) {
          const role = m?.role === 'user' ? 'user' : 'assistant';
          if (!m || typeof m.content !== 'string') { skipped++; continue; }
          insMsg.run(r.lastInsertRowid, role, clip(m.content), clip(m.created_at, 40) || null, clip(m.reaction, 40) || null);
          out.messages++;
        }
      }
    })();
  } catch (e) {
    return res.status(400).json({ error: '导入失败：' + (e.message || '数据格式异常') });
  }
  res.json({ imported: out, skipped });
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
