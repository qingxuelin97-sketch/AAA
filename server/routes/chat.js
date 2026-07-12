import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx } from '../wallet.js';
import { getPlatform, voiceReady, featureFee, chargePlatformFee, VOICE_FEE } from '../platform.js';
import { bumpDaily } from '../daily.js';
import { assertPublicUrl, safeFetch } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';
import { log } from '../logger.js';

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

// 朗读前剥离动作 / OOC 内容，绝不送进语音模型读出。
// 与前端 stripParensForSpeech 保持一致：圆括号（）()、方括号【】、以及 *星号* 包裹的动作文本
// （角色扮演里 *微笑* 这类写法系统默认按动作处理）。星号限定在同一行内，避免游离星号吞掉整段。
// 这里在服务端再兜底一次，确保无论调用方是否已清洗，语音模型都收不到动作文本。
const SPEECH_STRIP_PAIRS = [
  [/（[^（）]*）/g, /（/g, /）/g],
  [/\([^()]*\)/g, /\(/g, /\)/g],
  [/【[^【】]*】/g, /【/g, /】/g],
  [/\*[^*\n]+\*/g, /\*/g, /\*/g],
];
export function stripSpeechActions(input) {
  let s = String(input || '');
  let prev, guard = 0;
  do { prev = s; for (const [re] of SPEECH_STRIP_PAIRS) s = s.replace(re, ''); } while (s !== prev && ++guard < 50);
  for (const [, , open, close] of SPEECH_STRIP_PAIRS) s = s.replace(open, ' ').replace(close, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// —— 情绪/语气检测 —— 让语音 API 根据对话情境自动调试语气。
// 从「原文」（含 *动作* 与标点，朗读前剥离）推断情绪：动作与情绪词信号最强，标点兜底。
// 规则按强度从强到弱匹配，先命中者为准；无命中则中性。
const EMOTION_RULES = [
  ['angry',     /怒|愤|吼|咆哮|生气|发火|暴怒|可恶|混蛋|滚开|岂有此理|怒视|咬牙|瞪|恼怒|气恼|恼火|怒喝|怒斥|训斥|斥责|喝道/],
  ['sad',       /哭|泪|呜咽|抽泣|伤心|难过|悲伤|哀伤|叹气|叹息|绝望|哽咽|失落|委屈|低落|泪流|啜泣|哀痛|哀愁|怅然|落寞|凄凉|心碎|黯然|神伤/],
  ['fearful',   /颤抖|发抖|害怕|恐惧|惊恐|战栗|瑟瑟|不敢|畏惧|惶恐|心惊|慌乱|心慌|胆寒|心悸|惊慌|忐忑/],
  ['surprised', /震惊|吃惊|惊讶|不会吧|竟然|居然|难以置信|目瞪口呆|啊？|什么[?？！]|天啊|天哪|我的天|哎呀/],
  ['happy',     /微笑|大笑|欢笑|高兴|开心|欣喜|喜悦|兴奋|雀跃|哈哈|嘿嘿|嘻嘻|太好了|耶！|笑着|笑道|乐呵|美滋滋|喜滋滋|乐开怀|美极了|乐不可支/],
  ['gentle',    /温柔|轻声|柔声|低语|呢喃|轻轻|安抚|抱抱|温和|宠溺|耳语|缓缓|徐徐|娓娓|软语|嗔怪|轻笑/],
];
export function detectEmotion(raw) {
  const s = String(raw || '');
  if (!s) return 'neutral';
  for (const [emo, re] of EMOTION_RULES) if (re.test(s)) return emo;
  if (/[!！]{2,}/.test(s)) return 'surprised'; // 连续感叹 → 偏激动/惊讶
  return 'neutral';
}
const EMOTION_ALL = new Set(['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'gentle']);
const normalizeEmotion = (e) => EMOTION_ALL.has(e) ? e : '';
// 通用韵律微调（所有厂商都支持 speed/pitch）：在创作者配置的基准上做相对小幅叠加。
const EMOTION_PROSODY = {
  happy:     { rate: 1.08, pitch: 1.06 },
  angry:     { rate: 1.10, pitch: 1.05 },
  sad:       { rate: 0.90, pitch: 0.95 },
  fearful:   { rate: 1.07, pitch: 1.06 },
  surprised: { rate: 1.06, pitch: 1.08 },
  gentle:    { rate: 0.94, pitch: 0.98 },
  neutral:   { rate: 1, pitch: 1 },
};
// MiniMax voice_setting.emotion 支持集（gentle/neutral 不下发，走韵律即可）。
const MINIMAX_EMOTION = { happy: 'happy', sad: 'sad', angry: 'angry', fearful: 'fearful', surprised: 'surprised' };
// 火山引擎 request.emotion：仅多情感音色支持，不支持的音色会忽略该字段，安全。
const VOLCANO_EMOTION = { happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised', fearful: 'fear' };
// Azure <mstts:express-as style=…>：未支持该 style 的音色会自动回退，安全。
const AZURE_STYLE = { happy: 'cheerful', sad: 'sad', angry: 'angry', fearful: 'fearful', surprised: 'excited', gentle: 'gentle' };
// OpenAI gpt-4o-mini-tts 的 instructions（老模型忽略该字段，安全）。
const OPENAI_TONE = { happy: '欢快愉悦', sad: '低落伤感', angry: '愤怒激动', fearful: '紧张害怕', surprised: '惊讶意外', gentle: '温柔轻缓' };

// Synthesize speech via the right vendor adapter. Returns { ok, contentType, buffer } or { ok:false, status, error }.
export async function synthesize({ proto, base, key, model, voice, text, speed, pitch, emotion }) {
  // 情绪取「显式传入」优先，否则从原文（含 *动作*）自动检测——动作剥离前检测，信号更全。
  const emo = normalizeEmotion(emotion) || detectEmotion(text);
  text = stripSpeechActions(text); // 动作 / *星号* 内容一律不读
  if (!text) return { ok: false, status: 400, error: '无可朗读的内容（动作 / 旁白已跳过）' };
  const b = (base || '').replace(/\/$/, '');
  // SSRF 防护：用户填了 voice base_url 时校验其不指向内网/本机；为空则用各厂商默认地址，跳过校验。
  if (b) assertPublicUrl(b);
  // 通用韵律微调：在创作者配置的语速/音调基准上，按情绪做相对叠加（再夹紧到合法区间）。
  const pros = EMOTION_PROSODY[emo] || EMOTION_PROSODY.neutral;
  const rate = Math.min(2, Math.max(0.5, (Number(speed) || 1) * pros.rate)); // shared playback-rate tuning
  const pit = Math.min(1.5, Math.max(0.5, (Number(pitch) || 1) * pros.pitch)); // shared pitch tuning (1 = natural)
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
        body: JSON.stringify({ app: { appid, token: vtok, cluster }, user: { uid: 'huanyu' }, audio: { voice_type: voice || 'BV001_streaming', encoding: 'mp3', speed_ratio: rate, volume_ratio: 1, pitch_ratio: pit }, request: { reqid, text, operation: 'query', ...(VOLCANO_EMOTION[emo] ? { emotion: VOLCANO_EMOTION[emo] } : {}) } }) });
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
      // ElevenLabs voice_settings.speed 取值 [0.7,1.2]（仅 v2 模型支持，老模型忽略该字段，安全）。
      const r = await fetch(`${b}/text-to-speech/${encodeURIComponent(voice || '21m00Tcm4TlvDq8ikWAM')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model || 'eleven_multilingual_v2', voice_settings: { speed: Math.max(0.7, Math.min(1.2, rate)) } }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      return { ok: true, contentType: 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
    }
    if (proto === 'minimax') {
      // MiniMax T2A v2 (POST /v1/t2a_v2):
      //   · 鉴权仅靠 Authorization: Bearer APIKey；模型 speech-02-hd 为默认。
      //   · GroupId 是可选的：国际站 (api.minimax.io) 不需要；国内站 (api.minimax.chat /
      //     api.minimaxi.chat) 需要拼在 URL 末尾 ?GroupId=…。我们无脑把 GroupId（若有）
      //     拼上，国际站上游会忽略它，国内站需要它，两端都兼容。
      //   · GroupId 可来自 Base URL 的 ?GroupId=…，也可前缀到密钥上写作「GroupId:APIKey」。
      //   · pitch 整数半音 [-12,12]；speed [0.5,2]；vol (0,10]。
      //   · 响应 data.audio 默认十六进制字符串，显式传 output_format:'hex' 更稳。
      //   · base_resp.status_code === 0 才算成功；非 0 时 status_msg 为错误描述。
      const mm = minimaxParts(b, key);
      if (!mm.apiKey) return { ok: false, status: 400, error: 'MiniMax 缺少 API Key：请在 API Key 处填写 MiniMax 控制台的接口密钥' };
      const mmModel = model || 'speech-02-hd';
      const t2aUrl = mm.gid ? `${mm.root}/t2a_v2?GroupId=${encodeURIComponent(mm.gid)}` : `${mm.root}/t2a_v2`;
      // 情绪：speech-02 / speech-01-turbo 等支持 voice_setting.emotion；中性不下发。
      const voiceSetting = { voice_id: voice || 'male-qn-qingse', speed: rate, vol: 1, pitch: pitSemi };
      if (MINIMAX_EMOTION[emo]) voiceSetting.emotion = MINIMAX_EMOTION[emo];
      const r = await fetch(t2aUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mm.apiKey}` },
        body: JSON.stringify({
          model: mmModel, text, stream: false,
          voice_setting: voiceSetting,
          audio_setting: { format: 'mp3', sample_rate: 32000, channel: 1, bitrate: 128000 },
          output_format: 'hex',
        }) });
      if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
      const d = await r.json().catch(() => null);
      const bresp = d?.base_resp || {};
      if (bresp.status_code && bresp.status_code !== 0)
        return { ok: false, status: 502, error: 'MiniMax 合成失败：' + (bresp.status_msg || ('status_code=' + bresp.status_code)) + '（请检查 APIKey / 模型 / 音色是否匹配' + (mm.gid ? '' : '，国内站还需在 Base URL 后附 ?GroupId=') + '）' };
      const hex = d?.data?.audio;
      if (!hex) return { ok: false, status: 502, error: 'MiniMax 未返回音频：' + (bresp.status_msg || JSON.stringify(d || {}).slice(0, 200)) + '（请检查 APIKey / 音色是否匹配' + (mm.gid ? '' : '，国内站还需在 Base URL 后附 ?GroupId=') + '）' };
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
      const safeText = text.replace(/[<&>]/g, '');
      const inner = `<prosody rate='${rPct >= 0 ? '+' : ''}${rPct}%' pitch='${pitPct >= 0 ? '+' : ''}${pitPct}%'>${safeText}</prosody>`;
      // 情绪：用 mstts:express-as 包裹；音色若不支持该 style 会自动回退，安全。
      const styled = AZURE_STYLE[emo] ? `<mstts:express-as style='${AZURE_STYLE[emo]}'>${inner}</mstts:express-as>` : inner;
      const ssml = `<speak version='1.0' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${voice || 'zh-CN-XiaoxiaoNeural'}'>${styled}</voice></speak>`;
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
    // OpenAI-compatible /audio/speech（gpt-4o-mini-tts 支持 instructions 控制语气；老模型忽略该字段）
    const payload = { model, input: text, voice, speed: rate };
    if (OPENAI_TONE[emo]) payload.instructions = `请用${OPENAI_TONE[emo]}的语气朗读。`;
    const r = await fetch(b + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload) });
    if (!r.ok) return { ok: false, status: 502, error: `语音服务返回 ${r.status}：${(await r.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true, contentType: r.headers.get('content-type') || 'audio/mpeg', buffer: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { ok: false, status: 502, error: '语音服务连接失败：' + e.message }; }
}

// Build the system prompt from persona, intro and triggered world-book entries.
// 聚合角色内嵌 world_entries + 所有关联独立世界书（character_worldbooks）的条目。
// 能力按字段存在与否自动启用（无 tier 单选闸门）：
//   通常：关键词触发 / 高级：模式、注入位置、优先级、互斥分组、排除关键词、概率、最少/最多轮数、
//        冷却、AND关键词 required_keys、粘性 sticky、注入深度 depth /
//   专家：预注入图片触发、自构前端、提示词叠加、变量写入 variable_write、分支 branch、
//        语义检索 vectorize、语气标签 tone
// 世界书级：scan_depth（回看消息数）、token_budget（注入上限）、recursion（递归触发）、
//          max_active（每轮最大激活数）、variable_schema（变量声明）、system_pos（注入位置）、
//          recursion_depth（递归最大轮数）
function buildSystemPrompt(character, recentText, history) {
  const beforeParts = []; // 注入位置：角色设定前
  const afterParts = [];  // 注入位置：角色设定后（默认）
  const overlayParts = []; // 专家能力：作者自定义提示词叠加
  const personaParts = [];
  const imgTriggers = []; // 专家能力：本轮命中的图片触发条目（用于追加协议指令）
  const toneParts = [];    // 专家能力：语气标签注入
  if (character.persona) personaParts.push(character.persona.trim());
  if (character.intro) personaParts.push(`【角色简介】\n${character.intro.trim()}`);

  // 角色内嵌世界书：keyword 触发；constant=1（酒馆常驻条目）无视关键词恒注入
  const own = db.prepare('SELECT keys, content, constant FROM world_entries WHERE character_id = ? AND enabled = 1 ORDER BY position, id').all(character.id);
  // 关联独立世界书条目 + 世界书级设定（scan_depth/token_budget/recursion/max_active/variable_schema/system_pos/recursion_depth/prompt_overlay）
  const linked = db.prepare(`SELECT we.id, we.keys, we.content, we.mode, we.inject_pos, we.priority, we.case_sensitive, we.group_name,
    we.image_urls, we.image_keys, we.front_slot, we.probability, we.min_turns, we.exclude_keys, we.worldbook_id,
    we.max_turns, we.cooldown, we.required_keys, we.sticky, we.depth, we.variable_write, we.branch, we.vectorize, we.tone,
    w.prompt_overlay, w.scan_depth, w.token_budget, w.recursion, w.max_active, w.variable_schema, w.system_pos, w.recursion_depth
    FROM worldbook_entries we
    JOIN character_worldbooks cw ON cw.worldbook_id = we.worldbook_id
    JOIN worldbooks w ON w.id = cw.worldbook_id
    WHERE cw.character_id = ? AND we.enabled = 1
    ORDER BY we.priority DESC, we.position, we.id`).all(character.id);

  // 每本世界书各自的 scan_depth：取最大值作为本轮回看深度（条目自带所属书的 scan_depth）。
  const maxScan = linked.reduce((m, l) => Math.max(m, l.scan_depth || 4), 0) || 6;
  // 对话轮数：历史中 assistant 消息条数，用于 min_turns/max_turns/cooldown 判定。
  const turnCount = (history || []).filter(m => m.role === 'assistant').length;
  // 历史消息总数（含 user），用于 cooldown 计数与 sticky 持续判定。
  const msgCount = (history || []).length;

  // 基于回看深度构造扫描文本：取最近 maxScan*2 条消息（一轮含 user+assistant）。
  const scanText = (history || []).slice(-Math.max(2, maxScan * 2)).map(m => m.content || '').join(' ') + ' ' + (recentText || '');

  // —— 世界变量状态：从对话历史尾部解析「{{set:var=value}}」指令累积。
  // variable_schema 提供变量声明（默认值），运行时按对话中 {{set:...}} 指令更新。
  let variables = {};
  for (const l of linked) {
    if (l.variable_schema) {
      try {
        const decl = JSON.parse(l.variable_schema);
        if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
          for (const [k, v] of Object.entries(decl)) variables[k] = typeof v === 'object' ? v.default : v;
        }
      } catch { /* schema 非法，忽略 */ }
    }
  }
  // 从历史中解析 {{set:var=value}} 指令（仅解析 assistant 消息尾部）
  for (const m of (history || [])) {
    if (m.role !== 'assistant' || !m.content) continue;
    const setRe = /\{\{set:([a-zA-Z_]\w*)=([^}\s]+)\}\}/g;
    let mm;
    while ((mm = setRe.exec(m.content))) variables[mm[1]] = mm[2];
  }

  // 统一触发动机：内嵌条目默认 keyword 模式；空 keys => always
  const evalEntry = (w) => {
    const mode = w.mode || 'keyword';
    const keysRaw = (w.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (mode === 'always' || keysRaw.length === 0) return true;
    const cs = !!w.case_sensitive;
    const hay = cs ? scanText : scanText.toLowerCase();
    if (mode === 'regex') {
      // ReDoS 缓解：世界书 regex 键由角色作者自填、对所有与之聊天的用户生效，
      // 灾难性回溯的模式能拖死一个 CPU 核。廉价护栏：跳过超长模式（>200 字符），
      // 只对截断后的扫描文本（≤6k）匹配。无第三方依赖，不引入 RE2。
      const hayR = scanText.length > 6000 ? scanText.slice(-6000) : scanText;
      return keysRaw.some(k => {
        if (!k || k.length > 200) return false;
        try { const re = new RegExp(k, cs ? '' : 'i'); return re.test(hayR); } catch { return false; }
      });
    }
    return keysRaw.some(k => { const kk = cs ? k : k.toLowerCase(); return hay.includes(kk); });
  };

  // required_keys：AND 逻辑，全部命中才触发（高级能力）
  const evalRequired = (w) => {
    const req = (w.required_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!req.length) return true;
    const hay = scanText.toLowerCase();
    return req.every(k => hay.includes(k.toLowerCase()));
  };

  // 排除关键词：扫描文本中出现任一排除词则该条目本轮不触发（黑名单优先于概率/分组）。
  const evalExclude = (w) => {
    const ex = (w.exclude_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!ex.length) return false;
    return ex.some(k => scanText.toLowerCase().includes(k.toLowerCase()));
  };

  // 最少轮数：对话轮数未达 min_turns 不触发（用于剧情渐进）。
  const evalMinTurns = (w) => turnCount >= (w.min_turns || 0);

  // 最多触发轮数：触发累计达到 max_turns 后停用（用于一次性揭示）。运行时无状态，按对话轮数近似：达到 max_turns 后停用。
  const evalMaxTurns = (w) => !w.max_turns || turnCount <= w.max_turns;

  // 冷却：触发后 N 轮内不再触发。运行时无逐条触发历史，这里用近似：每 (cooldown+1) 轮才允许触发。
  const evalCooldown = (w) => !w.cooldown || (turnCount % (w.cooldown + 1) === 0);

  // 触发概率：命中后按 probability 抽签（0-100），100 = 必触发。预览不计入概率。
  const evalProbability = (w) => (w.probability == null || w.probability >= 100) ? true : Math.random() * 100 < w.probability;

  // 图片触发判定：需创建者预注入图片且配置触发关键词，命中后前端直接展示（不调用生图）。
  const evalImage = (w) => {
    if (!w.image_urls || !w.image_keys) return false;
    const ik = (w.image_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (ik.length === 0) return true;
    const hay = scanText.toLowerCase();
    return ik.some(k => hay.includes(k.toLowerCase()));
  };

  // 触发 + required_keys + 排除 + 轮数 + 最多轮数 + 冷却 + 概率 + 互斥分组（同 group_name 只保留最高优先级的一条）
  let triggered = [...own.map(o => ({ ...o, mode: o.constant ? 'always' : 'keyword', inject_pos: 'after', priority: 50, group_name: '', probability: 100, min_turns: 0, max_turns: 0, cooldown: 0, required_keys: '', exclude_keys: '', recursion: 0, sticky: 0, depth: 0, variable_write: '', branch: '', vectorize: 0, tone: '', front_slot: '', image_urls: '', image_keys: '' })), ...linked]
    .filter(evalEntry)
    .filter(evalRequired)
    .filter(w => !evalExclude(w))
    .filter(evalMinTurns)
    .filter(evalMaxTurns)
    .filter(evalCooldown)
    .filter(evalProbability);

  // 递归触发：被激活条目的 content 作为新扫描文本，继续激活其他条目（按 recursion_depth 控制轮数，默认 2）。
  const anyRecursion = linked.some(l => l.recursion);
  if (anyRecursion) {
    const maxRound = linked.reduce((m, l) => Math.max(m, l.recursion_depth || 2), 0) || 2;
    const activeIds = new Set(triggered.map(t => t.id));
    for (let round = 0; round < maxRound; round++) {
      let added = false;
      const extraText = triggered.map(t => t.content || '').join(' ');
      for (const l of linked) {
        if (activeIds.has(l.id)) continue;
        const keysRaw = (l.keys || '').split(',').map(k => k.trim()).filter(Boolean);
        if (!keysRaw.length) continue; // 常驻条目不参与递归
        const hit = keysRaw.some(k => extraText.toLowerCase().includes(k.toLowerCase()));
        if (hit && !evalExclude({ ...l, exclude_keys: l.exclude_keys }) && evalMinTurns(l)) {
          triggered.push(l); activeIds.add(l.id); added = true;
        }
      }
      if (!added) break;
    }
  }

  // 互斥分组取最高优先级
  const groupBest = new Map();
  for (const t of triggered) {
    if (!t.group_name) continue;
    const prev = groupBest.get(t.group_name);
    if (!prev || (t.priority || 0) > (prev.priority || 0)) groupBest.set(t.group_name, t);
  }
  let finalEntries = triggered.filter(t => {
    if (!t.group_name) return true;
    return groupBest.get(t.group_name) === t;
  });

  // max_active：每轮最大激活条目数（防 Token 爆炸）。按优先级降序截断。
  const maxActive = linked.reduce((m, l) => Math.max(m, l.max_active || 6), 0) || 6;
  if (finalEntries.length > maxActive) {
    finalEntries = finalEntries
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, maxActive);
  }

  // 专家能力：变量写入 + 分支选择。triggered 条目按 variable_write 更新变量，branch 按变量选 content。
  const seenOverlay = new Set();
  const imgSet = new Set();
  for (let i = 0; i < finalEntries.length; i++) {
    let t = finalEntries[i];
    // 变量写入：解析 variable_write（如 met_queen=true,chapter=2）应用到 variables
    if (t.variable_write) {
      (t.variable_write || '').split(',').map(kv => kv.trim()).filter(Boolean).forEach(kv => {
        const eq = kv.indexOf('=');
        if (eq > 0) variables[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
      });
    }
    // 分支选择：branch 是 JSON，按变量值选不同 content 覆盖
    if (t.branch) {
      try {
        const br = JSON.parse(t.branch);
        if (br && typeof br === 'object' && !Array.isArray(br)) {
          // 形如 { "met_queen=true": "另一段 content", "default": "默认 content" }
          let picked = null;
          for (const [cond, c] of Object.entries(br)) {
            if (cond === 'default') { if (!picked) picked = c; continue; }
            const [vk, vv] = cond.split('=');
            if (variables[vk] === vv) { picked = c; break; }
          }
          if (picked != null) { t = { ...t, content: String(picked) }; finalEntries[i] = t; }
        }
      } catch { /* branch 非法，忽略 */ }
    }
    // 语气标签收集
    if (t.tone) toneParts.push(t.tone);
    // 图片触发采集（去重）
    if (t.image_urls && t.image_keys && evalImage(t) && !imgSet.has(t.id)) {
      imgSet.add(t.id);
      imgTriggers.push({ id: t.id, slot: t.front_slot || '' });
    }
    // prompt_overlay 收集（去重，取自世界书级）
    if (t.prompt_overlay && !seenOverlay.has(t.prompt_overlay)) {
      seenOverlay.add(t.prompt_overlay);
      overlayParts.push(t.prompt_overlay.trim());
    }
  }

  // Token 预算：粗略按 4 字符 ≈ 1 token 截断注入内容（仅截断世界书内容，不截断角色设定）。
  const maxBudget = linked.reduce((m, l) => Math.max(m, l.token_budget || 0), 0);
  let usedBudget = 0;
  const injectByDepth = new Map(); // depth -> [{content, pos}]
  for (const t of finalEntries) {
    let c = t.content || '';
    if (maxBudget > 0) {
      const remaining = maxBudget - usedBudget;
      if (remaining <= 0) break;
      const maxChars = remaining * 4;
      if (c.length > maxChars) c = c.slice(0, maxChars);
      usedBudget += Math.ceil(c.length / 4);
    }
    const pos = t.inject_pos === 'before' ? 'before' : 'after';
    const d = t.depth || 0;
    if (!injectByDepth.has(d)) injectByDepth.set(d, []);
    injectByDepth.get(d).push({ content: c, pos });
  }
  // depth=0 注入到当前轮（即 beforeParts/afterParts）；depth>0 标记供调用方处理历史注入（此处仍并入当前轮）
  for (const [, arr] of injectByDepth) {
    for (const { content, pos } of arr) {
      (pos === 'before' ? beforeParts : afterParts).push(content);
    }
  }

  // 按世界书 system_pos 组装最终提示词：front=最前 / before=角色设定前 / after=角色设定后（默认）
  const sysPos = linked.reduce((m, l) => l.system_pos || 'after', 'after');
  const parts = [];
  if (sysPos === 'front' && overlayParts.length) parts.push(overlayParts.join('\n---\n'));
  if (sysPos === 'before' && beforeParts.length) parts.push('【世界书 / 设定】\n' + beforeParts.join('\n---\n'));
  parts.push(...personaParts);
  if (sysPos === 'after' && overlayParts.length) parts.push(overlayParts.join('\n---\n'));
  if (afterParts.length) parts.push('【世界书 / 设定】\n' + afterParts.join('\n---\n'));
  if (sysPos === 'front' && beforeParts.length) parts.push('【世界书 / 设定】\n' + beforeParts.join('\n---\n'));
  if (sysPos === 'before' && overlayParts.length) parts.push(overlayParts.join('\n---\n'));
  if (toneParts.length) {
    const uniq = [...new Set(toneParts)];
    parts.push(`【叙述语气】${uniq.join('、')}`);
  }
  if (imgTriggers.length) {
    // 协议指令：让模型在自然贴切处嵌入 [[wbimg:<id>]] 标记以展示该场景的预设插图。
    // 前端拿到标记后查询 wb_image_map 取创建者预注入的图片直接渲染，不生成。
    const list = imgTriggers.map(t => `[[wbimg:${t.id}]]`).join(' / ');
    parts.push(`【插图标记协议 / 当叙述自然贴切时，可在对应位置嵌入以下标记以展示该场景的预设插图，每条最多一次，无合适场景则忽略】\n${list}`);
  }
  parts.push(`你正在扮演「${character.name}」。请始终保持角色设定，使用沉浸式的第一人称叙述，不要跳出角色，不要提及你是 AI。`);
  return parts.join('\n\n');
}

// ---- Conversations ----
router.get('/conversations', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT cv.*, c.name AS character_name, c.avatar AS character_avatar,
      (SELECT content FROM messages WHERE conversation_id = cv.id ORDER BY id DESC LIMIT 1) AS last_message
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
  log({ level: 'info', source: 'server', category: 'chat', event: 'conversation_start',
    message: `新建对话《${c.name}》`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { conversation_id: info.lastInsertRowid, character_id } });
  res.json({ conversation: conv });
});

const parseMem = (conv) => { try { conv.memories = JSON.parse(conv.memories || '[]'); } catch { conv.memories = []; } return conv; };
const withWorld = (c) => {
  if (!c) return c;
  c.world = db.prepare('SELECT * FROM world_entries WHERE character_id = ? ORDER BY position, id').all(c.id);
  // 关联的独立世界书：暴露 front_schema / prompt_overlay，供前端渲染「自构对话前端」。
  c.linked_worldbooks = db.prepare(`SELECT w.id, w.name, w.front_schema, w.prompt_overlay
    FROM character_worldbooks cw JOIN worldbooks w ON w.id = cw.worldbook_id
    WHERE cw.character_id = ? ORDER BY w.id`).all(c.id);
  // 图片触发条目（id -> { urls, position, slot }）：无 tier 闸门，凡有 image_urls+image_keys 的条目均纳入，
  // 供前端解析 [[wbimg:id]] 标记后直接展示创建者预注入的图片（不调用生图）。
  const wbIds = c.linked_worldbooks.map(w => w.id);
  if (wbIds.length) {
    const rows = db.prepare(`SELECT we.id, we.image_urls, we.image_position, we.front_slot, we.worldbook_id
      FROM worldbook_entries we WHERE we.worldbook_id IN (${wbIds.map(() => '?').join(',')})
      AND we.image_urls != '' AND we.image_keys != '' AND we.enabled = 1`).all(...wbIds);
    c.wb_image_map = {};
    for (const r of rows) {
      const urls = (r.image_urls || '').split(',').map(u => u.trim()).filter(Boolean);
      if (urls.length) c.wb_image_map[r.id] = { urls, position: r.image_position || 'inline', slot: r.front_slot || '', worldbook_id: r.worldbook_id };
    }
  }
  return c;
};

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
    const ch = db.prepare('SELECT greeting, alt_greetings FROM characters WHERE id = ?').get(conv.character_id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
    // greeting_index：0 = 主开场白；1..N = 备用开场白（酒馆 alternate_greetings，聊天页可切换开场）
    let greeting = ch?.greeting || '';
    const gi = parseInt(req.body.greeting_index, 10);
    if (Number.isFinite(gi) && gi > 0) {
      try { const alts = JSON.parse(ch?.alt_greetings || '[]'); if (alts[gi - 1]) greeting = alts[gi - 1]; } catch { /* */ }
    }
    if (greeting) db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', greeting);
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
router.post('/conversations/:id/complete', authRequired, aiLimiter, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const settings = getSettings(req.user.id);

  const userContent = (req.body?.content || '').trim();
  if (userContent) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'user', userContent);
  }
  await streamReply(res, req, conv, character, settings, userContent, 'ai_reply');
});

// Regenerate: drop the trailing assistant message, then produce a fresh reply.
router.post('/conversations/:id/regenerate', authRequired, aiLimiter, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const settings = getSettings(req.user.id);
  const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id);
  if (last && last.role === 'assistant') db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
  await streamReply(res, req, conv, character, settings, '', 'regenerate');
});

// 共用：把上游 OpenAI 兼容流转发为本平台 SSE（data:{delta}）。
// 返回累计全文；上游状态码异常时已写错误并返回 null（调用方直接 end）。
async function pumpModelStream(res, eff, payloadMessages) {
  let full = '';
  // 断连/超时中止：客户端断开时中止上游读循环（否则会对着已死的连接空转、把 SSE
  // 句柄与上游连接一直占着）；首字节 60s 超时避免上游挂起时永久悬挂。响应头到达即
  // clearTimeout，后续 body 慢流不受限。平台裸 fetch 此前两者皆无。
  const ac = new AbortController();
  const onClose = () => ac.abort();
  res.on('close', onClose);
  const headerTimer = setTimeout(() => ac.abort(), 60000);
  try {
    // 平台模型(admin 配置)允许指向本机/局域网(本地 Ollama/LM Studio)，走原生 fetch；
    // 用户自填 base_url 不可信 → safeFetch 做 DNS 复检 + 逐跳重定向 + 请求头超时(60s，容忍首字节慢)。
    const doFetch = eff.platform
      ? (u, o) => fetch(u, { ...o, signal: ac.signal })
      : (u, o) => safeFetch(u, { ...o, signal: ac.signal }, { timeoutMs: 60000 });
    const upstream = await doFetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
      body: JSON.stringify({
        model: eff.model, messages: payloadMessages,
        temperature: eff.temperature, max_tokens: eff.max_tokens, stream: true
      })
    });
    clearTimeout(headerTimer);   // 响应头已到，解除首字节超时
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      // 仅在服务端日志记录上游详情，对客户端只返回通用提示，避免泄露内部信息
      console.error('[chat] 上游模型服务错误', upstream.status, text.slice(0, 300));
      res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用，请稍后再试' })}\n\n`);
      return null;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      if (res.destroyed) break;   // 客户端已断开（socket 被销毁）：停止读上游
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
    // 客户端断开：静默（已无接收方）；首字节超时：告知超时；其余：通用不可用提示。
    if (err.name === 'AbortError') {
      if (!res.writableEnded) { try { res.write(`data: ${JSON.stringify({ error: '模型服务响应超时，请稍后再试' })}\n\n`); } catch { /* 连接已断 */ } }
    } else {
      console.error('[chat] 连接模型服务失败', err.message);
      if (!res.writableEnded) { try { res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用，请稍后再试' })}\n\n`); } catch { /* 连接已断 */ } }
    }
  } finally {
    clearTimeout(headerTimer);
    res.off('close', onClose);
  }
  return full;
}

