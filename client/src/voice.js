// Shared browser Web Speech API (TTS) helpers — zero-config, offline, CORS-free.
//
// 全局单例播放：同一时刻只允许一段朗读在播放。重复点击不会叠加 —— 已生成的语音
// 不会被重新合成（平台语音按句计费，重复合成既费钱又会多段同时出声），用户只能
// 「停止播放」或「再听一遍」（重放已生成音频）。状态通过 onVoiceStateChange 广播，
// 供 UI 切换「朗读 / 停止 / 再听一遍」按钮。

// 去除括号 / 星号及其包裹的内容（动作 / OOC 说明），朗读时默认不读。
// 支持中英文圆括号、中方括号【】，以及 *星号* 包裹的动作文本（角色扮演里 *微笑* 这类写法，
// 系统默认按动作处理，不计入朗读范围）；通过迭代处理嵌套；不处理「」『』《》等台词/书名引用。
// 注意：星号动作限定在同一行内（[^*\n]+），避免单个游离星号吞掉整段文本。
const PAREN_PAIRS = [
  [/（[^（）]*）/g, /（/g, /）/g],
  [/\([^()]*\)/g, /\(/g, /\)/g],
  [/【[^【】]*】/g, /【/g, /】/g],
  [/\*[^*\n]+\*/g, /\*/g, /\*/g],
];
export function stripParensForSpeech(input) {
  let s = String(input || '');
  let prev;
  // 反复剥离最内层括号，直到无变化（支持任意嵌套层数）
  let guard = 0;
  do {
    prev = s;
    for (const [re] of PAREN_PAIRS) s = s.replace(re, '');
  } while (s !== prev && ++guard < 50);
  // 残留的未配对括号字符也清掉，避免单独读出
  for (const [, , open, close] of PAREN_PAIRS) s = s.replace(open, ' ').replace(close, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// —— 情绪/语气检测 —— 与服务端 detectEmotion 保持一致：从「原文」（含 *动作* 与标点）推断语气。
// 朗读时据此微调浏览器语音的语速/音调，并把情绪传给平台语音 API（让其调试语气）。
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
  if (/[!！]{2,}/.test(s)) return 'surprised';
  return 'neutral';
}
const EMOTION_PROSODY = {
  happy:     { rate: 1.08, pitch: 1.06 },
  angry:     { rate: 1.10, pitch: 1.05 },
  sad:       { rate: 0.90, pitch: 0.95 },
  fearful:   { rate: 1.07, pitch: 1.06 },
  surprised: { rate: 1.06, pitch: 1.08 },
  gentle:    { rate: 0.94, pitch: 0.98 },
  neutral:   { rate: 1, pitch: 1 },
};

export function browserVoices() {
  try { return (window.speechSynthesis?.getVoices() || []); } catch { return []; }
}

// —— 单例播放状态 ——
let _audio = null;        // 平台语音的 <audio> 元素
let _token = 0;           // 单调递增令牌；每次开播/停止都自增，使旧的 onend 回调失效
let _playingId = null;    // 当前正在播放的标识（消息 id 或 true）
const _listeners = new Set();

function emit() { for (const cb of _listeners) { try { cb(_playingId); } catch { /* noop */ } } }
function setPlaying(id) { if (_playingId === id) return; _playingId = id; emit(); }

// 订阅播放状态变化，回调参数为当前播放标识（无播放时为 null）。返回取消订阅函数。
export function onVoiceStateChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
export function currentVoiceId() { return _playingId; }

// 停止当前所有朗读（浏览器语音 + 平台音频）。
export function stopSpeaking() {
  _token++;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* noop */ }
  if (_audio) { try { _audio.pause(); } catch { /* noop */ } _audio = null; }
  setPlaying(null);
}

// 浏览器内置 TTS（离线、无 CORS、免费）。playId 用于状态联动；返回是否成功开播。
// emotion 可显式传入，否则按文本自动检测，用于在配置基准上微调语速/音调，模拟语气变化。
export function speakBrowser(text, voiceName, rate, pitch, playId, emotion) {
  try {
    const synth = window.speechSynthesis; if (!synth) return false;
    stopSpeaking();
    const token = _token; // stopSpeaking 已自增，此处即本次播放令牌
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
    const emo = (emotion && EMOTION_PROSODY[emotion]) ? emotion : detectEmotion(text);
    const pros = EMOTION_PROSODY[emo] || EMOTION_PROSODY.neutral;
    const r = (Number(rate) || 1) * pros.rate;
    if (r && r >= 0.5 && r <= 2) u.rate = r; // 语速调优（叠加情绪）
    const p = (Number(pitch) || 1) * pros.pitch;
    if (p && p >= 0.5 && p <= 1.5) u.pitch = Math.max(0, Math.min(2, p)); // 音调调优（叠加情绪）
    const vs = synth.getVoices();
    const v = voiceName && vs.find(x => x.name === voiceName);
    if (v) { u.voice = v; u.lang = v.lang; }
    else { const zh = vs.find(x => /zh|cmn/i.test(x.lang)); if (zh) { u.voice = zh; u.lang = zh.lang; } }
    const done = () => { if (token === _token) setPlaying(null); };
    u.onend = done; u.onerror = done;
    synth.speak(u);
    setPlaying(playId == null ? true : playId);
    return true;
  } catch { return false; }
}

// 播放一段已生成的音频 URL（不重新合成）。用于平台语音的首播与「再听一遍」。
export function playAudioUrl(url, playId) {
  stopSpeaking();
  const token = _token;
  const a = new Audio(url);
  _audio = a;
  const done = () => { if (token === _token) { _audio = null; setPlaying(null); } };
  a.onended = done; a.onerror = done;
  a.play().catch(() => { /* 自动播放被拦截时静默 */ });
  setPlaying(playId == null ? true : playId);
  return a;
}
