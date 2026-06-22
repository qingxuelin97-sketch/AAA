import React, { useEffect, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Uploader, Avatar, AvatarPicker } from '../ui.jsx';
import { getThemeMode, setThemeMode } from '../theme.js';
import { browserVoices, speakBrowser } from '../voice.js';
import { Cpu, Volume2, UserCog, SlidersHorizontal, RefreshCw, ShieldCheck, Coins, Sun, Moon, Monitor, Lock, Globe, Users, EyeOff, Trash2, Eye, Activity } from 'lucide-react';

// Providers' base URLs + wire protocol. Keys stay on the user side.
// [base, protocol]. Protocol 'openai' = OpenAI-compatible Chat Completions;
// 'anthropic' = Claude Messages API (distinct format, adapted server-side).
const LLM_PRESETS = {
  openai: ['https://api.openai.com/v1', 'openai'], anthropic: ['https://api.anthropic.com', 'anthropic'],
  deepseek: ['https://api.deepseek.com/v1', 'openai'], moonshot: ['https://api.moonshot.cn/v1', 'openai'],
  zhipu: ['https://open.bigmodel.cn/api/paas/v4', 'openai'], qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai'],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3', 'openai'], yi: ['https://api.lingyiwanwu.com/v1', 'openai'],
  stepfun: ['https://api.stepfun.com/v1', 'openai'], minimax: ['https://api.minimax.chat/v1', 'openai'],
  siliconflow: ['https://api.siliconflow.cn/v1', 'openai'], spark: ['https://spark-api-open.xf-yun.com/v1', 'openai'],
  baidu: ['https://qianfan.baidubce.com/v2', 'openai'], gemini: ['https://generativelanguage.googleapis.com/v1beta/openai', 'openai'],
  openrouter: ['https://openrouter.ai/api/v1', 'openai'], groq: ['https://api.groq.com/openai/v1', 'openai'],
  together: ['https://api.together.xyz/v1', 'openai'], mistral: ['https://api.mistral.ai/v1', 'openai'],
  ollama: ['http://localhost:11434/v1', 'openai'], lmstudio: ['http://localhost:1234/v1', 'openai'], custom: ['', 'openai']
};
const PROVIDER_OPTS = [
  ['openai', 'OpenAI'], ['anthropic', 'Anthropic Claude'], ['deepseek', 'DeepSeek 深度求索'], ['moonshot', 'Moonshot / Kimi'],
  ['zhipu', '智谱 GLM（清言）'], ['qwen', '通义千问 Qwen'], ['doubao', '字节豆包 Doubao'],
  ['yi', '零一万物 Yi'], ['stepfun', '阶跃星辰 StepFun'], ['minimax', 'MiniMax'],
  ['siliconflow', '硅基流动 SiliconFlow'], ['spark', '讯飞星火'], ['baidu', '百度文心一言'],
  ['gemini', 'Google Gemini'], ['mistral', 'Mistral AI'], ['openrouter', 'OpenRouter'], ['groq', 'Groq'],
  ['together', 'Together'], ['ollama', 'Ollama 本地'], ['lmstudio', 'LM Studio 本地'], ['custom', '自定义']
];

// Providers that genuinely expose an OpenAI-compatible POST /audio/speech
// endpoint with `Authorization: Bearer` (the exact call the backend makes).
// Anything else can be reached via 自定义 if it implements the same protocol.
// [value, label, baseUrl, protocol]. The backend has an adapter per protocol,
// so this genuinely spans multiple vendor APIs — not just one format.
const VOICE_PROVIDER_OPTS = [
  ['browser', '浏览器内置语音（免配置 · 离线 · 无需密钥）', '', 'browser'],
  ['openai', 'OpenAI（tts-1 / gpt-4o-mini-tts）', 'https://api.openai.com/v1', 'openai'],
  ['groq', 'Groq · PlayAI TTS（playai-tts）', 'https://api.groq.com/openai/v1', 'openai'],
  ['siliconflow', '硅基流动 SiliconFlow（CosyVoice2 / Fish-Speech）', 'https://api.siliconflow.cn/v1', 'openai'],
  ['deepinfra', 'DeepInfra（Kokoro 等）', 'https://api.deepinfra.com/v1/openai', 'openai'],
  ['lemonfox', 'Lemonfox.ai（OpenAI 兼容）', 'https://api.lemonfox.ai/v1', 'openai'],
  ['elevenlabs', 'ElevenLabs（多语种角色配音）', 'https://api.elevenlabs.io/v1', 'elevenlabs'],
  ['minimax', 'MiniMax 海螺语音（需 GroupId）', 'https://api.minimax.chat/v1', 'minimax'],
  ['azure', 'Azure 认知语音（Neural · SSML）', 'https://eastus.tts.speech.microsoft.com', 'azure'],
  ['google', 'Google Cloud TTS（Wavenet / Neural2）', 'https://texttospeech.googleapis.com', 'google'],
  ['deepgram', 'Deepgram Aura', 'https://api.deepgram.com', 'deepgram'],
  ['custom', '自定义（OpenAI /audio/speech 兼容）', '', 'openai']
];
const VOICE_BY_VALUE = Object.fromEntries(VOICE_PROVIDER_OPTS.map(([v, , b, p]) => [v, { base: b, proto: p }]));

