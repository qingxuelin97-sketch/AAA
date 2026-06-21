// Chamber background music — a pre-rendered, mixed ceremonial track bundled with
// the app (client/public/audio/senate.ogg), loaded as a looping HTMLAudioElement.
// No external network, works offline. Handles autoplay policy via gesture resume.

const SRC = (import.meta.env.BASE_URL || '/') + 'audio/senate.ogg';
const LEVEL = 0.55;
let audio = null, started = false, fadeTimer = null, muted = false;

function fadeTo(target, ms) {
  if (!audio) return;
  clearInterval(fadeTimer);
  const steps = 30, start = audio.volume, dv = target - start;
  let i = 0;
  fadeTimer = setInterval(() => {
    if (!audio) { clearInterval(fadeTimer); return; }
    i++; audio.volume = Math.max(0, Math.min(1, start + dv * (i / steps)));
    if (i >= steps) clearInterval(fadeTimer);
  }, Math.max(16, ms / steps));
}

export function startBgm() {
  if (started) return;
  try {
    audio = new Audio(SRC);
    audio.loop = true; audio.preload = 'auto'; audio.volume = 0;
    started = true;
    if (!muted) audio.play().then(() => fadeTo(LEVEL, 2600)).catch(() => { /* awaits a user gesture */ });
  } catch { started = false; audio = null; }
}
export function resume() {
  if (audio && !muted && audio.paused) audio.play().then(() => fadeTo(LEVEL, 2000)).catch(() => { /* */ });
}
export function setMuted(m) {
  muted = m;
  if (!audio) return;
  if (m) { fadeTo(0, 320); setTimeout(() => { if (audio && muted) try { audio.pause(); } catch { /* */ } }, 360); }
  else { try { if (audio.paused) audio.play().catch(() => {}); } catch { /* */ } fadeTo(LEVEL, 900); }
}
export function isStarted() { return started; }
export function stopBgm() {
  if (!started) return;
  clearInterval(fadeTimer);
  const a = audio; audio = null; started = false;
  if (a) { try { a.pause(); a.src = ''; a.load(); } catch { /* */ } }
}
