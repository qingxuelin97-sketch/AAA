import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth, getApiBase, setToken } from '../api.jsx';
import { useToast, Uploader, Avatar, AvatarPicker, CoinIcon } from '../ui.jsx';
import { getThemeMode, setThemeMode, getGlass, setGlass } from '../theme.js';
import { ACCENTS, getAccent, setAccent } from '../accent.js';
import { getPerfPref, setPerfPref, resolvePerf } from '../perf.js';
import { browserVoices, speakBrowser } from '../voice.js';
import HelpCenter from '../components/HelpCenter.jsx';
import { LegalModal, LegalLinks } from '../components/LegalModal.jsx';
import { Cpu, Volume2, UserCog, SlidersHorizontal, RefreshCw, ShieldCheck, Sun, Moon, Monitor, Lock, Globe, Users, EyeOff, Trash2, Eye, Activity, Download, Upload, LifeBuoy, LayoutGrid, Scale, Check } from 'lucide-react';

// Renders a gold price; when a membership discount applies it shows the full
// price struck through next to the discounted one so VIP/SVIP can see the deal.
function Fee({ full, now, discount }) {
  if (discount < 1 && full != null && full !== now)
    return <><s style={{ color: 'var(--faint)' }}>{full}</s> <b style={{ color: 'var(--accent-2)' }}>{now}</b> 金币</>;
  return <><b>{now}</b> 金币</>;
}

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
  ['aliyun', '阿里云百炼 · 通义千问语音（Qwen-TTS）', 'https://dashscope.aliyuncs.com', 'aliyun'],
  ['baidu', '百度智能云 · 在线语音合成（度家族发音人）', 'https://tsn.baidu.com', 'baidu'],
  ['volcano', '火山引擎 · 豆包语音合成（BV 音色）', 'https://openspeech.bytedance.com', 'volcano'],
  ['tencent', '腾讯云 · 语音合成 TTS（智瑜/智聆等）', 'https://tts.tencentcloudapi.com', 'tencent'],
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

// 服务器连接已从设置页移除：原生 App 的 HTTPS 后端由构建配置注入，普通用户
// 无需、也无从改写，避免把凭据和数据误发到非官方服务器。

