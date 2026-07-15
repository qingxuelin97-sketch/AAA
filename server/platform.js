import db from './db.js';
import { isVip, applyTx, settleTransaction } from './wallet.js';
import { log } from './logger.js';

// Pay-per-use feature fees (gold). VIP / SVIP get the membership discount.
export const VOICE_FEE = 20;  // per spoken sentence (platform voice)
export const IMAGE_FEE = 40;  // per generated image
export const PLATFORM_FEE = { base: 20, heavy: 30, heavy_threshold: 100 };
export const memberDiscount = (u) => (u?.svip ? 0.5 : isVip(u) ? 0.75 : 1);
export const featureFee = (u, base) => Math.max(1, Math.round(base * memberDiscount(u)));
// Per-reply platform chat fee: heavier (100+ message) sessions cost more.
export const platformFee = (u, msgCount) =>
  Math.max(1, Math.round((msgCount > PLATFORM_FEE.heavy_threshold ? PLATFORM_FEE.heavy : PLATFORM_FEE.base) * memberDiscount(u)));

// —— 平台 AI 计费：预扣 + 失败退款 ——
// 旧模式「先出结果、成功后扣费」在并发下可被白嫖：多请求同时通过同一份余额
// 快照的预检，回复各自送达后 applyTx 才发现扣不动（仅落 warn）——上游 API
// 成本已经花掉。预扣把「校验 + 扣款」放进 applyTx 的事务里，并发的第二笔在
// 调上游之前就被原子拒绝；失败路径（上游错误 / 客户端断开 / 空产出）原路
// 退款（kind='ai_refund'，与预扣同 ref_owner —— 创作者分成池按 ai_fee 减
// ai_refund 轧差统计，见 routes/me.js，杜绝「刷失败调用虚增分成」）。
// 崩溃在「已扣未退」窗口的残留由 ai_fee_refund_failed 日志 + GM 钱包补偿兜底。
export function chargePlatformFee({ req, res, sse, me, eff, historyLen, memo, refOwner = null, convId = null, characterId = null, insufficientHint = '' }) {
  const ctx = { fee: 0, rejected: false, charged: false, settle: () => {}, refund: () => {} };
  if (!eff?.platform) return ctx;
  ctx.fee = platformFee(me, historyLen);
  const logExtra = { conversation_id: convId, character_id: characterId, fee_due: ctx.fee };
  const logBase = { source: 'server', category: 'economy', user_id: me.id, ip: req.ip, endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '' };
  let charge = null;
  try {
    charge = applyTx(me.id, { kind: 'ai_fee', gold: -ctx.fee, memo, ref_owner: refOwner, share_eligible: false });
    ctx.charged = true;
  } catch {
    ctx.rejected = true;
    sse({ error: `金币不足，本次平台 AI 服务需 ${ctx.fee} 金币（当前 ${me.gold}）。${insufficientHint}` });
    sse('[DONE]'); res.end();
    return ctx;
  }
  ctx.settle = () => {
    if (!ctx.charged) return;
    settleTransaction(charge.transaction_id);
    ctx.charged = false;
    // 余额现查现报：预扣与送达之间可能有其他消费，别把过期快照报给前端。
    const g = db.prepare('SELECT gold FROM users WHERE id = ?').get(me.id)?.gold ?? 0;
    if (!res.destroyed) sse({ fee: ctx.fee, balance: g });
  };
  ctx.refund = (reason) => {
    if (!ctx.charged) return;
    try {
      applyTx(me.id, {
        kind: 'ai_refund', gold: ctx.fee, memo: `退款（${reason}）· ${memo}`,
        reversal_of: charge.transaction_id, idempotency_key: `ai-refund:${charge.transaction_id}`,
      });
      ctx.charged = false;
      log({ ...logBase, level: 'info', event: 'ai_fee_refund', message: `平台 AI 预扣退款（${reason}）`, extra: logExtra });
    } catch (e) {
      log({ ...logBase, level: 'error', event: 'ai_fee_refund_failed', message: `平台 AI 预扣退款失败（${reason}）：${e.message}`, extra: logExtra });
    }
  };
  return ctx;
}

// Group-wide platform AI config (language / voice / image). Stored as JSON in
// app_config. Keys live only in the server DB and are never returned unmasked.
// 默认平台语言服务密钥从环境变量注入，杜绝硬编码进源码；GM 也可在后台配置。
const DEFAULTS = {
  base_url: process.env.PLATFORM_LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
  model: process.env.PLATFORM_LLM_MODEL || 'glm-5.2', protocol: 'openai',
  key: process.env.PLATFORM_LLM_KEY || '',
  system_prompt: '',
  voice: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', key: '', model: 'tts-1', voice_name: 'alloy' },
  image: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', key: '', model: 'gpt-image-1', size: '1024x1024', region: '', styles: '201', resolution: '768:768' },
  // 语音识别（ASR / 语音转文字）—— 供「通话」把用户说的话转成文字。
  asr: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', key: '', model: 'whisper-1', language: '' },
};

