// Shared browser Web Speech API (TTS) helpers — zero-config, offline, CORS-free.

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
export function speakBrowser(text, voiceName, rate, pitch) {
  try {
    const synth = window.speechSynthesis; if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
    const r = Number(rate);
    if (r && r >= 0.5 && r <= 2) u.rate = r; // 语速调优
    const p = Number(pitch);
    if (p && p >= 0.5 && p <= 1.5) u.pitch = Math.max(0, Math.min(2, p)); // 音调调优
    const vs = synth.getVoices();
    const v = voiceName && vs.find(x => x.name === voiceName);
    if (v) { u.voice = v; u.lang = v.lang; }
    else { const zh = vs.find(x => /zh|cmn/i.test(x.lang)); if (zh) { u.voice = zh; u.lang = zh.lang; } }
    synth.speak(u); return true;
  } catch { return false; }
}
