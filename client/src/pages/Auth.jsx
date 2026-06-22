import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { Logo } from '../assets.jsx';
import { LEGAL } from '../legal.js';
import { Drama, BookOpen, Plug, Volume2, Users, Eye, EyeOff, Sparkles, ArrowRight, Landmark, Dices, MessagesSquare, X } from 'lucide-react';

const TAGLINES = [
  ['与你创造的', '角色一同呼吸'],
  ['编写世界书', '让故事自己生长'],
  ['在剧场里', '与众生同台联机'],
  ['你的幻域', '由你立法共治'],
];
const FEATURES = [
  [Drama, '自定义角色', '立绘、人设、世界书一应俱全'],
  [Plug, '自带模型 API', '接入任意 OpenAI 兼容服务'],
  [Volume2, '语音对话', '让角色开口说话'],
  [MessagesSquare, '沉浸对话', '好感度、记忆、动态背景'],
  [Landmark, '议会共治', '提案表决，社区由你定义'],
  [Dices, '扭蛋 & 活动', '签到、抽卡、限时狂欢'],
];
const STATS = [['12+', '玩法模块'], ['∞', '角色可能'], ['100%', '本地密钥']];

export default function Auth() {
  const { login, register } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '', invite: '' });
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [tl, setTl] = useState(0);
  const [agree, setAgree] = useState(false);
  const [legal, setLegal] = useState(null); // null | 'terms' | 'privacy'

  useEffect(() => { const t = setInterval(() => setTl(i => (i + 1) % TAGLINES.length), 3600); return () => clearInterval(t); }, []);
  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'register' && !agree) { toast('请先阅读并勾选同意《用户协议》与《隐私政策》', 'err'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await login(form.username, form.password);
      else await register(form);
      toast(mode === 'login' ? '欢迎回来' : '注册成功，开启你的幻域之旅');
      nav('/');
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap v2">
      <div className="auth-hero">
        <div className="glow" />
        <div className="auth-orbs" aria-hidden="true"><i /><i /><i /></div>
        <div className="brand" style={{ padding: 0, marginBottom: 30 }}>
          <Logo size={46} radius={13} />
          <div><b style={{ fontSize: 22 }}>幻域</b><small>HUANYU AI</small></div>
        </div>
        <h1 className="auth-tagline">
          {TAGLINES[tl].map((line, i) => (
            <span key={tl + '-' + i} className="atl-line" style={{ animationDelay: i * 0.08 + 's' }}>{line}</span>
          ))}
        </h1>
        <p>自定义角色立绘与动态聊天背景，编写世界书与人设，接入你自己的语言 / 语音模型，沉浸式扮演属于你的故事。把得意之作分享到广场，并在议会里共同定义这个世界的规则。</p>

        <div className="auth-feats-grid">
          {FEATURES.map(([Ic, t, d]) => (
            <div className="auth-feat-card" key={t}>
              <span className="afc-ic"><Ic size={17} /></span>
              <div><b>{t}</b><small>{d}</small></div>
            </div>
          ))}
        </div>

        <div className="auth-stats">
          {STATS.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}
        </div>
      </div>

      <div className="auth-form-side">
        <div className="card auth-card">
          <div className="auth-card-badge"><Sparkles size={13} /> AI 角色扮演平台</div>
          <h2>{mode === 'login' ? '登录账号' : '创建账号'}</h2>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{mode === 'login' ? '欢迎回来，继续你的故事' : '无需验证码，立即开始'}</p>
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
            <span className="auth-tab-ink" style={{ transform: `translateX(${mode === 'login' ? 0 : 100}%)` }} />
          </div>
          <form onSubmit={submit}>
            <div className="field">
              <label>用户名</label>
              <input className="input" value={form.username} onChange={upd('username')} placeholder="字母 / 数字，2 位以上" autoFocus autoComplete="username" />
            </div>
            {mode === 'register' && (
              <div className="field">
                <label>昵称 <span className="muted">(可选)</span></label>
                <input className="input" value={form.display_name} onChange={upd('display_name')} placeholder="展示给其他玩家的名字" />
              </div>
            )}
            <div className="field">
              <label>密码</label>
              <div className="input-affix">
                <input className="input" type={showPwd ? 'text' : 'password'} value={form.password} onChange={upd('password')} placeholder="至少 4 位" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" className="affix-btn" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? '隐藏密码' : '显示密码'} tabIndex={-1}>
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {mode === 'register' && (
              <div className="field">
                <label>邀请密钥</label>
                <input className="input" value={form.invite} onChange={upd('invite')} placeholder="输入邀请密钥以注册" />
                <div className="hint">注册需要有效邀请密钥，请联系管理员获取。</div>
              </div>
            )}
            {mode === 'register' && (
              <label className="auth-agree">
                <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
                <span>我已阅读并同意
                  <button type="button" onClick={() => setLegal('terms')}>《用户协议》</button>与
                  <button type="button" onClick={() => setLegal('privacy')}>《隐私政策》</button>
                </span>
              </label>
            )}
            <button className="btn primary block auth-submit" disabled={busy || (mode === 'register' && !agree)}>
              {busy ? '处理中…' : <>{mode === 'login' ? '登 录' : '注 册'} <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="auth-foot">
            {mode === 'login' && <>登录即表示同意
              <button type="button" className="auth-link" onClick={() => setLegal('terms')}>《用户协议》</button>与
              <button type="button" className="auth-link" onClick={() => setLegal('privacy')}>《隐私政策》</button><br /></>}
            © 2026 幻域 HUANYU · AI 角色扮演平台
          </div>
        </div>
      </div>

      {legal && (() => { const doc = LEGAL[legal]; return (
        <Modal onClose={() => setLegal(null)}>
          <button className="modal-x" onClick={() => setLegal(null)} aria-label="关闭"><X size={18} /></button>
          <h2 style={{ margin: '0 0 4px' }}>{doc.title}</h2>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>最近更新：{doc.updated}</div>
          <p className="legal-intro">{doc.intro}</p>
          <div className="legal-body">
            {doc.sections.map((s, i) => (
              <section key={i}><h4>{s.h}</h4><p>{s.p}</p></section>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {legal === 'terms'
              ? <button className="btn ghost" style={{ flex: 1 }} onClick={() => setLegal('privacy')}>查看隐私政策</button>
              : <button className="btn ghost" style={{ flex: 1 }} onClick={() => setLegal('terms')}>查看用户协议</button>}
            <button className="btn primary" style={{ flex: 1 }} onClick={() => setLegal(null)}>我已知悉</button>
          </div>
        </Modal>
      ); })()}
    </div>
  );
}
