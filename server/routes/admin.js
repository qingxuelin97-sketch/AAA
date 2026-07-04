import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, isVip, notify } from '../wallet.js';
import { adminView, updatePlatform, getPlatform } from '../platform.js';
import { synthesize } from './chat.js';
import { detectAsrModels, transcribe } from '../asr.js';
import { creatorTier } from '../creator.js';
import { councilCfg, saveCouncil, councilSeats, councilSize, baseSeats, totalUsers, USERS_PER_SEAT, MIN_SEATS } from '../council.js';
import { exportAll, importAll } from '../snapshot.js';
import { flush } from '../persist.js';
import { cnToday } from '../daily.js';

const router = Router();
const isGm = (uid) => !!db.prepare('SELECT is_gm FROM users WHERE id = ?').get(uid)?.is_gm;
function gm(req, res, next) {
  if (!isGm(req.user.id)) return res.status(403).json({ error: '需要 GM 权限' });
  next();
}
router.use(authRequired, gm);
const rnd = (n = 6) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

router.get('/check', (req, res) => res.json({ is_gm: true }));

// ---- platform AI config (language / voice / image) ----
router.get('/platform', (req, res) => res.json({ platform: adminView() }));
router.put('/platform', (req, res) => res.json({ ok: true, platform: updatePlatform(req.body || {}) }));

// GM voice preview — synthesize a sample with the posted form values (so the GM
// can verify before saving). A blank key falls back to the saved platform key.
router.post('/platform/test-voice', async (req, res) => {
  const b = req.body?.voice || req.body || {};
  const saved = getPlatform().voice;
  const out = await synthesize({
    proto: b.protocol || saved.protocol || 'openai',
    base: b.base_url || saved.base_url,
    key: (b.key && b.key.trim()) ? b.key.trim() : saved.key,
    model: b.model || saved.model,
    voice: b.voice_name || saved.voice_name,
    text: req.body?.text || '幻域平台语音测试，这是当前音色的试听。',
    speed: req.body?.speed, pitch: req.body?.pitch,
  });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  res.setHeader('Content-Type', out.contentType);
  res.send(out.buffer);
});

