import React, { useEffect, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Uploader, Avatar } from '../ui.jsx';
import { Cpu, Volume2, UserCog, SlidersHorizontal } from 'lucide-react';

const LLM_PRESETS = {
  openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1', openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1', custom: ''
};

export default function Settings() {
  const toast = useToast();
  const { user, setUser, refreshUser } = useAuth();
  const [tab, setTab] = useState('model');
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ display_name: '', bio: '', avatar: '', banner: '' });
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' });

  useEffect(() => { api('/settings').then(d => setS(d.settings)).catch(e => toast(e.message, 'err')); }, []);
  useEffect(() => { if (user) setProfile({ display_name: user.display_name || '', bio: user.bio || '', avatar: user.avatar || '', banner: user.banner || '' }); }, [user]);
  if (!s) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const set = (k, v) => setS(p => ({ ...p, [k]: v }));

  const saveModel = async () => {
    setBusy(true);
    try { const d = await api('/settings', { method: 'PUT', body: s }); setS(d.settings); toast('设置已保存 ✓'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const saveProfile = async () => {
    try { const d = await api('/auth/me', { method: 'PUT', body: profile }); setUser(d.user); toast('资料已更新'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const changePwd = async () => {
    try { await api('/auth/password', { method: 'PUT', body: pwd }); setPwd({ old_password: '', new_password: '' }); toast('密码已修改'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const TABS = [['model', '语言模型', Cpu], ['voice', '语音模型', Volume2], ['account', '账号安全', UserCog], ['pref', '偏好', SlidersHorizontal]];

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
            <div className="section-title"><h2>🔌 语言模型 API</h2><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div>
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>兼容 OpenAI Chat Completions 格式，可接入任意服务商。密钥仅存于服务端。</p>
            <div className="row">
              <div className="field"><label>服务商预设</label>
                <select className="select" value={s.llm_provider} onChange={e => { const p = e.target.value; set('llm_provider', p); if (LLM_PRESETS[p]) set('llm_base_url', LLM_PRESETS[p]); }}>
                  <option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="moonshot">Moonshot / Kimi</option>
                  <option value="openrouter">OpenRouter</option><option value="groq">Groq</option><option value="custom">自定义</option>
                </select></div>
              <div className="field"><label>模型名称</label><input className="input" value={s.llm_model} onChange={e => set('llm_model', e.target.value)} placeholder="gpt-4o-mini" /></div>
            </div>
            <div className="field"><label>API Base URL</label><input className="input" value={s.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} /></div>
            <div className="field"><label>API Key {s.llm_api_key_set && <span className="tag">已配置</span>}</label>
              <input className="input" type="password" value={s.llm_api_key || ''} onChange={e => set('llm_api_key', e.target.value)} placeholder={s.llm_api_key_set ? '••••••（留空不修改）' : 'sk-...'} /></div>
            <div className="row">
              <div className="field"><label>Temperature：{s.llm_temperature}</label><input type="range" min="0" max="2" step="0.1" value={s.llm_temperature} onChange={e => set('llm_temperature', parseFloat(e.target.value))} style={{ width: '100%' }} /></div>
              <div className="field"><label>最大回复 Token</label><input className="input" type="number" value={s.llm_max_tokens} onChange={e => set('llm_max_tokens', parseInt(e.target.value) || 1024)} /></div>
            </div>
          </div>
        )}

        {tab === 'voice' && (
          <div className="card">
            <div className="section-title"><h2>🔊 语音模型 API</h2><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div>
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>兼容 OpenAI /audio/speech，用于朗读角色台词。</p>
            <div className="row">
              <div className="field"><label>Base URL</label><input className="input" value={s.voice_base_url} onChange={e => set('voice_base_url', e.target.value)} /></div>
              <div className="field"><label>模型</label><input className="input" value={s.voice_model} onChange={e => set('voice_model', e.target.value)} placeholder="tts-1" /></div>
            </div>
            <div className="row">
              <div className="field"><label>默认音色</label><input className="input" value={s.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder="alloy / nova" /></div>
              <div className="field"><label>API Key {s.voice_api_key_set && <span className="tag">已配置</span>}</label>
                <input className="input" type="password" value={s.voice_api_key || ''} onChange={e => set('voice_api_key', e.target.value)} placeholder={s.voice_api_key_set ? '••••••（留空不修改）' : 'sk-...'} /></div>
            </div>
          </div>
        )}

        {tab === 'account' && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-title"><h2>个人资料</h2><button className="btn sm primary" onClick={saveProfile}>保存资料</button></div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 14 }}>
                <Uploader variant="avatar" value={profile.avatar} onChange={url => setProfile({ ...profile, avatar: url })} accept="image/*" />
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

        {tab === 'pref' && (
          <div className="card">
            <div className="section-title"><h2>偏好设置</h2><button className="btn sm primary" onClick={saveModel} disabled={busy}>保存</button></div>
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