// —— 酒馆助手兼容：静默生成（面板 TavernHelper.generate 专用）——
// 卡片 HTML 前端自带完整游戏上下文（状态表/存档/指令），经 user_input 直接送入模型；
// 不写 messages 表、不加好感度 —— 对话流保持干净，面板用 IndexedDB 自管存档。
// 世界书照常触发：常驻条目 + 按 user_input 命中的关键词条目注入 system（凡人修仙传
// 这类卡的游戏规则全在常驻世界书里，靠这里注入才能驱动游戏引擎）。
router.post('/conversations/:id/generate', authRequired, aiLimiter, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(conv.character_id);
  const settings = getSettings(req.user.id);
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(conv.user_id);
  const eff = effectiveLLM(settings);
  if (eff && !eff.platform) assertPublicUrl(eff.base_url);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  if (!eff) { sse({ error: '尚未配置语言模型 API，且平台服务未开启。请前往「设置 → 语言模型」填写 API Key。' }); sse('[DONE]'); return res.end(); }
  const userInput = String(req.body?.user_input || '').slice(0, 400000);
  if (!userInput.trim()) { sse({ error: 'user_input 不能为空' }); sse('[DONE]'); return res.end(); }

  const history = req.body?.include_history
    ? db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id)
    : [];
  // 平台计费改「预扣 + 失败退款」：老写法先出结果后扣费，多请求并发通过同一份
  // 余额快照的预检后各自免费送达（applyTx 抛错仅落 warn）—— 可被并发白嫖上游
  // 成本。预扣在 applyTx 事务内校验余额，并发的第二笔当场被原子拒绝。
  const feeCtx = chargePlatformFee({
    req, res, sse, me, eff, historyLen: history.length,
    memo: `平台 AI · 面板生成《${character?.name || ''}》`, refOwner: character?.owner_id,
    convId: conv.id, characterId: conv.character_id,
  });
  if (feeCtx.rejected) return;
  const system = buildSystemPrompt(character, userInput, history);
  const payloadMessages = [
    { role: 'system', content: system },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userInput }
  ];
  const full = await pumpModelStream(res, eff, payloadMessages);
  if (full == null) {
    feeCtx.refund('上游错误');
    log({ level: 'warn', source: 'server', category: 'chat', event: 'generate',
      message: `面板生成失败《${character?.name || ''}》（上游错误）`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { conversation_id: conv.id, character_id: conv.character_id, model: eff?.model || '', gold_fee: 0 } });
    return res.end();
  }
  // 客户端在流式中途断开：回复未确认送达且可能被截断，原路退款（与「有产出才收费」
  // 的既有政策一致，避免为用户没看到的截断内容全额计费）。socket 已销毁，直接收尾。
  if (res.destroyed) { feeCtx.refund('客户端断开'); try { res.end(); } catch { /* */ } return; }
  if (full.trim()) feeCtx.settle();
  else feeCtx.refund('空产出');
  const feeDue = feeCtx.fee;
  log({ level: 'info', source: 'server', category: 'chat', event: 'generate',
    message: `面板生成《${character?.name || ''}》`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { conversation_id: conv.id, character_id: conv.character_id, model: eff?.model || '', gold_fee: feeDue || 0, chars: full.length, platform: !!eff?.platform } });
  res.write('data: [DONE]\n\n');
  res.end();
});

