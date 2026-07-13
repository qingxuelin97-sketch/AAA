import { Router } from 'express';
import { randomInt } from 'node:crypto';
import db from '../db.js';
import { authRequired, requireGm } from '../auth.js';
import { applyTx, isVip, notify } from '../wallet.js';
import { adminView, updatePlatform, getPlatform } from '../platform.js';
import { synthesize } from './chat.js';
import { detectAsrModels, transcribe } from '../asr.js';
import { creatorTier } from '../creator.js';
import { councilCfg, saveCouncil, councilSeats, councilSize, baseSeats, totalUsers, USERS_PER_SEAT, MIN_SEATS } from '../council.js';
import { exportAll, importAll } from '../snapshot.js';
import { flush } from '../persist.js';
import { cnToday } from '../daily.js';
import { getMail, updateMail, testMailConn } from '../mail.js';
import { listWhitelist, addWhitelist, importWhitelist, removeWhitelist, clearWhitelist, whitelistEnabled } from '../whitelist.js';
import { auditLog, queryLogs, getLogStats, getLogTimeseries, getLogTop, getErrorFingerprints, log } from '../logger.js';

const router = Router();
// authRequired 已带 is_gm，requireGm 直接读 req.user，无需再查库。
router.use(authRequired, requireGm);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n = 6) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const dataOpsEnabled = () => process.env.ADMIN_DATA_OPS === 'true';

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
    const { assertPublicUrl, safeFetch } = await import('../safeUrl.js');
    assertPublicUrl(mmBase);
    const r = await safeFetch(`${mmBase}/get_voice`, {
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
    const { assertPublicUrl, safeFetch } = await import('../safeUrl.js');
    assertPublicUrl(cfg.base_url);
    const isHunyuan = cfg.provider === 'hunyuan';
    const testSize = isHunyuan ? '1024:1024' : (cfg.size || '1024x1024');
    const model = isHunyuan ? (cfg.model || 'hy-image-v3.0') : (cfg.model || 'dall-e-3');
    const t0 = Date.now();
    const up = await safeFetch(cfg.base_url.replace(/\/$/, '') + '/images/generations', {
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
  if (!dataOpsEnabled()) return res.status(403).json({ error: 'Web 端整库导出默认关闭，请通过受控运维流程执行' });
  // 整库导出含全体用户数据 —— 高敏操作，落审计（谁、何时、从哪导出）。
  auditLog({ event: 'backup_export', message: 'GM 导出整库备份', actor_id: req.user.id,
    ip: req.ip, ua: req.header('user-agent') || '', request_id: req.requestId || '' });
  res.json({ app: '幻域 HUANYU', kind: 'server', exported_at: new Date().toISOString(), tables: exportAll() });
});
router.post('/restore', async (req, res) => {
  if (!dataOpsEnabled()) return res.status(403).json({ error: 'Web 端整库恢复默认关闭，请通过受控运维流程执行' });
  const tables = req.body?.tables;
  if (!tables || typeof tables !== 'object') return res.status(400).json({ error: '备份文件无效' });
  // 全库覆盖是最高危的 GM 操作：先落审计（含表名与行数摘要），再执行。
  const summary = Object.entries(tables).map(([t, rows]) => `${t}:${Array.isArray(rows) ? rows.length : '?'}`).join(', ');
  auditLog({ event: 'restore_import', message: `GM 整库恢复覆盖（${summary.slice(0, 500)}）`, actor_id: req.user.id,
    ip: req.ip, ua: req.header('user-agent') || '', request_id: req.requestId || '' });
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
  const target = db.prepare('SELECT id, is_gm FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.is_gm) return res.status(403).json({ error: '不能通过 Web 管理端封禁管理员账号' });
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(req.body?.reason || '', req.params.id);
  auditLog({ event: 'ban', message: `GM 封禁用户 U${req.params.id}${req.body?.reason ? '：' + req.body.reason : ''}`,
    user_id: req.params.id, actor_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    extra: { reason: req.body?.reason || '' }, request_id: req.requestId || '' });
  res.json({ ok: true });
});
router.post('/users/:id/unban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = ? WHERE id = ?').run('', req.params.id);
  auditLog({ event: 'unban', message: `GM 解封用户 U${req.params.id}`,
    user_id: req.params.id, actor_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    request_id: req.requestId || '' });
  res.json({ ok: true });
});
router.post('/users/:id/gm', (req, res) => {
  auditLog({ event: 'gm_change_blocked', message: `拒绝 Web 端修改 U${req.params.id} 的 GM 权限`,
    user_id: req.params.id, actor_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    request_id: req.requestId || '' });
  res.status(403).json({ error: '管理员权限只能通过服务器本地运维命令修改' });
});
router.post('/gift', (req, res) => {
  const { user_id, username, gold = 0, diamond = 0, vip_days = 0, memo } = req.body || {};
  const target = user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(user_id)
    : db.prepare('SELECT * FROM users WHERE username = ? OR display_name = ?').get(username, username);
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  const amounts = { gold: Number(gold), diamond: Number(diamond), vip_days: Number(vip_days) };
  const caps = {
    gold: Number(process.env.ADMIN_GIFT_GOLD_MAX) || 1_000_000,
    diamond: Number(process.env.ADMIN_GIFT_DIAMOND_MAX) || 100_000,
    vip_days: Number(process.env.ADMIN_GIFT_VIP_DAYS_MAX) || 3650,
  };
  for (const key of Object.keys(amounts)) {
    if (!Number.isSafeInteger(amounts[key]) || amounts[key] < 0 || amounts[key] > caps[key]) {
      return res.status(400).json({ error: `${key} 必须是 0 至 ${caps[key]} 的整数` });
    }
  }
  if (!amounts.gold && !amounts.diamond && !amounts.vip_days) return res.status(400).json({ error: '赠送内容不能为空' });
  if (amounts.gold || amounts.diamond) applyTx(target.id, { kind: 'reward', gold: amounts.gold, diamond: amounts.diamond, memo: String(memo || 'GM 赠送').slice(0, 200) });
  if (amounts.vip_days > 0) {
    const base = isVip(target) ? new Date(target.vip_until).getTime() : Date.now();
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(new Date(base + amounts.vip_days * 86400000).toISOString(), target.id);
  }
  notify(target.id, `管理员赠送了你 ${amounts.gold ? amounts.gold + ' 金币 ' : ''}${amounts.diamond ? amounts.diamond + ' 钻石 ' : ''}${amounts.vip_days > 0 ? amounts.vip_days + ' 天 VIP' : ''}`.trim());
  auditLog({ event: 'gift', message: `GM 赠送 U${target.id} ${amounts.gold ? amounts.gold + '金 ' : ''}${amounts.diamond ? amounts.diamond + '钻 ' : ''}${amounts.vip_days > 0 ? amounts.vip_days + '天VIP' : ''}`.trim(),
    user_id: target.id, actor_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    extra: { ...amounts, memo: String(memo || '').slice(0, 200) }, request_id: req.requestId || '' });
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

// ---- 注册白名单（邮箱白名单政策）----
// 白名单非空时，仅白名单内邮箱可注册本平台。
router.get('/whitelist', (req, res) => {
  const q = String(req.query.q || '');
  const rows = listWhitelist(q);
  res.json({ whitelist: rows, enabled: whitelistEnabled(), count: rows.length });
});
router.post('/whitelist', (req, res) => {
  const { email, kind, note } = req.body || {};
  const r = addWhitelist(email, kind, note);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, whitelist: listWhitelist(), enabled: whitelistEnabled() });
});
router.post('/whitelist/import', (req, res) => {
  const r = importWhitelist(req.body?.text);
  res.json({ ok: true, ...r, whitelist: listWhitelist(), enabled: whitelistEnabled() });
});
router.delete('/whitelist/:id', (req, res) => {
  removeWhitelist(req.params.id);
  res.json({ ok: true, whitelist: listWhitelist(), enabled: whitelistEnabled() });
});
router.delete('/whitelist', (req, res) => {
  clearWhitelist();
  res.json({ ok: true, whitelist: [], enabled: false });
});

// ---- 邮件服务（SMTP）配置 ----
router.get('/mail', (req, res) => res.json({ mail: getMail() }));
router.put('/mail', (req, res) => res.json({ ok: true, mail: updateMail(req.body || {}) }));
router.post('/mail/test', async (req, res) => {
  const r = await testMailConn(req.body || {});
  res.json(r);
});

// —— 日志系统 ——
// GM 后台「日志」标签页的后端：多维查询 / 统计 / 时序图 / TOP 榜 / 错误指纹 / 导出。
// 全部需 GM 权限（router.use(authRequired, gm) 已在最外层拦截）。

// 多维过滤分页查询。level=error 时自动包含 fatal（>= 过滤）。
router.get('/logs', (req, res) => {
  const { level, source, category, event, user_id, q, since, until, limit, offset, sort } = req.query;
  const r = queryLogs({ level, source, category, event, user_id, q, since, until, limit, offset, sort });
  res.json(r);
});

// 日志统计概览：总数 / 24h 错误 / 按级别·来源·类别分布。
router.get('/logs/stats', (req, res) => {
  res.json({ stats: getLogStats() });
});

// 时间序列：按小时（最近24h）或按天（最近30天）聚合，用于趋势图。
router.get('/logs/timeseries', (req, res) => {
  const window = req.query.window === 'day' ? 'day' : 'hour';
  const level = req.query.level || '';
  res.json({ series: getLogTimeseries(window, level) });
});

// TOP 榜：高频事件 / 热点接口 / 活跃用户 / 高频 IP。
router.get('/logs/top', (req, res) => {
  const dim = ['event', 'endpoint', 'user', 'ip'].includes(req.query.dim) ? req.query.dim : 'event';
  const level = req.query.level || '';
  const limit = req.query.limit || 10;
  res.json({ top: getLogTop(dim, level, limit) });
});

// 错误指纹聚合：找出高频错误（按指纹分组，count 求和），用于「错误热点」面板。
router.get('/logs/fingerprints', (req, res) => {
  const limit = req.query.limit || 10;
  res.json({ fingerprints: getErrorFingerprints(limit) });
});

// 导出日志为 JSON 文件（最多 1000 条，避免响应过大）。
// GM 排查问题时可导出当前过滤结果离线分析。
router.get('/logs/export', (req, res) => {
  const { level, source, category, event, user_id, q, since, until, sort } = req.query;
  const r = queryLogs({ level, source, category, event, user_id, q, since, until, limit: 1000, offset: 0, sort });
  res.setHeader('Content-Disposition', `attachment; filename="logs-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exported_at: new Date().toISOString(), total: r.total, rows: r.rows });
});

// 手动触发日志清理（GM 在后台「日志」页点击「立即清理」按钮调用）。
router.post('/logs/purge', async (req, res) => {
  const { purgeOldLogs } = await import('../logger.js');
  const removed = purgeOldLogs();
  auditLog({ event: 'purge_logs', message: `GM 手动清理日志 ${removed} 条`, actor_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '', extra: { removed } });
  res.json({ ok: true, removed });
});

export default router;
