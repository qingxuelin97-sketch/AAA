// Shared browser Web Speech API (TTS) helpers — zero-config, offline, CORS-free.
//
// 全局单例播放：同一时刻只允许一段朗读在播放。重复点击不会叠加 —— 已生成的语音
// 不会被重新合成（平台语音按句计费，重复合成既费钱又会多段同时出声），用户只能
// 「停止播放」或「再听一遍」（重放已生成音频）。状态通过 onVoiceStateChange 广播，
// 供 UI 切换「朗读 / 停止 / 再听一遍」按钮。

// 去除括号及其包裹的内容（动作 / OOC 说明），朗读时默认不读。
// 支持中英文圆括号、中方括号【】并通过迭代处理嵌套；不处理「」『』《》等台词/书名引用。
const PAREN_PAIRS = [
  [/（[^（）]*）/g, /（/g, /）/g],
  [/\([^()]*\)/g, /\(/g, /\)/g],
  [/【[^【】]*】/g, /【/g, /】/g],
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
export function speakBrowser(text, voiceName, rate, pitch, playId) {
  try {
    const synth = window.speechSynthesis; if (!synth) return false;
    stopSpeaking();
    const token = _token; // stopSpeaking 已自增，此处即本次播放令牌
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
    const r = Number(rate);
    if (r && r >= 0.5 && r <= 2) u.rate = r; // 语速调优
    const p = Number(pitch);
    if (p && p >= 0.5 && p <= 1.5) u.pitch = Math.max(0, Math.min(2, p)); // 音调调优
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
