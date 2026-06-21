import React, { useEffect, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { Shield, Users, ScrollText, Tag, Megaphone, Gift, Ban, Crown, Trash2, Plus, Copy, Check, Search, AlertTriangle, Cpu, Landmark, Gavel, Scale, Radio, X, MessageSquare, UserCheck, TrendingUp } from 'lucide-react';

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
        <div style={{ flex: 1 }}><h1><Shield size={18} style={{ verticalAlign: '-3px' }} /> GM 控制台</h1><div className="sub">总览 · 用户 · 内容 · 议会 · 兑换码 · 举报 · 平台</div></div>
      </div>
      <div className="page">
        {!ready ? <div className="empty">载入中…</div> : denied ? (
          <div className="empty"><div className="big"><Shield size={46} /></div>需要 GM 权限</div>
        ) : (
          <>
            <div className="tabs-bar adm-tabs" style={{ marginBottom: 18 }}>
              {[['overview', '总览', TrendingUp], ['users', '用户', Users], ['content', '内容', ScrollText], ['council', '议会', Landmark], ['codes', '兑换码', Tag], ['reports', '举报', AlertTriangle], ['platform', '平台AI', Cpu]].map(([k, l, Ic]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Ic size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{l}</button>
              ))}
            </div>
            {tab === 'overview' && <Overview toast={toast} />}
            {tab === 'users' && <UsersTab toast={toast} />}
            {tab === 'content' && <ContentTab toast={toast} />}
            {tab === 'council' && <CouncilTab toast={toast} />}
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
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/admin/stats').then(d => setStats(d.stats)).catch(e => toast(e.message, 'err'));
    /* eslint-disable-next-line */
  }, []);
  if (!stats) return <div className="empty">载入中…</div>;
  const items = [
    [stats.users, '用户', Users], [stats.characters, '角色', Crown], [stats.scripts, '剧本', ScrollText],
    [stats.conversations, '对话', MessageSquare], [stats.councilors, '议员', Landmark], [stats.proposals, '待办提案', Gavel],
    [stats.checkins_today, '今日签到', UserCheck], [stats.banned, '封禁', Ban], [stats.reports, '待处理举报', AlertTriangle],
  ];
  const broadcast = async () => {
    if (!msg.trim()) { toast('请输入广播内容', 'err'); return; }
    if (!confirm('向全体未封禁用户推送这条系统通知？')) return;
    setBusy(true);
    try { const d = await api('/admin/broadcast', { method: 'POST', body: { text: msg.trim(), link: link.trim() } }); toast(`已推送给 ${d.count} 位用户`); setMsg(''); setLink(''); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="adm-stats adm-stats-rich">
        {items.map(([n, label, Ic]) => (
          <div key={label} className="adm-stat"><span className="adm-stat-ic"><Ic size={16} /></span><b>{n ?? 0}</b><span>{label}</span></div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}><Radio size={16} style={{ verticalAlign: -3, marginRight: 6 }} />全站广播</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>向所有用户推送一条系统通知（出现在每个人的通知中心）。</p>
        <div className="field"><label>通知内容</label><textarea className="textarea" rows={3} value={msg} onChange={e => setMsg(e.target.value)} placeholder="例如：今晚 20:00 联机狂欢开启，登录即领限时礼包！" style={{ resize: 'vertical' }} /></div>
        <div className="field"><label>跳转链接 <span className="muted">(可选)</span></label><input className="input" value={link} onChange={e => setLink(e.target.value)} placeholder="/events" /></div>
        <button className="btn primary" disabled={busy} onClick={broadcast}><Radio size={15} /> 推送给全体</button>
      </div>
    </>
  );
}

function UsersTab({ toast }) {
  const { user: meUser } = useAuth();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [gifting, setGifting] = useState(null);

  const load = (query = q) => api('/admin/users?q=' + encodeURIComponent(query)).then(d => setUsers(d.users || [])).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(''); /* eslint-disable-next-line */ }, []);

  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'err'); } };
  const ban = (u) => { const reason = window.prompt('封禁理由'); if (reason === null) return; act(() => api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { reason } })); };
  const unban = (u) => act(() => api(`/admin/users/${u.id}/unban`, { method: 'POST' }));
  const toggleGm = (u) => act(() => api(`/admin/users/${u.id}/gm`, { method: 'POST', body: { value: !u.is_gm } }));
  const toggleCouncil = (u) => act(() => api(`/admin/users/${u.id}/councilor`, { method: 'POST', body: { value: !u.is_councilor } }));

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
            <b>{u.display_name} {u.is_gm && <span className="gm-tag">GM</span>} {u.is_councilor && <span className="gm-tag councilor-tag">议员</span>} {u.is_banned && <span className="ban-flag">已封禁</span>}</b>
            <div className="sub2">@{u.username} · U{u.id} · 金{u.gold}/钻{u.diamond}</div>
          </div>
          <div className="adm-actions">
            <button className="btn sm" onClick={() => setGifting(u)}><Gift size={13} /> 赠送</button>
            {u.is_banned
              ? <button className="btn sm" onClick={() => unban(u)}><Check size={13} /> 解封</button>
              : <button className="btn sm danger" onClick={() => ban(u)}><Ban size={13} /> 封禁</button>}
            <button className="btn sm" onClick={() => toggleCouncil(u)}><Landmark size={13} /> {u.is_councilor ? '免去议员' : '任命议员'}</button>
            {u.is_gm && u.id === meUser?.id
              ? <button className="btn sm" disabled title="不能撤销自己的 GM 权限"><Crown size={13} /> 当前账号</button>
              : <button className="btn sm" onClick={() => toggleGm(u)}><Crown size={13} /> {u.is_gm ? '撤销GM' : '设为GM'}</button>}
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

