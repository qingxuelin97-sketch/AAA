import React, { useEffect, useState } from 'react';
import { api } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { Shield, Users, ScrollText, Tag, Megaphone, Gift, Ban, Crown, Trash2, Plus, Copy, Check, Search, AlertTriangle, Cpu } from 'lucide-react';

export default function Admin() {
  const toast = useToast();
  const [denied, setDenied] = useState(false);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    api('/admin/check')
      .then(() => setDenied(false))
      .catch(() => setDenied(true))
      .finally(() => setReady(true));
    /* eslint-disable-next-line */
  }, []);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1><Shield size={18} style={{ verticalAlign: '-3px' }} /> GM 控制台</h1><div className="sub">用户 · 内容 · 兑换码 · 举报</div></div>
      </div>
      <div className="page">
        {!ready ? <div className="empty">载入中…</div> : denied ? (
          <div className="empty"><div className="big"><Shield size={46} /></div>需要 GM 权限</div>
        ) : (
          <>
            <div className="seg" style={{ marginBottom: 18 }}>
              <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>总览</button>
              <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户</button>
              <button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>内容</button>
              <button className={tab === 'codes' ? 'active' : ''} onClick={() => setTab('codes')}>兑换码</button>
              <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>举报</button>
              <button className={tab === 'platform' ? 'active' : ''} onClick={() => setTab('platform')}>平台AI</button>
            </div>
            {tab === 'overview' && <Overview toast={toast} />}
            {tab === 'users' && <UsersTab toast={toast} />}
            {tab === 'content' && <ContentTab toast={toast} />}
            {tab === 'codes' && <CodesTab toast={toast} />}
            {tab === 'reports' && <ReportsTab toast={toast} />}
            {tab === 'platform' && <PlatformTab toast={toast} />}
          </>
        )}
      </div>
    </>
  );
}

function Overview({ toast }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api('/admin/stats').then(d => setStats(d.stats)).catch(e => toast(e.message, 'err'));
    /* eslint-disable-next-line */
  }, []);
  if (!stats) return <div className="empty">载入中…</div>;
  const items = [
    [stats.users, '用户'], [stats.characters, '角色'], [stats.scripts, '剧本'],
    [stats.moments, '动态'], [stats.banned, '封禁'], [stats.reports, '待处理举报'],
  ];
  return (
    <div className="adm-stats">
      {items.map(([n, label]) => (
        <div key={label} className="adm-stat"><b>{n ?? 0}</b><span>{label}</span></div>
      ))}
    </div>
  );
}

function UsersTab({ toast }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [gifting, setGifting] = useState(null);

  const load = (query = q) => api('/admin/users?q=' + encodeURIComponent(query)).then(d => setUsers(d.users || [])).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(''); /* eslint-disable-next-line */ }, []);

  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'err'); } };
  const ban = (u) => { const reason = window.prompt('封禁理由'); if (reason === null) return; act(() => api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { reason } })); };
  const unban = (u) => act(() => api(`/admin/users/${u.id}/unban`, { method: 'POST' }));
  const toggleGm = (u) => act(() => api(`/admin/users/${u.id}/gm`, { method: 'POST', body: { value: !u.is_gm } }));

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input className="input" placeholder="搜索用户名 / 昵称" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} style={{ flex: 1 }} />
        <button className="btn" onClick={() => load()}><Search size={15} /> 搜索</button>
      </div>
      {users.length === 0 ? <div className="empty">没有找到用户</div> : users.map(u => (
        <div key={u.id} className="adm-row">
          <Avatar src={u.avatar} name={u.display_name} size={40} />
          <div className="grow">
            <b>{u.display_name} {u.is_gm && <span className="gm-tag">GM</span>} {u.is_banned && <span className="ban-flag">已封禁</span>}</b>
            <div className="sub2">@{u.username} · U{u.id} · 金{u.gold}/钻{u.diamond}</div>
          </div>
          <div className="adm-actions">
            <button className="btn sm" onClick={() => setGifting(u)}><Gift size={13} /> 赠送</button>
            {u.is_banned
              ? <button className="btn sm" onClick={() => unban(u)}><Check size={13} /> 解封</button>
              : <button className="btn sm danger" onClick={() => ban(u)}><Ban size={13} /> 封禁</button>}
            <button className="btn sm" onClick={() => toggleGm(u)}><Crown size={13} /> {u.is_gm ? '撤销GM' : '设为GM'}</button>
          </div>
        </div>
      ))}
      {gifting && <GiftModal user={gifting} toast={toast} onClose={() => setGifting(null)} onDone={() => { setGifting(null); load(); }} />}
    </>
  );
}

