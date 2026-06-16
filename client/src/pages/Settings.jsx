import React, { useEffect, useState } from 'react';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';

const LLM_PRESETS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  custom: ''
};

export default function Settings() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/settings').then(d => setS(d.settings)).catch(e => toast(e.message, 'err')); }, []);
  if (!s) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const set = (k, v) => setS(p => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    try { const d = await api('/settings', { method: 'PUT', body: s }); setS(d.settings); toast('设置已保存 ✓'); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>设置</h1><div className="sub">接入你自己的语言模型与语音模型服务商</div></div>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存设置'}</button>
      </div>
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="section-title"><h2>🔌 语言模型 API</h2></div>
          <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>兼容 OpenAI Chat Completions 格式。可使用平台外的任意服务商，密钥仅保存在服务器，不会回传给前端。</p>
          <div className="row">
            <div className="field"><label>服务商预设</label>
              <select className="select" value={s.llm_provider} onChange={e => {
                const p = e.target.value; set('llm_provider', p);
                if (LLM_PRESETS[p]) set('llm_base_url', LLM_PRESETS[p]);
              }}>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="moonshot">Moonshot / Kimi</option>
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="field"><label>模型名称</label>
              <input className="input" value={s.llm_model} onChange={e => set('llm_model', e.target.value)} placeholder="gpt-4o-mini / deepseek-chat …" /></div>
          </div>
          <div className="field"><label>API Base URL</label>
            <input className="input" value={s.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} placeholder="https://api.openai.com/v1" /></div>
          <div className="field"><label>API Key {s.llm_api_key_set && <span className="tag">已配置</span>}</label>
            <input className="input" type="password" value={s.llm_api_key || ''} onChange={e => set('llm_api_key', e.target.value)}
              placeholder={s.llm_api_key_set ? '••••••（留空表示不修改）' : 'sk-...'} /></div>
          <div className="row">
            <div className="field"><label>Temperature：{s.llm_temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={s.llm_temperature} onChange={e => set('llm_temperature', parseFloat(e.target.value))} style={{ width: '100%' }} /></div>
            <div className="field"><label>最大回复 Token</label>
              <input className="input" type="number" value={s.llm_max_tokens} onChange={e => set('llm_max_tokens', parseInt(e.target.value) || 1024)} /></div>
          </div>
        </div>

        <div className="card">
          <div className="section-title"><h2>🔊 语音模型 API</h2></div>
          <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>兼容 OpenAI 语音合成 (/audio/speech) 格式，用于朗读角色台词。</p>
          <div className="row">
            <div className="field"><label>Base URL</label>
              <input className="input" value={s.voice_base_url} onChange={e => set('voice_base_url', e.target.value)} placeholder="https://api.openai.com/v1" /></div>
            <div className="field"><label>模型</label>
              <input className="input" value={s.voice_model} onChange={e => set('voice_model', e.target.value)} placeholder="tts-1" /></div>
          </div>
          <div className="row">
            <div className="field"><label>默认音色</label>
              <input className="input" value={s.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder="alloy / nova / shimmer …" /></div>
            <div className="field"><label>API Key {s.voice_api_key_set && <span className="tag">已配置</span>}</label>
              <input className="input" type="password" value={s.voice_api_key || ''} onChange={e => set('voice_api_key', e.target.value)}
                placeholder={s.voice_api_key_set ? '••••••（留空表示不修改）' : 'sk-...'} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