function read() {
  const row = db.prepare("SELECT value FROM app_config WHERE key='platform'").get();
  let cfg = {};
  if (row) { try { cfg = JSON.parse(row.value); } catch { cfg = {}; } }
  return { ...DEFAULTS, ...cfg, voice: { ...DEFAULTS.voice, ...(cfg.voice || {}) }, image: { ...DEFAULTS.image, ...(cfg.image || {}) }, asr: { ...DEFAULTS.asr, ...(cfg.asr || {}) } };
}
function write(cfg) {
  db.prepare("INSERT INTO app_config (key, value) VALUES ('platform', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cfg));
}

export function getPlatform() { return read(); }
export const voiceReady = () => { const c = read(); return !!(c.voice.key && c.voice.base_url); };
// 语音识别可用性判定：OpenAI 兼容族需 key + base_url；deepgram/elevenlabs 有默认域名，只需 key。
export const asrReady = () => {
  const c = read(); const a = c.asr || {};
  if (a.protocol === 'deepgram' || a.protocol === 'elevenlabs') return !!a.key;
  return !!(a.key && a.base_url);
};
// 图像服务可用性判定：腾讯云原生只需 key（SecretId:SecretKey）；混元/其他需 key + base_url
export const imageReady = () => {
  const c = read();
  if (c.image.provider === 'tencent') return !!c.image.key;
  return !!(c.image.key && c.image.base_url);
};

const mask = (k) => (k ? k.slice(0, 6) + '••••••' + k.slice(-4) : '');
export function adminView() {
  const p = read();
  return {
    base_url: p.base_url, model: p.model, protocol: p.protocol, system_prompt: p.system_prompt || '',
    key_set: !!p.key, key_masked: mask(p.key), fee: PLATFORM_FEE,
    voice: { provider: p.voice.provider, protocol: p.voice.protocol, base_url: p.voice.base_url, model: p.voice.model, voice_name: p.voice.voice_name, key_set: !!p.voice.key, key_masked: mask(p.voice.key), fee: VOICE_FEE },
    image: { provider: p.image.provider, protocol: p.image.protocol, base_url: p.image.base_url, model: p.image.model, size: p.image.size, region: p.image.region || '', styles: p.image.styles || '', resolution: p.image.resolution || '', key_set: !!p.image.key, key_masked: mask(p.image.key), fee: IMAGE_FEE },
    asr: { provider: p.asr.provider, protocol: p.asr.protocol, base_url: p.asr.base_url, model: p.asr.model, language: p.asr.language || '', key_set: !!p.asr.key, key_masked: mask(p.asr.key), ready: asrReady() },
  };
}
export function updatePlatform(body = {}) {
  const p = read();
  if (typeof body.base_url === 'string' && body.base_url.trim()) p.base_url = body.base_url.trim();
  if (typeof body.model === 'string' && body.model.trim()) p.model = body.model.trim();
  if (typeof body.protocol === 'string' && body.protocol.trim()) p.protocol = body.protocol.trim();
  if (typeof body.system_prompt === 'string') p.system_prompt = body.system_prompt;
  if (typeof body.key === 'string' && body.key.trim()) p.key = body.key.trim();
  if (body.voice && typeof body.voice === 'object') {
    ['provider', 'protocol', 'base_url', 'model', 'voice_name'].forEach(k => { if (typeof body.voice[k] === 'string') p.voice[k] = body.voice[k].trim(); });
    if (typeof body.voice.key === 'string' && body.voice.key.trim()) p.voice.key = body.voice.key.trim();
  }
  if (body.image && typeof body.image === 'object') {
    ['provider', 'protocol', 'base_url', 'model', 'size', 'region', 'styles', 'resolution'].forEach(k => { if (typeof body.image[k] === 'string') p.image[k] = body.image[k].trim(); });
    if (typeof body.image.key === 'string' && body.image.key.trim()) p.image.key = body.image.key.trim();
  }
  if (body.asr && typeof body.asr === 'object') {
    if (!p.asr) p.asr = { ...DEFAULTS.asr };
    ['provider', 'protocol', 'base_url', 'model', 'language'].forEach(k => { if (typeof body.asr[k] === 'string') p.asr[k] = body.asr[k].trim(); });
    if (typeof body.asr.key === 'string' && body.asr.key.trim()) p.asr.key = body.asr.key.trim();
  }
  write(p);
  return adminView();
}
