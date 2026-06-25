// Shared browser Web Speech API (TTS) helpers — zero-config, offline, CORS-free.
export function browserVoices() {
  try { return (window.speechSynthesis?.getVoices() || []); } catch { return []; }
}
export function speakBrowser(text, voiceName, rate) {
  try {
    const synth = window.speechSynthesis; if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
    const r = Number(rate);
    if (r && r >= 0.5 && r <= 2) u.rate = r; // 语速调优
    const vs = synth.getVoices();
    const v = voiceName && vs.find(x => x.name === voiceName);
    if (v) { u.voice = v; u.lang = v.lang; }
    else { const zh = vs.find(x => /zh|cmn/i.test(x.lang)); if (zh) { u.voice = zh; u.lang = zh.lang; } }
    synth.speak(u); return true;
  } catch { return false; }
}
