// 幻域 · 语音识别（ASR / Speech-to-Text）多厂商适配层。
// -----------------------------------------------------------------------------
// 与 chat.js 的 synthesize()（TTS）对称：给定服务商协议 + 密钥 + 音频，
// 统一返回 { ok, text } 或 { ok:false, status, error }。
// 覆盖尽可能多的服务商：
//   · OpenAI 兼容族（openai / groq / siliconflow / azure / dashscope 兼容模式 /
//     fireworks / 自建 whisper 等）—— POST {base}/audio/transcriptions（multipart）
//   · Deepgram —— POST {base}/v1/listen（原始音频体）
//   · ElevenLabs Scribe —— POST {base}/v1/speech-to-text（multipart，xi-api-key）
// 其余走 OpenAI 兼容分支兜底（越来越多国内外服务商都提供该端点）。
import { assertPublicUrl } from './safeUrl.js';

// 服务商 → 默认识别模型（管理后台「检测模型」失败时的兜底候选）。
export const ASR_PROTOCOLS = ['openai', 'deepgram', 'elevenlabs'];
export const ASR_DEFAULT_MODELS = {
  openai: 'whisper-1',
  groq: 'whisper-large-v3-turbo',
  siliconflow: 'FunAudioLLM/SenseVoiceSmall',
  azure: 'whisper',
  deepgram: 'nova-2',
  elevenlabs: 'scribe_v1',
};
// 已知模型清单（无 /models 端点或需固定清单时，供管理后台「检测模型」直接列出）。
export const ASR_KNOWN_MODELS = {
  openai: ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
  groq: ['whisper-large-v3', 'whisper-large-v3-turbo', 'distil-whisper-large-v3-en'],
  siliconflow: ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'],
  deepgram: ['nova-3', 'nova-2', 'nova', 'enhanced', 'base', 'whisper-large'],
  elevenlabs: ['scribe_v1', 'scribe_v1_experimental'],
};
// 判定一个模型名是否像「识别模型」（用于从 /models 全量里过滤出 ASR 候选）。
const ASR_MODEL_HINT = /whisper|transcribe|speech[-_]?to[-_]?text|sensevoice|paraformer|asr|scribe|conformer|telespeech|nova-?\d/i;

// 把原始音频 Buffer 包成 fetch 可用的 multipart（Node18+ 的 FormData/Blob）。
function audioForm({ audio, mime = 'audio/webm', filename = 'audio.webm', model, language, extra = {} }) {
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: mime }), filename);
  if (model) fd.append('model', model);
  if (language) fd.append('language', language);
  fd.append('response_format', 'json');
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

// 统一入口。audio 为 Buffer / Uint8Array。
export async function transcribe({ proto = 'openai', base, key, model, audio, mime, filename, language }) {
  if (!audio || !audio.length) return { ok: false, status: 400, error: '没有收到音频数据' };
  const b = String(base || '').replace(/\/+$/, '');
  try {
    if (b) assertPublicUrl(b);
  } catch (e) { return { ok: false, status: 400, error: e.message }; }
  if (!key) return { ok: false, status: 400, error: '未配置识别服务密钥' };

  try {
    // —— Deepgram：原始音频体 + ?model=&language= —— //
    if (proto === 'deepgram') {
      const host = b || 'https://api.deepgram.com';
      const qs = new URLSearchParams({ model: model || 'nova-2', smart_format: 'true' });
      if (language) qs.set('language', language);
      const r = await fetch(`${host}/v1/listen?${qs}`, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': mime || 'audio/webm' },
        body: audio,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, status: 502, error: `Deepgram HTTP ${r.status}` };
      const text = d?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      return { ok: true, text };
    }

    // —— ElevenLabs Scribe：multipart + xi-api-key —— //
    if (proto === 'elevenlabs') {
      const host = b || 'https://api.elevenlabs.io/v1';
      const fd = new FormData();
      fd.append('file', new Blob([audio], { type: mime || 'audio/webm' }), filename || 'audio.webm');
      fd.append('model_id', model || 'scribe_v1');
      if (language) fd.append('language_code', language);
      const r = await fetch(`${host}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, status: 502, error: `ElevenLabs HTTP ${r.status}` };
      return { ok: true, text: d?.text || '' };
    }

    // —— OpenAI 兼容族（默认）：{base}/audio/transcriptions —— //
    const host = b || 'https://api.openai.com/v1';
    // Azure OpenAI 用 api-key 头 + api-version；其余用 Bearer。
    const headers = proto === 'azure' ? { 'api-key': key } : { Authorization: `Bearer ${key}` };
    const url = `${host}/audio/transcriptions`;
    const fd = audioForm({ audio, mime, filename, model: model || ASR_DEFAULT_MODELS[proto] || 'whisper-1', language });
    const r = await fetch(url, { method: 'POST', headers, body: fd });
    const d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: 502, error: `识别服务 HTTP ${r.status}：${(d && (d.error?.message || d.message)) || ''}`.trim() };
    // OpenAI 兼容返回 { text }；部分服务商包一层。
    const text = d?.text || d?.result?.text || d?.results?.[0]?.text || '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 502, error: '识别失败：' + e.message };
  }
}

// 真实模型检测：OpenAI 兼容族 GET {base}/models 并过滤出识别类模型；
// Deepgram / ElevenLabs 无标准 /models 端点，返回已知清单。
export async function detectAsrModels({ proto = 'openai', base, key }) {
  if (proto === 'deepgram' || proto === 'elevenlabs') {
    return { ok: true, models: ASR_KNOWN_MODELS[proto] || [], source: 'known' };
  }
  const b = String(base || '').replace(/\/+$/, '');
  if (!b) return { ok: false, status: 400, error: '请先填写 API Base URL' };
  if (!key) return { ok: false, status: 400, error: '请先填写 API Key（检测需要密钥）' };
  try { assertPublicUrl(b); } catch (e) { return { ok: false, status: 400, error: e.message }; }
  try {
    const headers = proto === 'azure' ? { 'api-key': key } : { Authorization: `Bearer ${key}` };
    const r = await fetch(`${b}/models`, { headers });
    if (!r.ok) return { ok: false, status: 502, error: `获取模型列表失败 (HTTP ${r.status})，请检查 Base URL 与 Key` };
    const d = await r.json().catch(() => null);
    const ids = (d?.data || d?.models || []).map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
    const asr = ids.filter(id => ASR_MODEL_HINT.test(id));
    // 若过滤后为空（有些服务商不在 /models 里暴露 ASR），退回全量 + 已知清单，供 GM 自选。
    const models = asr.length ? asr : [...new Set([...(ASR_KNOWN_MODELS[proto] || []), ...ids])];
    return { ok: true, models, source: asr.length ? 'filtered' : 'all' };
  } catch (e) {
    return { ok: false, status: 502, error: '获取模型列表失败：' + e.message };
  }
}
