import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';

export default function Auth() {
  const { login, register } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '' });
  const [busy, setBusy] = useState(false);

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') await login(form.username, form.password);
      else await register(form);
      toast(mode === 'login' ? '欢迎回来 ✨' : '注册成功，开启你的幻域之旅');
      nav('/');
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div className="glow" />
        <div className="brand" style={{ padding: 0, marginBottom: 26 }}>
          <div className="logo" style={{ width: 46, height: 46, fontSize: 24 }}>🜲</div>
          <div><b style={{ fontSize: 22 }}>幻域</b><small>HUANYU AI</small></div>
        </div>
        <h1>与你创造的<br />角色一同呼吸</h1>
        <p>自定义角色立绘与动态聊天背景，编写世界书与人设，接入你自己的语言 / 语音模型，沉浸式扮演属于你的故事。把得意之作分享到广场，推送给同好。</p>
        <div className="auth-feat">
          <span>🎭 自定义角色</span><span>📖 世界书</span><span>🔌 自带模型 API</span>
          <span>🔊 语音对话</span><span>🌐 社区广场</span>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="card auth-card">
          <h2>{mode === 'login' ? '登录账号' : '创建账号'}</h2>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>无需验证码，立即开始</p>
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
          </div>
          <form onSubmit={submit}>
            <div className="field">
              <label>用户名</label>
              <input className="input" value={form.username} onChange={upd('username')} placeholder="字母 / 数字，2 位以上" autoFocus />
            </div>
            {mode === 'register' && (
              <div className="field">
                <label>昵称 <span className="muted">(可选)</span></label>
                <input className="input" value={form.display_name} onChange={upd('display_name')} placeholder="展示给其他玩家的名字" />
              </div>
            )}
            <div className="field">
              <label>密码</label>
              <input className="input" type="password" value={form.password} onChange={upd('password')} placeholder="至少 4 位" />
            </div>
            <button className="btn primary block" disabled={busy}>
              {busy ? '处理中…' : mode === 'login' ? '登 录' : '注 册'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
