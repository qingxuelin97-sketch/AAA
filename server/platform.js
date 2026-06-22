import db from './db.js';
import { isVip } from './wallet.js';

// Pay-per-use feature fees (gold). VIP / SVIP get the membership discount.
export const VOICE_FEE = 10;  // per spoken sentence (platform voice)
export const IMAGE_FEE = 20;  // per generated image
export const PLATFORM_FEE = { base: 10, heavy: 15, heavy_threshold: 100 };
export const memberDiscount = (u) => (u?.svip ? 0.5 : isVip(u) ? 0.75 : 1);
export const featureFee = (u, base) => Math.max(1, Math.round(base * memberDiscount(u)));

// Group-wide platform AI config (language / voice / image). Stored as JSON in
// app_config. Keys live only in the server DB and are never returned unmasked.
const DEFAULTS = {
  base_url: '', model: '', protocol: 'openai', key: '', system_prompt: '',
  voice: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', key: '', model: 'tts-1', voice_name: 'alloy' },
  image: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', key: '', model: 'gpt-image-1', size: '1024x1024' },
};

function read() {
  const row = db.prepare("SELECT value FROM app_config WHERE key='platform'").get();
  let cfg = {};
  if (row) { try { cfg = JSON.parse(row.value); } catch { cfg = {}; } }
  return { ...DEFAULTS, ...cfg, voice: { ...DEFAULTS.voice, ...(cfg.voice || {}) }, image: { ...DEFAULTS.image, ...(cfg.image || {}) } };
}
function write(cfg) {
  db.prepare("INSERT INTO app_config (key, value) VALUES ('platform', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cfg));
}

export function getPlatform() { return read(); }
export const voiceReady = () => { const c = read(); return !!(c.voice.key && c.voice.base_url); };
export const imageReady = () => { const c = read(); return !!(c.image.key && c.image.base_url); };

const mask = (k) => (k ? k.slice(0, 6) + '••••••' + k.slice(-4) : '');
export function adminView() {
  const p = read();
  return {
    base_url: p.base_url, model: p.model, protocol: p.protocol, system_prompt: p.system_prompt || '',
    key_set: !!p.key, key_masked: mask(p.key), fee: PLATFORM_FEE,
    voice: { provider: p.voice.provider, protocol: p.voice.protocol, base_url: p.voice.base_url, model: p.voice.model, voice_name: p.voice.voice_name, key_set: !!p.voice.key, key_masked: mask(p.voice.key), fee: VOICE_FEE },
    image: { provider: p.image.provider, protocol: p.image.protocol, base_url: p.image.base_url, model: p.image.model, size: p.image.size, key_set: !!p.image.key, key_masked: mask(p.image.key), fee: IMAGE_FEE },
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
    ['provider', 'protocol', 'base_url', 'model', 'size'].forEach(k => { if (typeof body.image[k] === 'string') p.image[k] = body.image[k].trim(); });
    if (typeof body.image.key === 'string' && body.image.key.trim()) p.image.key = body.image.key.trim();
  }
  write(p);
  return adminView();
}