// GM 音色自动检测——调用 TTS 服务商的音色列表端点（当前仅 MiniMax /v1/get_voice）。
// 表单 key 为空时回退到已保存的平台语音 key（GM 保存后表单 key 会被清空，不能因此
// 让 GM 重新填 key 才能检测）。base_url / protocol 同样回退到已保存值。
router.post('/platform/detect-voices', async (req, res) => {
  const b = req.body?.voice || req.body || {};
  const saved = getPlatform().voice;
  const proto = b.protocol || saved.protocol || 'openai';
  if (proto !== 'minimax') return res.status(400).json({ error: '当前语音服务商未提供音色列表端点' });
  const raw = String(b.base_url || saved.base_url || '');
  const mmBase = raw.split('?')[0].replace(/\/$/, '');
  let mmKey = String((b.key && b.key.trim()) ? b.key.trim() : saved.key || '').trim();
  if (mmKey.includes(':')) { const c = mmKey.indexOf(':'); mmKey = mmKey.slice(c + 1).trim(); }
  if (!mmBase) return res.status(400).json({ error: '请先填写 API Base URL' });
  if (!mmKey) return res.status(400).json({ error: '请先填写 API Key（MiniMax 接口密钥）' });
  try {
    const { assertPublicUrl } = await import('../safeUrl.js');
    assertPublicUrl(mmBase);
    const r = await fetch(`${mmBase}/get_voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mmKey}` },
      body: JSON.stringify({ voice_type: 'all' }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[admin] minimax /get_voice 上游错误', r.status, t.slice(0, 300)); return res.status(502).json({ error: `音色列表获取失败 (HTTP ${r.status})，请检查 API Key 与 Base URL` }); }
    const d = await r.json().catch(() => null);
    if (d?.base_resp?.status_code && d.base_resp.status_code !== 0)
      return res.status(502).json({ error: 'MiniMax 返回错误：' + (d.base_resp.status_msg || ('status_code=' + d.base_resp.status_code)) });
    const norm = (arr, group) => (Array.isArray(arr) ? arr.map(v => ({ voice_id: v.voice_id, voice_name: v.voice_name || '', group, description: Array.isArray(v.description) ? v.description.join('；') : (v.description || '') })).filter(x => x.voice_id) : []);
    res.json({ voices: [...norm(d?.system_voice, '系统音色'), ...norm(d?.voice_cloning, '复刻音色'), ...norm(d?.voice_generation, '生成音色')] });
  } catch (e) { console.error('[admin] minimax /get_voice 连接失败', e.message); res.status(502).json({ error: '音色列表获取失败：' + e.message }); }
});

// GM 图像服务在线检测——用当前表单值（未保存的也行）发起一次最小生成请求，
// 验证密钥/签名/区域是否可用，返回结果与延迟。空 key 回落到已保存配置。
router.post('/platform/test-image', async (req, res) => {
  const b = req.body?.image || req.body || {};
  const saved = getPlatform().image;
  const cfg = {
    provider: b.provider || saved.provider || 'openai',
    base_url: b.base_url || saved.base_url,
    key: (b.key && b.key.trim()) ? b.key.trim() : saved.key,
    model: b.model || saved.model,
    size: b.size || saved.size || '1024x1024',
    region: b.region || saved.region,
    styles: b.styles || saved.styles,
    resolution: b.resolution || saved.resolution || '768:768',
  };
  // 腾讯云：调用 AIrtist 检测
  if (cfg.provider === 'tencent') {
    const { testTencentImage } = await import('../tencentImage.js');
    const r = await testTencentImage(cfg);
    return res.json(r);
  }
  // 混元 TokenHub / OpenAI 兼容：用 base_url + Bearer key 调一次 /images/generations
  if (!cfg.key || !cfg.base_url) return res.json({ ok: false, message: '密钥与 Base URL 未配置' });
  try {
    const { assertPublicUrl } = await import('../safeUrl.js');
    assertPublicUrl(cfg.base_url);
    const isHunyuan = cfg.provider === 'hunyuan';
    const testSize = isHunyuan ? '1024:1024' : (cfg.size || '1024x1024');
    const model = isHunyuan ? (cfg.model || 'hy-image-v3.0') : (cfg.model || 'dall-e-3');
    const t0 = Date.now();
    const up = await fetch(cfg.base_url.replace(/\/$/, '') + '/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, prompt: '一只可爱的橘猫，柔光摄影', size: testSize, n: 1 }),
    });
    const latency_ms = Date.now() - t0;
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      return res.json({ ok: false, message: `HTTP ${up.status}：${t.slice(0, 180)}`, latency_ms });
    }
    const d = await up.json().catch(() => null);
    const item = d?.data?.[0] || {};
    const sample = item.b64_json ? 'data:image/png;base64,' + item.b64_json : (item.url || item.image);
    return res.json({ ok: true, message: '连接成功，密钥有效', latency_ms, sample });
  } catch (e) {
    return res.json({ ok: false, message: '连接失败：' + e.message });
  }
});

// GM 语音识别（ASR）模型检测——OpenAI 兼容族真实调用 {base}/models 过滤出识别模型；
// deepgram / elevenlabs 返回已知清单。空 key 回退到已保存的平台 ASR key。
router.post('/platform/detect-asr-models', async (req, res) => {
  const b = req.body?.asr || req.body || {};
  const saved = getPlatform().asr || {};
  const r = await detectAsrModels({
    proto: b.protocol || saved.protocol || 'openai',
    base: b.base_url || saved.base_url,
    key: (b.key && b.key.trim()) ? b.key.trim() : saved.key,
  });
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
  res.json({ models: r.models, source: r.source });
});