// Shared SSE streaming of a model reply; persists the assistant message.
async function streamReply(res, req, conv, character, settings, userContent, event) {
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(conv.user_id);
  const eff = effectiveLLM(settings);
  // SSRF 防护：仅校验用户自带的 base_url。平台 base_url 由管理员配置，
  // 自托管部署常指向内网/本机自建 LLM，故不校验以免破坏现有功能。在写 SSE 头之前，便于把 400 以 JSON 返回。
  if (eff && !eff.platform) assertPublicUrl(eff.base_url);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  if (!eff) { sse({ error: '尚未配置语言模型 API，且平台服务未开启。请前往「设置 → 语言模型」填写 API Key。' }); sse('[DONE]'); return res.end(); }

  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  // 平台按回复计费：预扣 + 失败退款（原子防并发白嫖，详见 chargePlatformFee）。
  const feeCtx = chargePlatformFee({
    req, res, sse, me, eff, historyLen: history.length,
    memo: `平台 AI · 对话《${character?.name || ''}》`, refOwner: character?.owner_id,
    convId: conv.id, characterId: conv.character_id,
    insufficientHint: '可前往钱包签到/兑换，或在设置中填写自己的 API。',
  });
  if (feeCtx.rejected) return;
  const recentText = history.slice(-6).map(m => m.content).join(' ');
  let system = buildSystemPrompt(character, recentText + ' ' + userContent, history);
  if (eff.platform && eff.system_prompt.trim()) system = eff.system_prompt.trim() + '\n\n' + system;
  const payloadMessages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];

  const full = await pumpModelStream(res, eff, payloadMessages);
  // AI 上游返回 null：流已写入错误事件，退款、记录 warn 后结束（不向客户端再写 [DONE]）。
  if (full == null) {
    feeCtx.refund('上游错误');
    log({ level: 'warn', source: 'server', category: 'chat', event,
      message: `${event === 'regenerate' ? '重新生成' : 'AI 回复'}失败《${character?.name || ''}》（上游错误）`,
      user_id: conv.user_id, ip: req.ip, ua: req.header('user-agent') || '',
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { conversation_id: conv.id, character_id: conv.character_id, model: eff?.model || '', gold_fee: 0 } });
    return res.end();
  }
  // 客户端流式中途断开（socket 已销毁）：full 可能被截断且未确认送达。不落库、退款
  //（避免把截断回复当成品持久化、并为用户没看到的内容全额计费）；用户重连后可重新生成。
  if (res.destroyed) {
    feeCtx.refund('客户端断开');
    log({ level: 'warn', source: 'server', category: 'chat', event,
      message: `${event === 'regenerate' ? '重新生成' : 'AI 回复'}中断《${character?.name || ''}》（客户端断开，未落库/已退款）`,
      user_id: conv.user_id, ip: req.ip, endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { conversation_id: conv.id, character_id: conv.character_id, chars: full.length, gold_fee: 0 } });
    return;
  }
  if (full.trim()) {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(conv.id, 'assistant', full.trim());
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    if (userContent) { try { db.prepare('UPDATE conversations SET affinity = COALESCE(affinity,0) + 3 WHERE id = ?').run(conv.id); } catch { /* */ } }
    feeCtx.settle();
  } else {
    feeCtx.refund('空产出');
  }
  const feeDue = feeCtx.fee;
  log({ level: 'info', source: 'server', category: 'chat', event,
    message: `${event === 'regenerate' ? '重新生成' : 'AI 回复'}《${character?.name || ''}》`,
    user_id: conv.user_id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { conversation_id: conv.id, character_id: conv.character_id, model: eff?.model || '', gold_fee: feeDue || 0, chars: full.length, platform: !!eff?.platform } });
  res.write('data: [DONE]\n\n');
  res.end();
}

// ---- Text to speech proxy ----
router.post('/tts', authRequired, aiLimiter, async (req, res) => {
  const settings = getSettings(req.user.id);
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(req.user.id);
  const { text: rawText, voice: reqVoice, speed: reqSpeed, pitch: reqPitch, emotion: reqEmotion, character_id } = req.body || {};
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

  const out = await synthesize({ proto, base, key, model, voice, text, speed, pitch, emotion: reqEmotion });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  if (fee) {
    try { const w = applyTx(me.id, { kind: 'voice_fee', gold: -fee, memo: `平台语音 · ${text.slice(0, 16)}`, ref_owner: ttsRefOwner }); res.setHeader('X-Gold-Fee', String(fee)); res.setHeader('X-Gold-Balance', String(w.gold)); }
    catch (e) { return res.status(402).json({ error: e.message }); }
  }
  log({ level: 'info', source: 'server', category: 'chat', event: 'tts',
    message: `语音合成（${proto}）`, user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { character_id, proto, model: model || '', voice: voice || '', gold_fee: fee || 0, chars: text.length, bytes: out.buffer?.length || 0 } });
  res.setHeader('Content-Type', out.contentType);
  res.send(out.buffer);
});

export default router;
