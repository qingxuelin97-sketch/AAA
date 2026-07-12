import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Logo } from '../assets.jsx';
import { LegalModal, LegalLinks } from '../components/LegalModal.jsx';
import { Drama, Plug, Volume2, Eye, EyeOff, Sparkles, ArrowRight, Landmark, Dices, MessagesSquare, LayoutGrid, LifeBuoy, Mail, ShieldCheck, KeyRound } from 'lucide-react';

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

// 角色星环 — 用广场上真实的公开角色点亮登录页。接口无鉴权可访问；
// 拉不到就静默隐藏，登录页不依赖它。桌面双排反向流动，移动端一排。
function CharacterRing({ chars, compact }) {
  if (!chars.length) return null;
  const row = (list, dir) => (
    <div className={'ring-row' + (dir < 0 ? ' rev' : '')}>
      <div className="ring-track">
        {[...list, ...list].map((c, i) => (
          <span className="ring-chip" key={c.id + '-' + i} title={c.name}>
            <Avatar src={c.avatar} name={c.name} size={compact ? 34 : 42} />
            <em>{c.name}</em>
          </span>
        ))}
      </div>
    </div>
  );
  if (compact) return <div className="auth-ring compact">{row(chars.slice(0, 10), 1)}</div>;
  const half = Math.ceil(chars.length / 2);
  return (
    <div className="auth-ring">
      {row(chars.slice(0, half), 1)}
      {row(chars.slice(half), -1)}
    </div>
  );
}

export default function Auth() {
  const { login, register } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '', code: '', invite: '' });
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [tl, setTl] = useState(0);
  const [agree, setAgree] = useState(false);
  const [legal, setLegal] = useState(null); // null | 'terms' | 'privacy' | 'copyright' | 'disclaimer'
  const [ring, setRing] = useState([]);
  // 邮箱验证码：倒计时（秒）、发送中
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

  useEffect(() => { const t = setInterval(() => setTl(i => (i + 1) % TAGLINES.length), 3600); return () => clearInterval(t); }, []);
  useEffect(() => {
    api('/characters/public?sort=hot')
      .then(d => setRing((d.characters || []).filter(c => c.avatar).slice(0, 16)))
      .catch(() => {});
  }, []);
  // 验证码倒计时驱动
  useEffect(() => {
    if (codeCountdown <= 0) return;
    const t = setInterval(() => setCodeCountdown(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [codeCountdown]);
  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const sendCode = async () => {
    if (!form.email.trim()) { toast('请先填写邮箱', 'err'); return; }
    if (sendingCode || codeCountdown > 0) return;
    setSendingCode(true);
    try {
      const d = await api('/auth/send-code', { method: 'POST', body: { email: form.email.trim() } });
      toast(`验证码已发送至 ${form.email.trim()}（${d.ttl_min || 10} 分钟内有效）`);
      setCodeCountdown(60);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setSendingCode(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'register' && !agree) { toast('请先阅读并勾选同意《服务条款》《隐私政策》《版权声明》与《免责声明》', 'err'); return; }
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
    <div className="auth-wrap v2 auth-reveal">
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

        <CharacterRing chars={ring} />
      </div>

      <div className="auth-form-side">
        <div className="auth-ring-mobile mobile-only">
          <CharacterRing chars={ring} compact />
          {ring.length > 0 && <div className="arm-cap">{ring.length}+ 位角色正在幻域等你</div>}
        </div>
        <div className="card auth-card">
          <div className="auth-card-badge"><Sparkles size={13} /> AI 角色扮演平台</div>
          <h2>{mode === 'login' ? '登录账号' : '创建账号'}</h2>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{mode === 'login' ? '欢迎回来，继续你的故事' : '邮箱验证码注册 · 仅白名单邮箱可注册'}</p>
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
                <input className="input" type={showPwd ? 'text' : 'password'} value={form.password} onChange={upd('password')} placeholder="至少 8 位，含字母/数字/符号两类" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" className="affix-btn" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? '隐藏密码' : '显示密码'} tabIndex={-1}>
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {mode === 'register' && (
              <>
                <div className="field">
                  <label><Mail size={13} style={{ verticalAlign: -2, marginRight: 4 }} />邮箱</label>
                  <input className="input" type="email" value={form.email} onChange={upd('email')} placeholder="white@example.com" autoComplete="email" />
                  <div className="hint">仅白名单内邮箱可注册。注册后该邮箱将作为账号凭证，请确保可正常收信。</div>
                </div>
                <div className="field">
                  <label><KeyRound size={13} style={{ verticalAlign: -2, marginRight: 4 }} />邮箱验证码</label>
                  <div className="input-affix" style={{ display: 'flex', gap: 8 }}>
                    <input className="input" style={{ flex: 1 }} value={form.code} onChange={upd('code')} placeholder="6 位验证码" inputMode="numeric" autoComplete="one-time-code" />
                    <button type="button" className="btn sm" onClick={sendCode} disabled={sendingCode || codeCountdown > 0 || !form.email.trim()} style={{ whiteSpace: 'nowrap' }}>
                      {sendingCode ? '发送中…' : codeCountdown > 0 ? `${codeCountdown}s 后重发` : '获取验证码'}
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label><ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />邀请密钥 <span className="muted">(可选)</span></label>
                  <input className="input" value={form.invite} onChange={upd('invite')} placeholder="若有邀请密钥可填，可领取邀请奖励" />
                </div>
              </>
            )}
            {mode === 'register' && (
              <label className="auth-agree">
                <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
                <span>我已阅读并同意
                  <button type="button" onClick={() => setLegal('terms')}>《服务条款》</button>
                  <button type="button" onClick={() => setLegal('privacy')}>《隐私政策》</button>
                  <button type="button" onClick={() => setLegal('copyright')}>《版权声明》</button>与
                  <button type="button" onClick={() => setLegal('disclaimer')}>《免责声明》</button>
                </span>
              </label>
            )}
            <button className="btn primary block auth-submit" disabled={busy || (mode === 'register' && !agree)}>
              {busy ? '处理中…' : <>{mode === 'login' ? '登 录' : '注 册'} <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="auth-foot">
            <div className="auth-explore">
              <button type="button" className="auth-explore-btn" onClick={() => nav('/features')}><LayoutGrid size={14} /> 产品功能</button>
              <button type="button" className="auth-explore-btn" onClick={() => nav('/help')}><LifeBuoy size={14} /> 帮助中心</button>
            </div>
            {mode === 'login' && <div className="auth-foot-note">登录 / 注册即表示你已阅读并同意以下条款</div>}
            <LegalLinks onOpen={setLegal} className="center" />
            <div style={{ marginTop: 8 }}>© 2026 幻域 HUANYU · AI 角色扮演社区平台</div>
          </div>
        </div>
      </div>

      {legal && <LegalModal docKey={legal} onClose={() => setLegal(null)} onOpen={setLegal} />}
    </div>
  );
}