export default function Settings() {
  const toast = useToast();
  const nav = useNavigate();
  const { user, setUser, refreshUser } = useAuth();
  const [tab, setTab] = useState('model');
  const [legal, setLegal] = useState(null);
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
  const [glass, setGlassOn] = useState(getGlass());
  const [accent, setAccentId] = useState(getAccent());
  const changeAccent = (id) => { setAccentId(id); setAccent(id); };
  const [perf, setPerf] = useState(getPerfPref());
  const changePerf = (mode) => { setPerf(mode); setPerfPref(mode); };
  const [bvoices, setBvoices] = useState(() => browserVoices());
  // 密钥 / 密码显隐切换（移动端核对长密钥用）
  const [showSecret, setShowSecret] = useState({});
  // 注意：必须在下面 if (!s) 提前返回之前声明（hooks 数量不能随渲染变化）
  const importRef = useRef(null);
  useEffect(() => {
    const upd = () => setBvoices(browserVoices());
    upd(); try { window.speechSynthesis?.addEventListener?.('voiceschanged', upd); } catch { /* */ }
    return () => { try { window.speechSynthesis?.removeEventListener?.('voiceschanged', upd); } catch { /* */ } };
  }, []);
  const changeTheme = (mode) => { setTheme(mode); setThemeMode(mode); setS(p => p ? { ...p, theme: mode } : p); };

  useEffect(() => { api('/settings').then(d => setS(d.settings)).catch(e => toast(e.message, 'err')); }, []);
  useEffect(() => { if (user) setProfile({ display_name: user.display_name || '', bio: user.bio || '', avatar: user.avatar || '', banner: user.banner || '' }); }, [user]);
  if (!s) return (
    <div className="page" style={{ maxWidth: 760 }} aria-hidden="true">
      <div className="skel" style={{ height: 40, marginBottom: 16 }} />
      <div className="skel" style={{ height: 300 }} />
    </div>
  );
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
      const res = await fetch(getApiBase() + '/api/chat/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('huanyu_token') || '') }, body: JSON.stringify({ text: '你好，这是语音试听。' }) });
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
    try {
      const d = await api('/auth/password', { method: 'PUT', body: pwd });
      // 改密会使旧 token 全部失效；服务端为当前会话回发新 token，本机免重登。
      if (d.token) setToken(d.token);
      setPwd({ old_password: '', new_password: '' }); toast('密码已修改');
    } catch (e) { toast(e.message, 'err'); }
  };

  const clearConvs = async () => {
    if (!confirm('确定清空你的全部对话记录？此操作不可撤销。')) return;
    try { const d = await api('/settings/clear-conversations', { method: 'POST' }); toast(`已清空 ${d.removed} 段对话`); }
    catch (e) { toast(e.message, 'err'); }
  };
  const clearLocal = () => {
    try { localStorage.removeItem('recent_chars'); toast('已清除本机浏览痕迹'); } catch { toast('清除失败', 'err'); }
  };
  const exportData = async () => {
    try {
      const d = await api('/settings/export');
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `huanyu-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已导出你的数据');
    } catch (e) { toast(e.message, 'err'); }
  };

  // 导入 export 生成的 JSON 包（数据互通：网页试玩数据带入真账号）。
  // 只导创作与对话数据、经济字段不参与（端点两侧同语义校验）。
  const importData = async (file) => {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { toast('文件不是有效的 JSON', 'err'); return; }
    if (!window.confirm('将把该备份里的角色、剧本与对话作为新数据导入当前账号（金币/钻石等不受影响，重复导入会产生重复数据）。继续？')) return;
    try {
      const d = await api('/settings/import', { method: 'POST', body: data });
      const r = d.imported || {};
      toast(`导入完成：角色 ${r.characters || 0} · 剧本 ${r.scripts || 0} · 对话 ${r.conversations || 0} · 消息 ${r.messages || 0}` + (d.skipped ? `（跳过 ${d.skipped} 条）` : ''));
    } catch (e) { toast(e.message, 'err'); }
  };

  const TABS = [['model', '语言模型', Cpu], ['voice', '语音模型', Volume2], ['account', '账号安全', UserCog], ['privacy', '隐私', Lock], ['pref', '偏好', SlidersHorizontal], ['help', '帮助中心', LifeBuoy]];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>设置</h1><div className="sub">模型接入、账号安全与个性化偏好</div></div>
      </div>
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="tabs-bar">
          {TABS.map(([k, l, Ic]) => <button key={k} className={(tab === k ? 'active' : '') + ' pressable'} onClick={() => setTab(k)}><Ic size={15} style={{ verticalAlign: -2, marginRight: 5 }} />{l}</button>)}
        </div>

        {tab === 'model' && (
          <div className="card stagger-in">
            <div className="section-title"><h2>语言模型 API</h2><div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={testLLM} disabled={testing || !s.llm_api_key}>{testing ? '测试中…' : '测试连接'}</button><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div></div>
            {s.platform_fee && (
              <div className="platform-note">
                <span className="pn-ic"><ShieldCheck size={18} /></span>
                <div className="pn-tx">
                  <b>{s.platform_fee.active ? '当前正在使用平台内置语言服务' : '平台内置语言服务（备用）'}</b>
                  <p>
                    未填写自己的 API Key 时，对话由平台官方模型提供，无需任何配置即可开聊。计费：每次对话{' '}
                    <CoinIcon size={12} style={{ verticalAlign: -2 }} /> <Fee full={s.platform_fee.base_full} now={s.platform_fee.base} discount={s.platform_fee.discount} />
                    ，同一对话互动超过 {s.platform_fee.heavy_threshold} 条后{' '}
                    <CoinIcon size={12} style={{ verticalAlign: -2 }} /> <Fee full={s.platform_fee.heavy_full} now={s.platform_fee.heavy} discount={s.platform_fee.discount} />。
                    {s.platform_fee.discount < 1
                      ? <b style={{ color: 'var(--accent-2)' }}> 已含{user?.svip ? ' SVIP 5' : ' VIP 7.5'} 折会员优惠。</b>
                      : <> 开通 VIP 享 7.5 折、SVIP 享 5 折。</>}
                    {' '}填写下方自己的 API Key 即可改用自有额度、免平台扣费。
                  </p>
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <input className="input" style={{ flex: 1, minWidth: 160 }} value={s.llm_model} onChange={e => set('llm_model', e.target.value)} placeholder="gpt-4o-mini" list="model-list" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} />
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
            <div className="field"><label>API Base URL</label><input className="input" value={s.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} /></div>
            <div className="field"><label>API Key {s.llm_api_key_set && <span className="tag">已配置</span>}</label>
              <div className="secret-input">
                <input className="input" type={showSecret.llm ? 'text' : 'password'} value={s.llm_api_key || ''} onChange={e => set('llm_api_key', e.target.value)} placeholder={s.llm_api_key_set ? '••••••（留空不修改）' : 'sk-...'} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} />
                <button type="button" className="secret-toggle" onClick={() => setShowSecret(p => ({ ...p, llm: !p.llm }))} title={showSecret.llm ? '隐藏' : '显示'}>{showSecret.llm ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              <div className="hint">点「检测模型」可向服务商拉取可用模型列表再选择（需先填 Base URL 与 Key）。</div></div>
            <div className="row">
              <div className="field"><label>Temperature：{s.llm_temperature}</label><input type="range" min="0" max="2" step="0.1" value={s.llm_temperature} onChange={e => set('llm_temperature', parseFloat(e.target.value))} style={{ width: '100%' }} /></div>
              <div className="field"><label>最大回复 Token</label><input className="input" type="number" value={s.llm_max_tokens} onChange={e => set('llm_max_tokens', parseInt(e.target.value) || 1024)} /></div>
            </div>
          </div>
        )}

        {tab === 'voice' && (
          <div className="card stagger-in">
            <div className="section-title"><h2>语音模型 API</h2><div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={testVoice} disabled={testing}>{testing ? '试听中…' : '试听'}</button><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div></div>
            {s.voice_fee && (
              <div className="platform-note">
                <span className="pn-ic"><ShieldCheck size={18} /></span>
                <div className="pn-tx">
                  <b>{s.voice_fee.active ? '当前使用平台语音服务' : '平台语音朗读计费'}</b>
                  <p>
                    未填写自己的语音 API 时，朗读由平台语音提供，每句扣除{' '}
                    <CoinIcon size={12} style={{ verticalAlign: -2 }} /> <Fee full={s.voice_fee.base} now={s.voice_fee.per} discount={s.voice_fee.discount} />。
                    {s.voice_fee.discount < 1
                      ? <b style={{ color: 'var(--accent-2)' }}> 已含{user?.svip ? ' SVIP 5' : ' VIP 7.5'} 折会员优惠。</b>
                      : <> 开通 VIP 享 7.5 折、SVIP 享 5 折。</>}
                    {!s.voice_fee.ready && <span className="muted"> 平台语音暂未由管理员开启，可填写下方自有语音 API 使用。</span>}
                    {' '}填写下方自己的语音 API Key 即可改用自有额度、免平台扣费。
                  </p>
                </div>
              </div>
            )}
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>后端为每种 TTS 协议内置适配器：浏览器内置语音（免配置·离线）、OpenAI 协议族（OpenAI / Groq / 硅基流动 / DeepInfra / Lemonfox）、阿里云百炼、<b>百度智能云</b>、<b>火山引擎（豆包）</b>、<b>腾讯云</b>、ElevenLabs、MiniMax 海螺、Azure 认知语音、Google Cloud TTS、Deepgram Aura 等。密钥仅存于本地。国内厂商（百度 / 火山 / 腾讯 / 阿里）建议在服务端部署版使用，浏览器纯静态站受跨域限制。</p>
            {(() => {
              const vproto = s.voice_protocol || 'openai';
              const MODEL_PH = { openai: 'tts-1 / gpt-4o-mini-tts', elevenlabs: 'eleven_multilingual_v2', minimax: 'speech-02-hd / speech-01-turbo / speech-2.5-hd-preview', deepgram: 'aura-asteria-en', google: '（在音色处填完整 voice）', azure: '（无需填，音色即模型）', aliyun: 'qwen-tts', baidu: '（无需填）', volcano: 'volcano_tts（集群名）', tencent: '地域 Region，如 ap-guangzhou' };
              const VOICE_LB = { openai: '默认音色', elevenlabs: 'Voice ID', minimax: '音色（voice_id）', azure: 'Neural 音色名', google: 'voice name', deepgram: 'aura 音色', aliyun: '音色（Qwen-TTS）', baidu: '发音人（per）', volcano: '音色（voice_type）', tencent: '音色（VoiceType 编号）' };
              const VOICE_PH = { openai: 'alloy / nova / onyx', elevenlabs: '21m00Tcm4TlvDq8ikWAM', minimax: 'male-qn-qingse / female-shaonv', azure: 'zh-CN-XiaoxiaoNeural', google: 'cmn-CN-Wavenet-A', deepgram: 'aura-asteria-en', aliyun: 'Cherry / Ethan / Serena', baidu: '0 度小美 / 1 度小宇 / 5118 度小鹿', volcano: 'BV001_streaming / BV700_streaming', tencent: '101001 智瑜 / 101002 智聆' };
              const KEY_LB = { azure: '订阅密钥（Ocp-Apim-Subscription-Key）', google: 'API Key', deepgram: 'API Key（Token）', aliyun: 'DASHSCOPE_API_KEY', baidu: 'API Key:Secret Key', volcano: 'AppID:AccessToken', minimax: 'API Key（或 GroupId:APIKey）', tencent: 'SecretId:SecretKey' };
              const KEY_PH = vproto === 'elevenlabs' ? 'xi-api-key' : vproto === 'baidu' ? 'API Key:Secret Key（冒号分隔）' : vproto === 'volcano' ? 'AppID:AccessToken（冒号分隔）' : vproto === 'minimax' ? 'MiniMax APIKey（或 GroupId:APIKey）' : vproto === 'tencent' ? 'SecretId:SecretKey（冒号分隔）' : 'sk-...';
              const BASE_PH = { azure: 'https://eastus.tts.speech.microsoft.com', google: 'https://texttospeech.googleapis.com', deepgram: 'https://api.deepgram.com', aliyun: 'https://dashscope.aliyuncs.com', baidu: 'https://tsn.baidu.com', volcano: 'https://openspeech.bytedance.com', minimax: 'https://api.minimax.chat/v1?GroupId=你的GroupId', tencent: 'https://tts.tencentcloudapi.com' };

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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <input className="input" style={{ flex: 1, minWidth: 160 }} value={s.voice_model} onChange={e => set('voice_model', e.target.value)} placeholder={MODEL_PH[vproto] || 'model'} list="voice-model-list" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} />
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
            <div className="field"><label>API Base URL</label><input className="input" value={s.voice_base_url} onChange={e => set('voice_base_url', e.target.value)} placeholder={BASE_PH[vproto] || 'https://api.openai.com/v1'} inputMode="url" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} />
              {vproto === 'minimax' && <div className="hint">MiniMax 海螺语音：Base URL 后附上你的 GroupId，例如 <code>https://api.minimax.chat/v1?GroupId=你的GroupId</code>（也可不附、改在「API Key」处填 <b>GroupId:APIKey</b>）。模型推荐 <code>speech-02-hd</code>（默认，音质佳）/ <code>speech-2.5-hd-preview</code>（最新预览版）/ <code>speech-01-turbo</code>（更快），音色 <code>voice_id</code> 如 male-qn-qingse、female-shaonv、female-yujie、presenter_female 等。GroupId 与 APIKey 均在 MiniMax 控制台获取。</div>}
              {vproto === 'azure' && <div className="hint">Base URL 中的区域需与你的资源一致，例如 <code>https://eastus.tts.speech.microsoft.com</code>。</div>}
              {vproto === 'aliyun' && <div className="hint">阿里云百炼（DashScope）：Base URL 固定 <code>https://dashscope.aliyuncs.com</code>，模型填 <code>qwen-tts</code>，音色可选 Cherry / Ethan / Serena / Chelsie / Dylan 等。Key 为百炼控制台的 <code>DASHSCOPE_API_KEY</code>。</div>}
              {vproto === 'baidu' && <div className="hint">百度智能云：Base URL 固定 <code>https://tsn.baidu.com</code>。在「API Key」处填 <b>API Key:Secret Key</b>（用英文冒号连接，二者均来自语音技术控制台的应用）。发音人 <code>per</code> 常用：0 度小美、1 度小宇、3 度逍遥、4 度丫丫、5118 度小鹿、106 度博文、110 度小童、111 度小萌。<b>百度接口不支持浏览器跨域</b>，请在服务端部署版使用。</div>}
              {vproto === 'volcano' && <div className="hint">火山引擎（豆包语音）：Base URL 固定 <code>https://openspeech.bytedance.com</code>，模型填集群名 <code>volcano_tts</code>。在「API Key」处填 <b>AppID:AccessToken</b>（用英文冒号连接，来自火山语音控制台）。音色 <code>voice_type</code> 如 <code>BV001_streaming</code>（通用女声）、<code>BV700_streaming</code>（灿灿·多情感）等，需在控制台开通对应音色。</div>}
              {vproto === 'tencent' && <div className="hint">腾讯云语音合成：Base URL 固定 <code>https://tts.tencentcloudapi.com</code>，「模型」处填地域 Region（如 <code>ap-guangzhou</code>）。在「API Key」处填 <b>SecretId:SecretKey</b>（用英文冒号连接，来自腾讯云访问管理 CAM）。音色填 <code>VoiceType</code> 编号，如 101001 智瑜、101002 智聆、101004 智云。<b>采用 TC3 服务端签名，仅服务端部署版可用</b>（浏览器纯静态站无法直连）。</div>}</div>
            <div className="row">
              <div className="field"><label>{VOICE_LB[vproto] || '音色'}</label><input className="input" value={s.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder={VOICE_PH[vproto] || ''} /></div>
              <div className="field"><label>{KEY_LB[vproto] || 'API Key'} {s.voice_api_key_set && <span className="tag">已配置</span>}</label>
                <div className="secret-input">
                  <input className="input" type={showSecret.voice ? 'text' : 'password'} value={s.voice_api_key || ''} onChange={e => set('voice_api_key', e.target.value)} placeholder={s.voice_api_key_set ? '••••••（留空不修改）' : KEY_PH} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} />
                  <button type="button" className="secret-toggle" onClick={() => setShowSecret(p => ({ ...p, voice: !p.voice }))} title={showSecret.voice ? '隐藏' : '显示'}>{showSecret.voice ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </div>
                <div className="hint">浏览器将直连该服务商；若其未开放跨域(CORS)，纯静态站点可能无法播放，建议优先选「浏览器内置语音」、OpenAI 协议族或 ElevenLabs。</div></div>
            </div>
              </>);
            })()}
          </div>
        )}

        {tab === 'account' && (
          <>
            <div className="card stagger-in" style={{ marginBottom: 20 }}>
              <div className="section-title"><h2>个人资料</h2><button className="btn sm primary" onClick={saveProfile}>保存资料</button></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', marginBottom: 14 }}>
                <AvatarPicker value={profile.avatar} onChange={url => setProfile({ ...profile, avatar: url })} size={92} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="field" style={{ marginBottom: 10 }}><label>昵称</label><input className="input" value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" /></div>
                  <div className="muted" style={{ fontSize: 12 }}>用户名 @{user?.username}（不可更改）</div>
                </div>
              </div>
              <div className="field"><label>个人简介</label><textarea className="textarea" value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} placeholder="介绍一下你自己…" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></div>
              <div className="field"><label>主页横幅</label><Uploader value={profile.banner} onChange={url => setProfile({ ...profile, banner: url })} accept="image/*" /></div>
            </div>
            <div className="card">
              <div className="section-title"><h2>修改密码</h2><button className="btn sm" onClick={changePwd}>确认修改</button></div>
              <div className="row">
                <div className="field"><label>原密码</label>
                  <div className="secret-input">
                    <input className="input" type={showSecret.oldpwd ? 'text' : 'password'} value={pwd.old_password} onChange={e => setPwd({ ...pwd, old_password: e.target.value })} autoComplete="current-password" spellCheck={false} />
                    <button type="button" className="secret-toggle" onClick={() => setShowSecret(p => ({ ...p, oldpwd: !p.oldpwd }))} title={showSecret.oldpwd ? '隐藏' : '显示'}>{showSecret.oldpwd ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                </div>
                <div className="field"><label>新密码</label>
                  <div className="secret-input">
                    <input className="input" type={showSecret.newpwd ? 'text' : 'password'} value={pwd.new_password} onChange={e => setPwd({ ...pwd, new_password: e.target.value })} autoComplete="new-password" spellCheck={false} />
                    <button type="button" className="secret-toggle" onClick={() => setShowSecret(p => ({ ...p, newpwd: !p.newpwd }))} title={showSecret.newpwd ? '隐藏' : '显示'}>{showSecret.newpwd ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'privacy' && (
          <>
            <div className="card stagger-in" style={{ marginBottom: 20 }}>
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
              <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>导出你的全部数据，或清理本机/服务端记录。删除类操作不可撤销，请谨慎执行。</p>
              <div className="priv-data-row">
                <div><b>导出我的数据</b><div className="muted" style={{ fontSize: 12.5 }}>下载包含资料、设置、角色、剧本与对话的 JSON 备份</div></div>
                <button className="btn sm" onClick={exportData}><Download size={14} /> 导出 JSON</button>
              </div>
              <div className="priv-data-row">
                <div><b>导入数据</b><div className="muted" style={{ fontSize: 12.5 }}>把导出的 JSON 备份（含网页试玩数据）作为新数据导入本账号</div></div>
                <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
                  onChange={e => { importData(e.target.files?.[0]); e.target.value = ''; }} />
                <button className="btn sm" onClick={() => importRef.current?.click()}><Upload size={14} /> 导入 JSON</button>
              </div>
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
          <>
          <div className="card stagger-in">
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
              <div className="hint">即时生效并记忆在本机；「跟随系统」随设备深/浅色自动切换（App 内默认深色沉浸观感）。</div>
            </div>
            <div className="field">
              <label>主题色</label>
              <div className="accent-row">
                {ACCENTS.map(a => (
                  <button key={a.id} type="button" className={'accent-dot' + (accent === a.id ? ' on' : '')}
                    style={{ '--dot': a.c }} onClick={() => changeAccent(a.id)} aria-label={a.name} title={a.name}>
                    {accent === a.id && <Check size={17} strokeWidth={3} />}
                    <small>{a.name}</small>
                  </button>
                ))}
              </div>
              <div className="hint">全站按钮、导航与图表即刻换上你选的颜色，深浅色模式都会各自适配。</div>
            </div>
            <div className="field">
              <label>性能模式</label>
              <div className="theme-seg">
                {[['auto', '自动', Activity], ['high', '高画质', Sun], ['lite', '省电', Cpu]].map(([v, l, Ic]) => (
                  <button key={v} type="button" className={perf === v ? 'active' : ''} onClick={() => changePerf(v)}>
                    <Ic size={15} /> {l}
                  </button>
                ))}
              </div>
              <div className="hint">
                「省电」关闭毛玻璃模糊与持续动效、按需渲染卡片，明显降低手机/低端设备的 GPU 占用与发热；
                「高画质」始终开启全部特效。
                {perf === 'auto' && <>「自动」在 App 中默认使用静态立体效果，低端设备或持续掉帧时切省电；当前为 <b>{{ high: '高画质', balanced: '平衡', lite: '省电' }[resolvePerf('auto')]}</b>。</>}
              </div>
            </div>
            <label className="switch" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b style={{ fontSize: 14 }}>毛玻璃外观</b><div className="muted" style={{ fontSize: 12.5 }}>为卡片、侧边栏与弹窗启用磨砂玻璃质感，界面更通透灵动</div></div>
              <span><input type="checkbox" checked={glass} onChange={e => { const v = e.target.checked; setGlassOn(v); setGlass(v); }} /><span className="track" /></span>
            </label>
            <label className="switch" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b style={{ fontSize: 14 }}>显示成人 (NSFW) 内容</b><div className="muted" style={{ fontSize: 12.5 }}>开启后广场将展示标记为成人的角色与剧本</div></div>
              <span><input type="checkbox" checked={!!s.nsfw} onChange={e => set('nsfw', e.target.checked ? 1 : 0)} /><span className="track" /></span>
            </label>
            <label className="switch" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
              <div><b style={{ fontSize: 14 }}>邮件通知</b><div className="muted" style={{ fontSize: 12.5 }}>接收关注、评论与系统通知的邮件提醒</div></div>
              <span><input type="checkbox" checked={!!s.notify_email} onChange={e => set('notify_email', e.target.checked ? 1 : 0)} /><span className="track" /></span>
            </label>
          </div>
          </>
        )}

        {tab === 'help' && (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title"><h2><LifeBuoy size={17} style={{ verticalAlign: -3, marginRight: 6 }} />帮助中心</h2>
                <button className="btn sm" onClick={() => nav('/help')}>打开完整页面</button>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>常见问题与上手指引，支持搜索。也可在登录页直接访问帮助中心与产品功能。</p>
              <HelpCenter />
            </div>
            <div className="card">
              <div className="section-title"><h2><Scale size={17} style={{ verticalAlign: -3, marginRight: 6 }} />关于与条款</h2>
                <button className="btn sm" onClick={() => nav('/features')}><LayoutGrid size={14} style={{ verticalAlign: -2, marginRight: 4 }} />产品功能</button>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>本站在中华人民共和国现行法律法规下运行。点击查看平台法律文本：</p>
              <LegalLinks onOpen={setLegal} />
              <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>© 2026 幻域 HUANYU · AI 角色扮演社区平台</div>
            </div>
          </>
        )}
      </div>
      {legal && <LegalModal docKey={legal} onClose={() => setLegal(null)} onOpen={setLegal} />}
    </>
  );
}