function CouncilTab({ toast }) {
  const [councilors, setCouncilors] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [council, setCouncilInfo] = useState(null);
  const [override, setOverrideVal] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);

  const load = () => {
    api('/admin/councilors').then(d => setCouncilors(d.councilors || [])).catch(e => toast(e.message, 'err'));
    api('/parliament/proposals').then(d => setProposals(d.proposals || [])).catch(e => toast(e.message, 'err'));
    api('/admin/council').then(d => { setCouncilInfo(d.council); setOverrideVal(d.council.seats_override == null ? '' : String(d.council.seats_override)); }).catch(e => toast(e.message, 'err'));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const saveSeats = async () => {
    try { await api('/admin/council', { method: 'PUT', body: { seats_override: override.trim() === '' ? null : Number(override) } }); toast('席位设置已更新'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const reapportion = async () => {
    if (!confirm('执行换届？将清除手动席位设置，按当前注册规模重新核定席位，并通知全体议员。')) return;
    try { const d = await api('/admin/council/reapportion', { method: 'POST' }); toast(`已完成第 ${d.term} 届换届，核定 ${d.seats} 席`); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const search = async () => { if (!q.trim()) { setFound([]); return; } try { const d = await api('/admin/users?q=' + encodeURIComponent(q)); setFound(d.users || []); } catch (e) { toast(e.message, 'err'); } };
  const setCouncil = async (u, value) => { try { await api(`/admin/users/${u.id}/councilor`, { method: 'POST', body: { value } }); toast(value ? '已任命议员' : '已免去议员'); load(); search(); } catch (e) { toast(e.message, 'err'); } };
  const pact = async (id, action) => { try { await api(`/parliament/proposals/${id}/${action}`, { method: 'POST' }); toast('已操作'); load(); } catch (e) { toast(e.message, 'err'); } };

  const STLABEL = { pending: '待采纳', voting: '表决中', passed_general: '一般决议通过', passed_special: '特别决议通过', failed: '未通过', rejected: '已驳回' };
  const pending = proposals.filter(p => p.status === 'pending' || p.status === 'voting');

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}><Scale size={16} style={{ verticalAlign: -3, marginRight: 6 }} />议席与换届</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>平均每 <b>{council?.per_seat ?? 100}</b> 名注册用户对应 1 个议会席位（下限 {council?.min_seats ?? 5} 席）。特殊情况下可手动覆盖席位、超额任命议员。</p>
        {council && (
          <>
            <div className="seat-grid">
              <div className="seat-cell"><b>{council.total_users}</b><span>注册用户</span></div>
              <div className="seat-cell"><b>{council.base_seats}</b><span>按人口应得</span></div>
              <div className="seat-cell"><b>{council.seats}</b><span>当前议席{council.seats_override != null ? '（手动）' : ''}</span></div>
              <div className="seat-cell"><b>{council.councilors}</b><span>现任议员</span></div>
              <div className={'seat-cell ' + (council.over ? 'over' : council.vacancies > 0 ? 'vac' : 'full')}>
                <b>{council.over ? '超额 ' + (council.councilors - council.seats) : council.vacancies > 0 ? '缺 ' + council.vacancies : '满员'}</b><span>第 {council.term} 届</span>
              </div>
            </div>
            <div className="seat-controls">
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>手动覆盖席位 <span className="muted">(留空则按人口自动核定)</span></label>
                <input className="input" type="number" min="0" value={override} onChange={e => setOverrideVal(e.target.value)} placeholder={`自动：${Math.max(council.min_seats, council.base_seats)} 席`} />
              </div>
              <button className="btn" onClick={saveSeats}><Check size={14} /> 保存席位</button>
              <button className="btn primary" onClick={reapportion} title="清除手动设置并重新按人口核定"><Scale size={14} /> 执行换届</button>
            </div>
            {council.over && <div className="seat-warn"><AlertTriangle size={14} /> 现任议员已超出核定席位，属 GM 特别超额任命。</div>}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}><Landmark size={16} style={{ verticalAlign: -3, marginRight: 6 }} />议员任命</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>议员可发起公共提案并参与议会表决。当前共 <b>{councilors.length}</b> 位议员。</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <input className="input" placeholder="搜索用户名 / 昵称以任命" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} style={{ flex: 1 }} />
          <button className="btn" onClick={search}><Search size={15} /> 搜索</button>
        </div>
        {found.map(u => (
          <div key={u.id} className="adm-row">
            <Avatar src={u.avatar} name={u.display_name} size={36} />
            <div className="grow"><b>{u.display_name} {u.is_councilor && <span className="gm-tag councilor-tag">议员</span>}</b><div className="sub2">@{u.username} · U{u.id}</div></div>
            <div className="adm-actions">
              <button className={'btn sm' + (u.is_councilor ? '' : ' primary')} onClick={() => setCouncil(u, !u.is_councilor)}>
                <Landmark size={13} /> {u.is_councilor ? '免去议员' : '任命议员'}
              </button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: found.length ? 14 : 0 }}>
          {councilors.length === 0 ? <div className="empty" style={{ padding: 20 }}>暂无议员</div> : (
            <div className="council-chips">
              {councilors.map(u => (
                <span key={u.id} className="council-chip">
                  <Avatar src={u.avatar} name={u.display_name} size={22} /> {u.display_name}
                  <button onClick={() => setCouncil(u, false)} title="免去议员"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}><Gavel size={16} style={{ verticalAlign: -3, marginRight: 6 }} />提案审议</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>采纳「待采纳」提案使其进入议员表决；表决中可随时计票公布结果（&gt;50% 一般决议，&gt;67% 特别决议）。</p>
        {pending.length === 0 ? <div className="empty" style={{ padding: 20 }}>当前没有待处理的提案</div> : pending.map(p => {
          const t = p.live_tally || { for: 0, against: 0, abstain: 0, total: 0, ratio: 0 };
          return (
            <div key={p.id} className="adm-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <b>{p.title} <span className={'pl-status ' + (p.status === 'voting' ? 'voting' : 'pending')} style={{ marginLeft: 4 }}>{STLABEL[p.status]}</span></b>
                <div className="sub2">提案人 {p.author_name} · 赞成 {t.for} / 反对 {t.against} / 弃权 {t.abstain}（{Math.round((t.ratio || 0) * 100)}%）</div>
              </div>
              <div className="adm-actions">
                {p.status === 'pending' && <button className="btn sm primary" onClick={() => pact(p.id, 'adopt')}><Check size={13} /> 采纳</button>}
                {p.status === 'voting' && <button className="btn sm primary" onClick={() => pact(p.id, 'close')}><Scale size={13} /> 计票</button>}
                <button className="btn sm" onClick={() => pact(p.id, 'reject')}><X size={13} /> 驳回</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
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