export default function Settings() {
  const toast = useToast();
  const { user, setUser, refreshUser } = useAuth();
  const [tab, setTab] = useState('model');
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ display_name: '', bio: '', avatar: '', banner: '' });
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' });
  const [models, setModels] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [voiceModels, setVoiceModels] = useState([]);
  const [detectingVoice, setDetectingVoice] = useState(false);
  const [testing, setTesting] = useState(false);
  const [theme, setTheme] = useState(getThemeMode());
  const [bvoices, setBvoices] = useState(() => browserVoices());
  useEffect(() => {
    const upd = () => setBvoices(browserVoices());
    upd(); try { window.speechSynthesis?.addEventListener?.('voiceschanged', upd); } catch { /* */ }
    return () => { try { window.speechSynthesis?.removeEventListener?.('voiceschanged', upd); } catch { /* */ } };
  }, []);
  const changeTheme = (mode) => { setTheme(mode); setThemeMode(mode); setS(p => p ? { ...p, theme: mode } : p); };

  useEffect(() => { api('/settings').then(d => setS(d.settings)).catch(e => toast(e.message, 'err')); }, []);
  useEffect(() => { if (user) setProfile({ display_name: user.display_name || '', bio: user.bio || '', avatar: user.avatar || '', banner: user.banner || '' }); }, [user]);
  if (!s) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const set = (k, v) => setS(p => ({ ...p, [k]: v }));

  const saveModel = async () => {
    setBusy(true);
    try { const d = await api('/settings', { method: 'PUT', body: s }); setS(d.settings); toast('设置已保存'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const detectModels = async () => {
    setDetecting(true);
    try {
      const d = await api('/settings/models', { method: 'POST', body: { base_url: s.llm_base_url, api_key: s.llm_api_key || undefined, protocol: s.llm_protocol || 'openai' } });
      if (!d.models?.length) { toast('未返回任何模型', 'err'); return; }
      setModels(d.models);
      toast(`检测到 ${d.models.length} 个可用模型`);
    } catch (e) { toast(e.message, 'err'); } finally { setDetecting(false); }
  };
  const testLLM = async () => {
    setTesting(true);
    try {
      await api('/settings', { method: 'PUT', body: s }); // persist first so the test uses current creds
      const d = await api('/settings/test-llm', { method: 'POST', body: { base_url: s.llm_base_url, api_key: s.llm_api_key || undefined, model: s.llm_model, protocol: s.llm_protocol || 'openai' } });
      toast('连接成功 · 模型回复：' + (d.reply || 'OK'));
    } catch (e) { toast('连接失败：' + e.message, 'err'); } finally { setTesting(false); }
  };
  const testVoice = async () => {
    const proto = s.voice_protocol || 'openai';
    if (proto === 'browser') { speakBrowser('你好，这是浏览器内置语音的试听。', s.voice_name); toast('正在试听浏览器语音'); return; }
    setTesting(true);
    try {
      await api('/settings', { method: 'PUT', body: s });
      const res = await fetch('/api/chat/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('huanyu_token') || '') }, body: JSON.stringify({ text: '你好，这是语音试听。' }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
      const blob = await res.blob(); new Audio(URL.createObjectURL(blob)).play(); toast('语音试听已播放');
    } catch (e) { toast('语音失败：' + e.message, 'err'); } finally { setTesting(false); }
  };
  const detectVoiceModels = async () => {
    setDetectingVoice(true);
    try {
      const d = await api('/settings/models', { method: 'POST', body: { base_url: s.voice_base_url, api_key: s.voice_api_key || undefined, protocol: s.voice_protocol || 'openai' } });
      if (!d.models?.length) { toast('未返回任何模型', 'err'); return; }
      setVoiceModels(d.models);
      toast(`检测到 ${d.models.length} 个可用模型`);
    } catch (e) { toast(e.message, 'err'); } finally { setDetectingVoice(false); }
  };
  const saveProfile = async () => {
    try { const d = await api('/auth/me', { method: 'PUT', body: profile }); setUser(d.user); toast('资料已更新'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const changePwd = async () => {
    try { await api('/auth/password', { method: 'PUT', body: pwd }); setPwd({ old_password: '', new_password: '' }); toast('密码已修改'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const clearConvs = async () => {
    if (!confirm('确定清空你的全部对话记录？此操作不可撤销。')) return;
    try { const d = await api('/settings/clear-conversations', { method: 'POST' }); toast(`已清空 ${d.removed} 段对话`); }
    catch (e) { toast(e.message, 'err'); }
  };
  const clearLocal = () => {
    try { localStorage.removeItem('recent_chars'); toast('已清除本机浏览痕迹'); } catch { toast('清除失败', 'err'); }
  };

  const TABS = [['model', '语言模型', Cpu], ['voice', '语音模型', Volume2], ['account', '账号安全', UserCog], ['privacy', '隐私', Lock], ['pref', '偏好', SlidersHorizontal]];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>设置</h1><div className="sub">模型接入、账号安全与个性化偏好</div></div>
      </div>
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="tabs-bar">
          {TABS.map(([k, l, Ic]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Ic size={15} style={{ verticalAlign: -2, marginRight: 5 }} />{l}</button>)}
        </div>

        {tab === 'model' && (
          <div className="card">
            <div className="section-title"><h2>语言模型 API</h2><div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={testLLM} disabled={testing || !s.llm_api_key}>{testing ? '测试中…' : '测试连接'}</button><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div></div>
            {s.using_platform && (
              <div className="platform-note">
                <span className="pn-ic"><ShieldCheck size={18} /></span>
                <div className="pn-tx">
                  <b>当前正在使用平台内置语言服务</b>
                  <p>未填写自己的 API Key 时，对话将自动由平台官方模型提供，无需任何配置即可开聊。
                  {s.platform_fee && <> 每次对话扣除 <b><Coins size={12} style={{ verticalAlign: -2 }} /> {s.platform_fee.base} 金币</b>；同一对话互动超过 {s.platform_fee.heavy_threshold} 条后按 <b>{s.platform_fee.heavy} 金币</b>计费{s.platform_fee.discount < 1 && <>（会员已享 {Math.round(s.platform_fee.discount * 10)} 折优惠）</>}。</>}
                  填写下方自己的 API Key 即可改用自有额度、免平台扣费。</p>
                </div>
              </div>
            )}
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>兼容 OpenAI Chat Completions 与 Anthropic Claude 两套协议，可接入任意服务商（含本地 Ollama / LM Studio）。密钥仅存于本地。当前协议：<b>{(s.llm_protocol || 'openai') === 'anthropic' ? 'Anthropic Messages' : 'OpenAI Compatible'}</b>。</p>
            <div className="row">
              <div className="field"><label>服务商预设</label>
                <select className="select" value={s.llm_provider} onChange={e => { const p = e.target.value; const pr = LLM_PRESETS[p]; set('llm_provider', p); if (pr) { set('llm_base_url', pr[0]); set('llm_protocol', pr[1]); } }}>
                  {PROVIDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="field"><label>模型名称</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} value={s.llm_model} onChange={e => set('llm_model', e.target.value)} placeholder="gpt-4o-mini" list="model-list" />
                  <button className="btn" onClick={detectModels} disabled={detecting} title="检测服务商可用模型">
                    <RefreshCw size={15} className={detecting ? 'spin' : ''} /> {detecting ? '检测中' : '检测模型'}
                  </button>
                </div>
                {models.length > 0 && (
                  <>
                    <datalist id="model-list">{models.map(m => <option key={m} value={m} />)}</datalist>
                    <select className="select" style={{ marginTop: 8 }} value={models.includes(s.llm_model) ? s.llm_model : ''} onChange={e => e.target.value && set('llm_model', e.target.value)}>
                      <option value="">— 从检测到的 {models.length} 个模型中选择 —</option>
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
            <div className="field"><label>API Base URL</label><input className="input" value={s.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} /></div>
            <div className="field"><label>API Key {s.llm_api_key_set && <span className="tag">已配置</span>}</label>
              <input className="input" type="password" value={s.llm_api_key || ''} onChange={e => set('llm_api_key', e.target.value)} placeholder={s.llm_api_key_set ? '••••••（留空不修改）' : 'sk-...'} />
              <div className="hint">点「检测模型」可向服务商拉取可用模型列表再选择（需先填 Base URL 与 Key）。</div></div>
            <div className="row">
              <div className="field"><label>Temperature：{s.llm_temperature}</label><input type="range" min="0" max="2" step="0.1" value={s.llm_temperature} onChange={e => set('llm_temperature', parseFloat(e.target.value))} style={{ width: '100%' }} /></div>
              <div className="field"><label>最大回复 Token</label><input className="input" type="number" value={s.llm_max_tokens} onChange={e => set('llm_max_tokens', parseInt(e.target.value) || 1024)} /></div>
            </div>
          </div>
        )}

        {tab === 'voice' && (
          <div className="card">
            <div className="section-title"><h2>语音模型 API</h2><div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={testVoice} disabled={testing}>{testing ? '试听中…' : '试听'}</button><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div></div>
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>后端为每种 TTS 协议内置适配器：浏览器内置语音（免配置·离线）、OpenAI 协议族（OpenAI / Groq / 硅基流动 / DeepInfra / Lemonfox）、ElevenLabs、MiniMax 海螺、Azure 认知语音、Google Cloud TTS、Deepgram Aura 等。密钥仅存于本地。</p>
            {(() => {
              const vproto = s.voice_protocol || 'openai';
              const MODEL_PH = { openai: 'tts-1 / gpt-4o-mini-tts', elevenlabs: 'eleven_multilingual_v2', minimax: 'speech-01-turbo', deepgram: 'aura-asteria-en', google: '（在音色处填完整 voice）', azure: '（无需填，音色即模型）' };
              const VOICE_LB = { openai: '默认音色', elevenlabs: 'Voice ID', minimax: 'voice_id', azure: 'Neural 音色名', google: 'voice name', deepgram: 'aura 音色' };
              const VOICE_PH = { openai: 'alloy / nova / onyx', elevenlabs: '21m00Tcm4TlvDq8ikWAM', minimax: 'male-qn-qingse', azure: 'zh-CN-XiaoxiaoNeural', google: 'cmn-CN-Wavenet-A', deepgram: 'aura-asteria-en' };
              const KEY_LB = { azure: '订阅密钥（Ocp-Apim-Subscription-Key）', google: 'API Key', deepgram: 'API Key（Token）' };
              const KEY_PH = vproto === 'elevenlabs' ? 'xi-api-key' : 'sk-...';
              const BASE_PH = { azure: 'https://eastus.tts.speech.microsoft.com', google: 'https://texttospeech.googleapis.com', deepgram: 'https://api.deepgram.com' };

              // ---- Browser Web Speech: zero-config, no key/base ----
              if (vproto === 'browser') {
                return (<>
                  <div className="field"><label>服务商预设</label>
                    <select className="select" value={s.voice_provider || 'openai'} onChange={e => { const p = e.target.value; const info = VOICE_BY_VALUE[p] || {}; set('voice_provider', p); set('voice_protocol', info.proto || 'openai'); if (info.base) set('voice_base_url', info.base); }}>
                      {VOICE_PROVIDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></div>
                  <div className="field"><label>音色（系统语音 · 共 {bvoices.length} 个）</label>
                    <select className="select" value={s.voice_name || ''} onChange={e => set('voice_name', e.target.value)}>
                      <option value="">自动（优先中文）</option>
                      {bvoices.map(v => <option key={v.name} value={v.name}>{v.name} · {v.lang}</option>)}
                    </select>
                    <div className="hint">使用浏览器/系统自带的语音合成，<b>无需 API Key、无跨域限制、可离线</b>。不同系统可用音色不同（移动端可能较少）。</div></div>
                  <button className="btn" onClick={() => speakBrowser('幻域欢迎你，这是浏览器内置语音的试听。', s.voice_name)}><Volume2 size={15} /> 试听当前音色</button>
                </>);
              }
              return (<>
            <div className="row">
              <div className="field"><label>服务商预设</label>
                <select className="select" value={s.voice_provider || 'openai'} onChange={e => { const p = e.target.value; const info = VOICE_BY_VALUE[p] || {}; set('voice_provider', p); set('voice_protocol', info.proto || 'openai'); if (info.base) set('voice_base_url', info.base); }}>
                  {VOICE_PROVIDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="field"><label>模型</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} value={s.voice_model} onChange={e => set('voice_model', e.target.value)} placeholder={MODEL_PH[vproto] || 'model'} list="voice-model-list" />
                  <button className="btn" onClick={detectVoiceModels} disabled={detectingVoice} title="检测服务商可用模型">
                    <RefreshCw size={15} className={detectingVoice ? 'spin' : ''} /> {detectingVoice ? '检测中' : '检测模型'}
                  </button>
                </div>
                {voiceModels.length > 0 && (
                  <>
                    <datalist id="voice-model-list">{voiceModels.map(m => <option key={m} value={m} />)}</datalist>
                    <select className="select" style={{ marginTop: 8 }} value={voiceModels.includes(s.voice_model) ? s.voice_model : ''} onChange={e => e.target.value && set('voice_model', e.target.value)}>
                      <option value="">— 从检测到的 {voiceModels.length} 个模型中选择 —</option>
                      {voiceModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
            <div className="field"><label>API Base URL</label><input className="input" value={s.voice_base_url} onChange={e => set('voice_base_url', e.target.value)} placeholder={BASE_PH[vproto] || 'https://api.openai.com/v1'} />
              {vproto === 'minimax' && <div className="hint">MiniMax 需在 Base URL 后附上你的 GroupId，例如 <code>https://api.minimax.chat/v1?GroupId=你的GroupId</code>。</div>}
              {vproto === 'azure' && <div className="hint">Base URL 中的区域需与你的资源一致，例如 <code>https://eastus.tts.speech.microsoft.com</code>。</div>}</div>
            <div className="row">
              <div className="field"><label>{VOICE_LB[vproto] || '音色'}</label><input className="input" value={s.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder={VOICE_PH[vproto] || ''} /></div>
              <div className="field"><label>{KEY_LB[vproto] || 'API Key'} {s.voice_api_key_set && <span className="tag">已配置</span>}</label>
                <input className="input" type="password" value={s.voice_api_key || ''} onChange={e => set('voice_api_key', e.target.value)} placeholder={s.voice_api_key_set ? '••••••（留空不修改）' : KEY_PH} />
                <div className="hint">浏览器将直连该服务商；若其未开放跨域(CORS)，纯静态站点可能无法播放，建议优先选「浏览器内置语音」、OpenAI 协议族或 ElevenLabs。</div></div>
            </div>
              </>);
            })()}
          </div>
        )}

        {tab === 'account' && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-title"><h2>个人资料</h2><button className="btn sm primary" onClick={saveProfile}>保存资料</button></div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 14 }}>
                <AvatarPicker value={profile.avatar} onChange={url => setProfile({ ...profile, avatar: url })} size={92} />
                <div style={{ flex: 1 }}>
                  <div className="field" style={{ marginBottom: 10 }}><label>昵称</label><input className="input" value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} /></div>
                  <div className="muted" style={{ fontSize: 12 }}>用户名 @{user?.username}（不可更改）</div>
                </div>
              </div>
              <div className="field"><label>个人简介</label><textarea className="textarea" value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} placeholder="介绍一下你自己…" /></div>
              <div className="field"><label>主页横幅</label><Uploader value={profile.banner} onChange={url => setProfile({ ...profile, banner: url })} accept="image/*" /></div>
            </div>
            <div className="card">
              <div className="section-title"><h2>修改密码</h2><button className="btn sm" onClick={changePwd}>确认修改</button></div>
              <div className="row">
                <div className="field"><label>原密码</label><input className="input" type="password" value={pwd.old_password} onChange={e => setPwd({ ...pwd, old_password: e.target.value })} /></div>
                <div className="field"><label>新密码</label><input className="input" type="password" value={pwd.new_password} onChange={e => setPwd({ ...pwd, new_password: e.target.value })} /></div>
              </div>
            </div>
          </>
        )}

        {tab === 'privacy' && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-title"><h2><ShieldCheck size={17} style={{ verticalAlign: -3, marginRight: 6 }} />隐私与可见性</h2><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div>
              <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>掌控谁能看到你、谁能联系你，以及你的数据如何被使用。设置即时保存于账号。</p>

              <div className="field">
                <label><Globe size={13} style={{ verticalAlign: -2, marginRight: 5 }} />主页可见范围</label>
                <div className="seg seg-3">
                  {[['public', '所有人'], ['followers', '仅关注者'], ['private', '仅自己']].map(([v, l]) => (
                    <button key={v} type="button" className={(s.privacy_profile || 'public') === v ? 'active' : ''} onClick={() => set('privacy_profile', v)}>{l}</button>
                  ))}
                </div>
                <div className="hint">控制谁可以浏览你的个人主页、作品与资料。</div>
              </div>

              <div className="field">
                <label><Users size={13} style={{ verticalAlign: -2, marginRight: 5 }} />谁可以私信我</label>
                <div className="seg seg-3">
                  {[['all', '所有人'], ['followers', '仅关注者'], ['none', '关闭私信']].map(([v, l]) => (
                    <button key={v} type="button" className={(s.allow_dm || 'all') === v ? 'active' : ''} onClick={() => set('allow_dm', v)}>{l}</button>
                  ))}
                </div>
              </div>

              {[
                ['show_online', '显示在线状态', '允许他人看到你当前是否在线', Activity],
                ['discoverable', '允许被搜索与推荐', '关闭后你的角色与主页不会出现在搜索 / 推荐中', Eye],
                ['activity_visible', '公开我的动态', '在社区与主页展示我发布的动态与互动', Globe],
                ['leaderboard_visible', '出现在排行榜', '关闭后你不会出现在任何排行榜上', Users],
                ['read_receipts', '已读回执', '关闭后不向对方发送 / 显示已读状态', EyeOff],
                ['personalize', '个性化推荐', '依据你的浏览与互动优化广场推荐内容', SlidersHorizontal],
              ].map(([k, t, d, Ic]) => (
                <label className="switch priv-row" key={k}>
                  <div className="priv-tx"><span className="priv-ic"><Ic size={15} /></span><div><b>{t}</b><div className="muted" style={{ fontSize: 12.5 }}>{d}</div></div></div>
                  <span><input type="checkbox" checked={!!s[k]} onChange={e => set(k, e.target.checked ? 1 : 0)} /><span className="track" /></span>
                </label>
              ))}
            </div>

            <div className="card priv-danger">
              <div className="section-title"><h2><Trash2 size={16} style={{ verticalAlign: -3, marginRight: 6 }} />数据管理</h2></div>
              <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>这些操作不可撤销，请谨慎执行。</p>
              <div className="priv-data-row">
                <div><b>清除本机浏览痕迹</b><div className="muted" style={{ fontSize: 12.5 }}>清空「最近浏览」等仅存于本设备的记录</div></div>
                <button className="btn sm" onClick={clearLocal}><EyeOff size={14} /> 清除痕迹</button>
              </div>
              <div className="priv-data-row">
                <div><b>清空全部对话记录</b><div className="muted" style={{ fontSize: 12.5 }}>永久删除你与所有角色的对话与消息</div></div>
                <button className="btn sm danger" onClick={clearConvs}><Trash2 size={14} /> 清空对话</button>
              </div>
            </div>
          </>
        )}

        {tab === 'pref' && (
          <div className="card">
            <div className="section-title"><h2>偏好设置</h2><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div>
            <div className="field">
              <label>外观主题</label>
              <div className="theme-seg">
                {[['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '跟随系统', Monitor]].map(([v, l, Ic]) => (
                  <button key={v} type="button" className={theme === v ? 'active' : ''} onClick={() => changeTheme(v)}>
                    <Ic size={15} /> {l}
                  </button>
                ))}
              </div>
              <div className="hint">即时生效并记忆在本机；「跟随系统」会随设备深/浅色自动切换。</div>
            </div>
            <label className="switch" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b style={{ fontSize: 14 }}>显示成人 (NSFW) 内容</b><div className="muted" style={{ fontSize: 12.5 }}>开启后广场将展示标记为成人的角色与剧本</div></div>
              <span><input type="checkbox" checked={!!s.nsfw} onChange={e => set('nsfw', e.target.checked ? 1 : 0)} /><span className="track" /></span>
            </label>
            <label className="switch" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
              <div><b style={{ fontSize: 14 }}>邮件通知</b><div className="muted" style={{ fontSize: 12.5 }}>接收关注、评论与系统通知的邮件提醒</div></div>
              <span><input type="checkbox" checked={!!s.notify_email} onChange={e => set('notify_email', e.target.checked ? 1 : 0)} /><span className="track" /></span>
            </label>
          </div>
        )}
      </div>
    </>
  );
}