// GM 语音识别在线检测——用一小段静音 WAV 走一次真实识别请求，验证密钥/base 是否可用。
router.post('/platform/test-asr', async (req, res) => {
  const b = req.body?.asr || req.body || {};
  const saved = getPlatform().asr || {};
  // 生成 ~0.3s 16kHz 单声道静音 WAV（44 字节头 + 数据），足以让服务商回一个空转写而非报错。
  const dataLen = 16000 * 2 * 0.3 | 0;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  const t0 = Date.now();
  const r = await transcribe({
    proto: b.protocol || saved.protocol || 'openai',
    base: b.base_url || saved.base_url,
    key: (b.key && b.key.trim()) ? b.key.trim() : saved.key,
    model: b.model || saved.model,
    audio: buf, mime: 'audio/wav', filename: 'test.wav',
    language: b.language || saved.language,
  });
  const latency_ms = Date.now() - t0;
  if (!r.ok) return res.json({ ok: false, message: r.error, latency_ms });
  res.json({ ok: true, message: '连接成功，密钥有效', latency_ms, sample: r.text });
});

// ---- broadcast ----
router.post('/broadcast', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '广播内容不能为空' });
  const link = String(req.body?.link || '').trim();
  const users = db.prepare('SELECT id FROM users WHERE is_banned = 0').all();
  users.forEach(u => notify(u.id, '📢 ' + text, link));
  res.json({ ok: true, count: users.length });
});

// ---- council / parliament administration ----
router.get('/councilors', (req, res) => {
  const rows = db.prepare('SELECT id, username, display_name, avatar, verified FROM users WHERE is_councilor = 1').all()
    .map(u => ({ ...u, verified: !!u.verified, creator_tier: creatorTier(u.id) }));
  res.json({ councilors: rows });
});
router.get('/council', (req, res) => {
  const c = councilCfg(); const seats = councilSeats(); const cur = councilSize();
  res.json({ council: { total_users: totalUsers(), per_seat: USERS_PER_SEAT, min_seats: MIN_SEATS, base_seats: baseSeats(),
    seats, seats_override: c.seats_override, councilors: cur, vacancies: Math.max(0, seats - cur), over: cur > seats,
    term: c.term || 1, term_started_at: c.term_started_at, locked: !!c.locked, locked_at: c.locked_at || null } });
});
router.put('/council', (req, res) => {
  const c = councilCfg(); const v = req.body?.seats_override;
  if (v === null || v === '' || v === undefined) c.seats_override = null;
  else { const n = parseInt(v, 10); if (isNaN(n) || n < 0) return res.status(400).json({ error: '席位数必须是非负整数' }); if (n > 9999) return res.status(400).json({ error: '席位数过大' }); c.seats_override = n; }
  saveCouncil(c);
  res.json({ ok: true, seats: councilSeats(), seats_override: c.seats_override });
});
router.post('/council/lock', (req, res) => {
  const c = councilCfg(); c.locked = !!req.body?.value; c.locked_at = c.locked ? new Date().toISOString() : null; saveCouncil(c);
  db.prepare('SELECT id FROM users WHERE is_councilor = 1').all().forEach(u => notify(u.id, c.locked ? '幻域议会已被管理层宣布无限期休会，暂停一切议事，静待复会通知。' : '幻域议会已恢复运作，现可正常提交提案与表决。', '/parliament'));
  res.json({ ok: true, locked: c.locked });
});
router.post('/council/reapportion', (req, res) => {
  const c = councilCfg(); c.seats_override = null; c.term = (c.term || 1) + 1; c.term_started_at = new Date().toISOString(); saveCouncil(c);
  db.prepare('SELECT id FROM users WHERE is_councilor = 1').all().forEach(u => notify(u.id, `幻域议会已完成第 ${c.term} 届换届，席位按注册规模重新核定为 ${councilSeats()} 席。`, '/parliament'));
  res.json({ ok: true, term: c.term, seats: councilSeats() });
});
router.post('/users/:id/councilor', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const val = req.body?.value ? 1 : 0;
  db.prepare('UPDATE users SET is_councilor = ? WHERE id = ?').run(val, u.id);
  notify(u.id, val ? '🏛 恭喜！你已被任命为幻域议会议员，可发起提案并参与表决。' : '你的议员身份已被免去。', '/parliament');
  res.json({ ok: true });
});

