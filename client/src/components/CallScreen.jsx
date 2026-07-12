import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getToken, getApiBase, assetUrl } from '../api.jsx';
import { streamSSE } from '../chat/sse.js';
import { speakBrowser, stripParensForSpeech, playAudioUrl, stopSpeaking, detectEmotion } from '../voice.js';
import { Avatar } from '../ui.jsx';
import { PhoneOff, Mic, Square, Keyboard, Send, Loader2, Video, Volume2 } from 'lucide-react';

// 幻域 · 通话模式（APP 端沉浸形态）—— 给角色「打电话」。
// -----------------------------------------------------------------------------
// 全屏来电 / 通话界面：角色头像 + 脉动光环 + 通话计时 + 实时字幕。
// 语音输入优先走平台 ASR（MediaRecorder 录音 → POST /api/asr/transcribe），
// 平台未配置识别服务时回退浏览器语音识别，再不行则键盘输入。角色回复复用聊天
// SSE 流式补全（/chat/conversations/:id/complete）并用 voice.js 自动朗读。
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

export default function CallScreen({ character, onClose }) {
  const [char, setChar] = useState(character);            // 完整角色（挂载后拉取，含背景）
  const [mode, setMode] = useState(character?.background ? 'video' : 'voice');
  const touchedMode = useRef(false);                      // 用户是否手动切过语音/视频
  const [phase, setPhase] = useState('dialing');     // dialing → live
  const [seconds, setSeconds] = useState(0);
  const [subtitle, setSubtitle] = useState('');       // 角色当前这句（流式）
  const [thinking, setThinking] = useState(false);    // 生成回复中
  const [recording, setRecording] = useState(false);  // 正在录音
  const [transcribing, setTranscribing] = useState(false); // 上传识别中
  const [listening, setListening] = useState(false);  // 浏览器识别中
  const [showKeys, setShowKeys] = useState(false);
  const [draft, setDraft] = useState('');
  const [voiceCfg, setVoiceCfg] = useState(null);
  const [asrReady, setAsrReady] = useState(null);     // 平台 ASR 是否就绪（null=未知）
  const recRef = useRef(null);       // MediaRecorder
  const chunksRef = useRef([]);
  const streamRef = useRef(null);    // MediaStream（挂断时需停轨）
  const srRef = useRef(null);        // 浏览器 SpeechRecognition
  const bufRef = useRef('');
  const rafRef = useRef(0);
  const convIdRef = useRef(null);    // say() 用 ref 读，避免闭包拿到过期值
  const abortRef = useRef(null);     // 进行中的补全流（挂断/卸载时掐掉）
  const hue = ((character?.id || 7) * 47) % 360;

  // 建会话（可重入）：挂载时预建；失败或竞态时 say() 按需重建 ——
  // 旧版仅在挂载时试一次，失败后 convId 恒为 null，用户每次发送都被
  // 静默吞掉（实机「键盘输入无返回」的一类根因）。
  const createConv = useCallback(async () => {
    if (convIdRef.current) return convIdRef.current;
    const r = await fetch(getApiBase() + '/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ character_id: character.id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '无法建立通话会话');
    const cid = d.conversation?.id || null;
    if (!cid) throw new Error('无法建立通话会话');
    convIdRef.current = cid;
    return cid;
  }, [character.id]);

  // 建立会话 + 拉取语音配置 + 探测平台 ASR。
  useEffect(() => {
    let alive = true;
    (async () => {
      const H = { Authorization: `Bearer ${getToken()}` };
      try { await createConv(); } catch { /* 建会话失败仍展示界面，say() 会按需重试 */ }
      try { const s = await (await fetch(getApiBase() + '/api/settings', { headers: H })).json(); if (alive) setVoiceCfg({ voice_protocol: s.settings?.voice_protocol, voice_name: s.settings?.voice_name }); } catch { /* */ }
      try { const a = await (await fetch(getApiBase() + '/api/asr/status', { headers: H })).json(); if (alive) setAsrReady(!!a.ready); } catch { if (alive) setAsrReady(false); }
      // 拉完整角色（含背景），据此决定是否进入视频形态。
      try {
        const cd = await (await fetch(getApiBase() + '/api/characters/' + character.id, { headers: H })).json();
        if (alive && cd.character) {
          setChar(prev => ({ ...prev, ...cd.character }));
          if (!touchedMode.current) setMode(cd.character.background ? 'video' : 'voice');
        }
      } catch { /* 拉取失败则沿用列表数据 */ }
    })();
    const t = setTimeout(() => alive && setPhase('live'), 1600);
    return () => { alive = false; clearTimeout(t); };
  }, [character.id]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const speak = useCallback((text) => {
    const clean = stripParensForSpeech(text || '').trim();
    if (!clean) return;
    const emotion = detectEmotion(text);
    const browserSpeak = () => speakBrowser(clean, voiceCfg?.voice_name, character?.voice_speed, character?.voice_pitch, true, emotion);
    if (voiceCfg?.voice_protocol === 'browser' || !voiceCfg) { browserSpeak(); return; }
    fetch(getApiBase() + '/api/chat/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ text: clean, voice: character?.voice_name || undefined, speed: character?.voice_speed || undefined, pitch: character?.voice_pitch || undefined, emotion, character_id: character?.id }) })
      .then(res => res.ok ? res.blob() : Promise.reject(new Error(String(res.status))))
      .then(blob => playAudioUrl(URL.createObjectURL(blob), true))
      // 平台/自配语音不可用（未配置 503 / 金币不足 402 / 上游挂了）→ 退回
      // 本机 TTS，通话始终有声音。旧版此处静默吞掉 —— 用户体感「根本不能通话」。
      .catch(browserSpeak);
  }, [voiceCfg, character]);

  // 接通后角色先说一句开场白。
  useEffect(() => {
    if (phase !== 'live' || !character) return;
    const hello = stripParensForSpeech(character.greeting || '喂？是你呀，我在听。').slice(0, 80);
    setSubtitle(hello); speak(hello);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 说一句 → 流式取回角色回复，边到边显示字幕，收尾自动朗读。
  const say = useCallback(async (text) => {
    const content = String(text || '').trim();
    if (!content || thinking) return;
    stopSpeaking(); setThinking(true); setSubtitle(''); bufRef.current = '';
    // 90s 兜底中止：上游模型挂起时不至于把「对方正在说…」冻死在屏上
    //（服务端自身有 60s 首字节超时，这里是双保险 + 覆盖网络层悬挂）。
    const ac = new AbortController();
    abortRef.current = ac;
    const guard = setTimeout(() => ac.abort(), 90000);
    try {
      const cid = await createConv();   // 已建则直接复用；失败抛错上屏
      // 共用 chat/sse.js 的读取器；字幕仍走 rAF 节流，只显示最近 140 字。
      const full = await streamSSE(`/api/chat/conversations/${cid}/complete`, {
        body: { content },
        signal: ac.signal,
        onDelta: (delta) => {
          bufRef.current += delta;
          if (!rafRef.current) rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setSubtitle(stripParensForSpeech(bufRef.current).slice(-140)); });
        },
      });
      setSubtitle(stripParensForSpeech(full).slice(-140)); speak(full);
    } catch (e) {
      // 具体错误直接上屏（金币不足 / 模型未配置 / 超时…）——
      // 旧版一律「信号不太好」，用户无从得知也无法自救。
      if (e?.name === 'AbortError') setSubtitle('（这句等太久，掐断了 —— 再说一次试试）');
      else setSubtitle(`（${e?.message || '信号不太好，稍后再说说看…'}）`);
    } finally {
      clearTimeout(guard);
      if (abortRef.current === ac) abortRef.current = null;
      setThinking(false);
    }
  }, [thinking, speak, createConv]);

  // —— 录音 → 平台 ASR 识别 —— //
  const stopTracks = () => { try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* */ } streamRef.current = null; };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const fd = new FormData(); fd.append('audio', blob, 'call.webm');
          const r = await fetch(getApiBase() + '/api/asr/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.text) { setDraft(''); say(d.text); }
          else setSubtitle('（没太听清，再说一遍试试…）');
        } catch { setSubtitle('（识别服务开小差了，改用键盘吧）'); setShowKeys(true); }
        finally { setTranscribing(false); }
      };
      recRef.current = rec; stopSpeaking(); rec.start(); setRecording(true);
    } catch { setSubtitle('（没有麦克风权限，改用键盘吧）'); setShowKeys(true); }
  };
  const stopRecording = () => { try { recRef.current?.stop(); } catch { /* */ } setRecording(false); };

  // —— 浏览器语音识别（平台未配置 ASR 时的回退）—— //
  const browserListen = () => {
    if (listening) { srRef.current?.stop(); return; }
    const rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const tr = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += tr; else interim += tr; } setDraft(finalText || interim); };
    rec.onend = () => { setListening(false); const t = (finalText || '').trim(); setDraft(''); if (t) say(t); };
    rec.onerror = () => setListening(false);
    srRef.current = rec; stopSpeaking(); setDraft(''); setListening(true); try { rec.start(); } catch { setListening(false); }
  };

  // 麦克风主按钮：优先平台 ASR 录音；否则浏览器识别；再否则打开键盘。
  const micActive = recording || listening;
  const onMic = () => {
    if (thinking || transcribing) return;
    if (asrReady && canRecord) { recording ? stopRecording() : startRecording(); return; }
    if (SR) { browserListen(); return; }
    setShowKeys(true);
  };

  const hangup = () => { try { abortRef.current?.abort(); } catch { /* */ } try { recRef.current?.stop(); } catch { /* */ } try { srRef.current?.stop(); } catch { /* */ } stopTracks(); stopSpeaking(); onClose?.(); };
  const sendDraft = () => { const t = draft.trim(); if (!t) return; setDraft(''); say(t); };
  useEffect(() => () => { try { abortRef.current?.abort(); } catch { /* */ } stopSpeaking(); stopTracks(); try { recRef.current?.stop(); } catch { /* */ } try { srRef.current?.stop(); } catch { /* */ } }, []);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const stateText = phase === 'dialing' ? '正在接通…'
    : transcribing ? '识别中…'
    : recording ? '正在聆听…'
    : listening ? '聆听中…'
    : thinking ? '对方正在说…'
    : '通话中';
  const micLabel = recording ? '松开发送' : listening ? '停止' : transcribing ? '识别中' : '按住说';

  const bg = char?.background;
  const videoOn = mode === 'video' && !!bg;
  const toggleMode = () => { if (!bg) return; touchedMode.current = true; setMode(m => (m === 'video' ? 'voice' : 'video')); };

  return (
    <div className={'call-screen' + (videoOn ? ' video' : '')} style={{ '--call-hue': hue }}>
      {videoOn
        ? <div className="call-video">
            {char.background_type === 'video'
              ? <video src={assetUrl(bg)} muted loop autoPlay playsInline />
              : <img src={assetUrl(bg)} alt="" />}
          </div>
        : <div className="call-bg" />}
      <div className="call-scrim" />

      <div className="call-top">
        <span className="call-state">{stateText}</span>
        <span className="call-timer">{phase === 'live' ? mmss : ''}</span>
        <button className="call-modeswitch" onClick={toggleMode} disabled={!bg}
          title={!bg ? '该角色没有背景，无法视频' : videoOn ? '切换到语音' : '切换到视频'}>
          {videoOn ? <><Volume2 size={14} /> 语音</> : <><Video size={14} /> 视频</>}
        </button>
      </div>

      {/* 视频形态：角色背景铺满，头像缩为顶部小窗（PiP）；语音形态：脉动光环头像 */}
      {videoOn ? (
        <div className={'call-pip' + (thinking ? ' speaking' : '') + (micActive ? ' listening' : '')}>
          <Avatar src={char?.avatar} name={char?.name} size={72} />
        </div>
      ) : (
        <div className={'call-orb' + (phase === 'dialing' ? ' dialing' : '') + (micActive ? ' listening' : '') + (thinking ? ' speaking' : '')}>
          <span className="call-ring r1" /><span className="call-ring r2" /><span className="call-ring r3" />
          <div className="call-avatar"><Avatar src={char?.avatar} name={char?.name} size={132} /></div>
        </div>
      )}

      <div className="call-id">
        <h2>{char?.name || '角色'}</h2>
        <p>{char?.tagline || '语音陪伴 · 沉浸通话'}</p>
      </div>

      <div className="call-caption">
        {(thinking || transcribing) && !subtitle ? <span className="call-caption-wait"><Loader2 size={16} className="spin" /> {transcribing ? '正在识别你说的话…' : '正在组织语言…'}</span>
          : subtitle ? <p>{subtitle}</p>
          : <span className="call-caption-hint">{asrReady && canRecord ? '点住麦克风，开口和 TA 说话' : SR ? '点击麦克风开口说话' : '点击键盘输入你想说的话'}</span>}
      </div>

      {showKeys && (
        <div className="call-keys">
          <input value={draft} autoFocus placeholder="输入你想说的话…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendDraft(); }} />
          <button className="call-key-send" onClick={sendDraft} disabled={!draft.trim() || thinking} aria-label="发送"><Send size={18} /></button>
        </div>
      )}
      {micActive && draft && <div className="call-listening-preview">{draft}</div>}

      <div className="call-controls">
        <button className={'call-ctrl' + (micActive ? ' active' : '')} onClick={onMic} disabled={thinking || transcribing}>
          <span className="call-ctrl-ic">{recording ? <Square size={22} fill="currentColor" /> : <Mic size={24} />}</span>
          <span className="call-ctrl-tx">{micLabel}</span>
        </button>
        <button className="call-ctrl call-hangup" onClick={hangup}>
          <span className="call-ctrl-ic"><PhoneOff size={26} /></span>
          <span className="call-ctrl-tx">挂断</span>
        </button>
        <button className={'call-ctrl' + (showKeys ? ' active' : '')} onClick={() => setShowKeys(v => !v)}>
          <span className="call-ctrl-ic"><Keyboard size={24} /></span>
          <span className="call-ctrl-tx">键盘</span>
        </button>
      </div>
    </div>
  );
}
