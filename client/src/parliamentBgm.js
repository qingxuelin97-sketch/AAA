// Procedural ceremonial ambience for the parliament chamber — synthesized with
// the Web Audio API so it needs no external asset and works fully offline.
// A solemn sustained organ-like pad + sparse bell motif, kept quiet & dignified.

let ctx = null, master = null, lp = null, nodes = [], timer = null, started = false;
const LEVEL = 0.085;

function bellTone() {
  if (!ctx) return;
  const scale = [293.66, 329.63, 392.0, 440.0, 587.33, 659.25]; // D 五声音阶
  const t = ctx.currentTime;
  const f = scale[Math.floor(Math.random() * scale.length)];
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0006, t + 2.8);
  o.connect(g); o2.connect(g); g.connect(lp);
  o.start(t); o2.start(t); o.stop(t + 3); o2.stop(t + 3);
}

export function startBgm() {
  if (started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { _start(AC); } catch { try { if (ctx) ctx.close(); } catch { /* */ } ctx = null; started = false; }
}
function _start(AC) {
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5; lp.connect(master);

  // sustained pad — a low, open chord (D2 · A2 · D3 · F3)
  const chord = [73.42, 110.0, 146.83, 174.61];
  chord.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.16 / (i + 1.2);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045 + i * 0.017;
    const lg = ctx.createGain(); lg.gain.value = 3.2;
    lfo.connect(lg); lg.connect(o.detune); lfo.start();
    o.connect(g); g.connect(lp); o.start();
    nodes.push(o, lfo);
  });
  // gentle breathing tremolo on the master
  const trem = ctx.createOscillator(); trem.frequency.value = 0.1;
  const tg = ctx.createGain(); tg.gain.value = 0.02;
  trem.connect(tg); tg.connect(master.gain); trem.start(); nodes.push(trem);

  timer = setInterval(bellTone, 4600);
  setTimeout(bellTone, 900);
  master.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 3.5); // slow swell-in
  started = true;
  resume();
}

export function resume() { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch { /* */ } }
export function setMuted(m) { try { if (master && ctx) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.25); } catch { /* */ } }
export function isStarted() { return started; }
export function stopBgm() {
  if (!started) return;
  clearInterval(timer); timer = null;
  try { master.gain.setTargetAtTime(0, ctx.currentTime, 0.4); } catch { /* */ }
  const c = ctx;
  setTimeout(() => { try { c.close(); } catch { /* */ } }, 700);
  ctx = master = lp = null; nodes = []; started = false;
}