router.get('/stats', (req, res) => {
  const c = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const today = cnToday(); // last_checkin 现按北京时间记日，此处口径一致
  const series = (tbl, days = 14) => {
    let rows = []; try { rows = db.prepare(`SELECT created_at FROM ${tbl}`).all(); } catch { rows = []; }
    const out = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); out.push({ date: d.slice(5), n: rows.filter(x => (x.created_at || '').slice(0, 10) === d).length }); }
    return out;
  };
  const econ = (cond) => { try { return db.prepare(`SELECT COALESCE(SUM(${cond}),0) n FROM transactions`).get().n; } catch { return 0; } };
  res.json({
    stats: { users: c('users'), characters: c('characters'), scripts: c('scripts'), moments: c('moments'),
      banned: db.prepare('SELECT COUNT(*) n FROM users WHERE is_banned=1').get().n,
      reports: db.prepare("SELECT COUNT(*) n FROM reports WHERE status='open'").get().n,
      conversations: c('conversations'), councilors: db.prepare('SELECT COUNT(*) n FROM users WHERE is_councilor=1').get().n,
      proposals: db.prepare("SELECT COUNT(*) n FROM proposals WHERE status IN ('pending','voting')").get().n,
      checkins_today: db.prepare('SELECT COUNT(*) n FROM users WHERE last_checkin = ?').get(today).n },
    series: { users: series('users'), characters: series('characters'), conversations: series('conversations') },
    economy: { gold_in: econ('CASE WHEN gold>0 THEN gold ELSE 0 END'), gold_out: econ('CASE WHEN gold<0 THEN -gold ELSE 0 END'), diamond_in: econ('CASE WHEN diamond>0 THEN diamond ELSE 0 END') },
  });
});

// ---- GM full backup / restore (数据保全：可一键导出整库 JSON，重新部署后再导入恢复) ----
router.get('/backup', (req, res) => {
  res.json({ app: '幻域 HUANYU', kind: 'server', exported_at: new Date().toISOString(), tables: exportAll() });
});
router.post('/restore', async (req, res) => {
  const tables = req.body?.tables;
  if (!tables || typeof tables !== 'object') return res.status(400).json({ error: '备份文件无效' });
  try { importAll(tables); } catch (e) { return res.status(500).json({ error: '恢复失败：' + e.message }); }
  try { await flush(true); } catch { /* */ } // persist the restored data immediately
  res.json({ ok: true });
});

// ---- users ----
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (!q) rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all();
  else if (/^\d+$/.test(q)) rows = db.prepare('SELECT * FROM users WHERE id = ?').all(+q);
  else rows = db.prepare('SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 50').all(`%${q}%`, `%${q}%`);
  res.json({ users: rows.map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar,
    gold: u.gold, diamond: u.diamond, vip: isVip(u), is_gm: !!u.is_gm, is_banned: !!u.is_banned, ban_reason: u.ban_reason })) });
});
router.post('/users/:id/ban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(req.body?.reason || '', req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/unban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = ? WHERE id = ?').run('', req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/gm', (req, res) => {
  db.prepare('UPDATE users SET is_gm = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
router.post('/gift', (req, res) => {
  const { user_id, username, gold = 0, diamond = 0, vip_days = 0, memo } = req.body || {};
  const target = user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(user_id)
    : db.prepare('SELECT * FROM users WHERE username = ? OR display_name = ?').get(username, username);
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  if (gold || diamond) applyTx(target.id, { kind: 'reward', gold: +gold || 0, diamond: +diamond || 0, memo: memo || 'GM 赠送' });
  if (+vip_days > 0) {
    const base = isVip(target) ? new Date(target.vip_until).getTime() : Date.now();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + vip_days * 86400000).toISOString(), target.id);
  }
  notify(target.id, `管理员赠送了你 ${gold ? gold + ' 金币 ' : ''}${diamond ? diamond + ' 钻石 ' : ''}${+vip_days > 0 ? vip_days + ' 天 VIP' : ''}`.trim());
  res.json({ ok: true, user_id: target.id });
});