function GiftModal({ user, toast, onClose, onDone }) {
  const [gold, setGold] = useState('');
  const [diamond, setDiamond] = useState('');
  const [vipDays, setVipDays] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/admin/gift', { method: 'POST', body: { user_id: user.id, gold: Number(gold) || 0, diamond: Number(diamond) || 0, vip_days: Number(vipDays) || 0 } });
      toast('已赠送');
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>赠送给 {user.display_name}</h2>
      <div className="field"><label>金币</label><input className="input" type="number" value={gold} onChange={e => setGold(e.target.value)} placeholder="0" /></div>
      <div className="field"><label>钻石</label><input className="input" type="number" value={diamond} onChange={e => setDiamond(e.target.value)} placeholder="0" /></div>
      <div className="field"><label>VIP天数</label><input className="input" type="number" value={vipDays} onChange={e => setVipDays(e.target.value)} placeholder="0" /></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>取消</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>确认赠送</button>
      </div>
    </Modal>
  );
}

function ContentTab({ toast }) {
  const [sub, setSub] = useState('characters');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState([]);
  const [scripts, setScripts] = useState([]);

  const loadChars = (query = q) => api('/admin/characters?q=' + encodeURIComponent(query)).then(d => setChars(d.characters || [])).catch(e => toast(e.message, 'err'));
  const loadScripts = (query = q) => api('/admin/scripts?q=' + encodeURIComponent(query)).then(d => setScripts(d.scripts || [])).catch(e => toast(e.message, 'err'));
  const loadCurrent = (query = q) => (sub === 'characters' ? loadChars(query) : loadScripts(query));

  useEffect(() => { setQ(''); (sub === 'characters' ? loadChars('') : loadScripts('')); /* eslint-disable-next-line */ }, [sub]);

  const act = async (fn) => { try { await fn(); await loadCurrent(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={sub === 'characters' ? 'active' : ''} onClick={() => setSub('characters')}>角色</button>
        <button className={sub === 'scripts' ? 'active' : ''} onClick={() => setSub('scripts')}>剧本</button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input className="input" placeholder="搜索" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadCurrent()} style={{ flex: 1 }} />
        <button className="btn" onClick={() => loadCurrent()}><Search size={15} /> 搜索</button>
      </div>

      {sub === 'characters' && (chars.length === 0 ? <div className="empty">没有角色</div> : chars.map(c => (
        <div key={c.id} className="adm-row">
          <div className="grow">
            <b>{c.name} {c.featured && <span className="tag">推荐</span>}</b>
            <div className="sub2">C{c.id} · by {c.owner_name}</div>
          </div>
          <div className="adm-actions">
            <button className="btn sm" onClick={() => act(() => api(`/admin/characters/${c.id}/feature`, { method: 'POST', body: { value: !c.featured } }))}>{c.featured ? '取消推荐' : '加精'}</button>
            <button className="btn sm danger" onClick={() => { if (window.confirm('确认删除该角色？')) act(() => api(`/admin/characters/${c.id}`, { method: 'DELETE' })); }}><Trash2 size={13} /> 删除</button>
          </div>
        </div>
      )))}

      {sub === 'scripts' && (scripts.length === 0 ? <div className="empty">没有剧本</div> : scripts.map(s => (
        <div key={s.id} className="adm-row">
          <div className="grow">
            <b>{s.title} {s.featured && <span className="tag">推荐</span>}</b>
            <div className="sub2">S{s.id} · by {s.author_name}</div>
          </div>
          <div className="adm-actions">
            <button className="btn sm" onClick={() => act(() => api(`/admin/scripts/${s.id}/feature`, { method: 'POST', body: { value: !s.featured } }))}>{s.featured ? '取消推荐' : '加精'}</button>
            <button className="btn sm danger" onClick={() => { if (window.confirm('确认删除该剧本？')) act(() => api(`/admin/scripts/${s.id}`, { method: 'DELETE' })); }}><Trash2 size={13} /> 删除</button>
          </div>
        </div>
      )))}
    </>
  );
}

function CodesTab({ toast }) {
  const [gold, setGold] = useState('');
  const [diamond, setDiamond] = useState('');
  const [vipDays, setVipDays] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [prefix, setPrefix] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState([]);
  const [copied, setCopied] = useState('');

  const load = () => api('/admin/codes').then(d => setCodes(d.codes || [])).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const create = async () => {
    setBusy(true);
    try {
      const d = await api('/admin/codes', { method: 'POST', body: { gold: Number(gold) || 0, diamond: Number(diamond) || 0, vip_days: Number(vipDays) || 0, max_uses: Number(maxUses) || 0, prefix, note } });
      toast('已生成：' + d.code.code);
      setGold(''); setDiamond(''); setVipDays(''); setMaxUses(''); setPrefix(''); setNote('');
      await load();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const copy = (code) => { navigator.clipboard.writeText(code); setCopied(code); toast('已复制'); setTimeout(() => setCopied(''), 1500); };
  const del = async (code) => { try { await api('/admin/codes/' + code, { method: 'DELETE' }); await load(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 17 }}>生成兑换码 / 内测邀请码</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          <div className="field"><label>金币</label><input className="input" type="number" value={gold} onChange={e => setGold(e.target.value)} placeholder="0" /></div>
          <div className="field"><label>钻石</label><input className="input" type="number" value={diamond} onChange={e => setDiamond(e.target.value)} placeholder="0" /></div>
          <div className="field"><label>VIP天数</label><input className="input" type="number" value={vipDays} onChange={e => setVipDays(e.target.value)} placeholder="0" /></div>
          <div className="field"><label>可用次数</label><input className="input" type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="1" /></div>
          <div className="field"><label>前缀</label><input className="input" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="可选" /></div>
          <div className="field"><label>备注</label><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="可选" /></div>
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} disabled={busy} onClick={create}><Plus size={15} /> 生成</button>
      </div>

      {codes.length === 0 ? <div className="empty"><div className="big"><Tag size={42} /></div>暂无兑换码</div> : codes.map(c => (
        <div key={c.code} className="adm-row">
          <span className="code-chip">{c.code}</span>
          <div className="grow">
            <div className="sub2">金{c.grant_gold} 钻{c.grant_diamond} VIP{c.grant_vip_days}天 · 已用 {c.used}/{c.max_uses}{c.note ? ' · ' + c.note : ''}</div>
          </div>
          <div className="adm-actions">
            <button className="btn sm" onClick={() => copy(c.code)}>{copied === c.code ? <Check size={13} /> : <Copy size={13} />} 复制</button>
            <button className="btn sm danger" onClick={() => del(c.code)}><Trash2 size={13} /> 删除</button>
          </div>
        </div>
      ))}
    </>
  );
}

function PlatformTab({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [sysPrompt, setSysPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/admin/platform').then(d => { setCfg(d.platform); setBaseUrl(d.platform.base_url || ''); setModel(d.platform.model || ''); setSysPrompt(d.platform.system_prompt || ''); }).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = { base_url: baseUrl, model, system_prompt: sysPrompt };
      if (key.trim()) body.key = key.trim();
      const d = await api('/admin/platform', { method: 'PUT', body });
      setCfg(d.platform); setKey('');
      toast('平台 AI 配置已更新，已对全体无 API 用户生效');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (!cfg) return <div className="empty">载入中…</div>;
  return (
    <div className="card">
      <h2 style={{ margin: '0 0 6px', fontSize: 17 }}><Cpu size={16} style={{ verticalAlign: -3, marginRight: 6 }} />平台内置语言服务</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        未配置自有 API 的用户对话时统一调用此服务。<b>这是群体性配置，修改后立即对所有无 API 用户生效。</b>
        普通用户无法看到此处任何接口或密钥信息。
      </p>
      <div className="field"><label>API Base URL</label>
        <input className="input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://open.bigmodel.cn/api/paas/v4" /></div>
      <div className="field"><label>最终调用模型</label>
        <input className="input" value={model} onChange={e => setModel(e.target.value)} placeholder="glm-5.2" />
        <div className="hint">所有无 API 用户最终调用的模型名，例如 glm-5.2 / glm-4.6。</div></div>
      <div className="field"><label>API Key {cfg.key_set && <span className="tag">已配置 · {cfg.key_masked}</span>}</label>
        <input className="input" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={cfg.key_set ? '••••••（留空则不修改）' : '填写平台密钥'} /></div>
      <div className="field"><label>平台系统提示词（全局）</label>
        <textarea className="input" rows={6} value={sysPrompt} onChange={e => setSysPrompt(e.target.value)} style={{ resize: 'vertical', lineHeight: 1.6 }}
          placeholder="例如：统一的安全与风格约束、平台世界观设定等。将自动前置注入到所有「无自有 API」用户的每次对话最前面，与角色人设叠加。留空则不注入。" />
        <div className="hint">仅对使用平台内置服务的用户生效；填写自有 API Key 的用户不受影响。修改后立即对全体生效。</div></div>
      {cfg.fee && <p className="muted" style={{ fontSize: 12.5 }}>计费规则：每次对话 {cfg.fee.base} 金币；单对话互动超 {cfg.fee.heavy_threshold} 条后 {cfg.fee.heavy} 金币（VIP 75 折 / SVIP 5 折，会员折扣在结算时自动应用）。</p>}
      <button className="btn primary" style={{ marginTop: 6 }} disabled={busy} onClick={save}><Check size={15} /> 保存并对全体生效</button>
    </div>
  );
}

function ReportsTab({ toast }) {
  const [reports, setReports] = useState([]);
  const load = () => api('/admin/reports').then(d => setReports(d.reports || [])).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const resolve = async (id) => { try { await api(`/admin/reports/${id}/resolve`, { method: 'POST' }); await load(); } catch (e) { toast(e.message, 'err'); } };

  if (reports.length === 0) return <div className="empty"><div className="big"><AlertTriangle size={42} /></div>暂无举报</div>;
  return reports.map(r => (
    <div key={r.id} className="adm-row">
      <div className="grow">
        <b>{r.target_type} #{r.target_id}</b>
        <div className="sub2">理由：{r.reason || '-'} · 举报人 {r.reporter_name || '匿名'} · {r.status}</div>
      </div>
      {r.status === 'open' && (
        <div className="adm-actions">
          <button className="btn sm" onClick={() => resolve(r.id)}><Check size={13} /> 标记已处理</button>
        </div>
      )}
    </div>
  ));
}