// ---- content moderation ----
router.get('/characters', (req, res) => {
  const q = String(req.query.q || '').trim(); const k = `%${q}%`;
  const rows = q ? db.prepare('SELECT c.*, u.display_name owner_name FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.name LIKE ? ORDER BY c.id DESC LIMIT 50').all(k)
    : db.prepare('SELECT c.*, u.display_name owner_name FROM characters c JOIN users u ON u.id=c.owner_id ORDER BY c.id DESC LIMIT 50').all();
  res.json({ characters: rows });
});
router.post('/characters/:id/feature', (req, res) => { db.prepare('UPDATE characters SET featured = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id); res.json({ ok: true }); });
router.delete('/characters/:id', (req, res) => { db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

router.get('/scripts', (req, res) => {
  const q = String(req.query.q || '').trim(); const k = `%${q}%`;
  const rows = q ? db.prepare('SELECT s.*, u.display_name author_name FROM scripts s JOIN users u ON u.id=s.author_id WHERE s.title LIKE ? ORDER BY s.id DESC LIMIT 50').all(k)
    : db.prepare('SELECT s.*, u.display_name author_name FROM scripts s JOIN users u ON u.id=s.author_id ORDER BY s.id DESC LIMIT 50').all();
  res.json({ scripts: rows });
});
router.post('/scripts/:id/feature', (req, res) => { db.prepare('UPDATE scripts SET featured = ? WHERE id = ?').run(req.body?.value ? 1 : 0, req.params.id); res.json({ ok: true }); });
router.delete('/scripts/:id', (req, res) => { db.prepare('DELETE FROM scripts WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

router.delete('/moments/:id', (req, res) => { db.prepare('DELETE FROM moments WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
router.delete('/comments/:id', (req, res) => { db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
router.delete('/reviews/:id', (req, res) => { db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---- codes (invite / gift) ----
router.get('/codes', (req, res) => {
  res.json({ codes: db.prepare('SELECT * FROM invite_keys ORDER BY rowid DESC LIMIT 50').all() });
});
router.post('/codes', (req, res) => {
  const { gold = 0, diamond = 0, vip_days = 0, max_uses = 1, note = '', prefix = '' } = req.body || {};
  const code = (prefix ? String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' : '') + rnd(6);
  db.prepare('INSERT INTO invite_keys (code, max_uses, used, grant_gold, grant_diamond, grant_vip_days, note) VALUES (?,?,0,?,?,?,?)')
    .run(code, Math.max(1, +max_uses || 1), +gold || 0, +diamond || 0, +vip_days || 0, note || '');
  res.json({ code: db.prepare('SELECT * FROM invite_keys WHERE code = ?').get(code) });
});
router.delete('/codes/:code', (req, res) => { db.prepare('DELETE FROM invite_keys WHERE code = ?').run(req.params.code); res.json({ ok: true }); });

// ---- reports ----
router.get('/reports', (req, res) => {
  const rows = db.prepare(`SELECT r.*, u.display_name reporter_name FROM reports r LEFT JOIN users u ON u.id=r.reporter_id ORDER BY r.status='open' DESC, r.id DESC LIMIT 80`).all();
  res.json({ reports: rows });
});
router.post('/reports/:id/resolve', (req, res) => { db.prepare("UPDATE reports SET status='resolved' WHERE id = ?").run(req.params.id); res.json({ ok: true }); });

export default router;
