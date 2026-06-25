import React, { useEffect, useState } from 'react';
import { api, useAuth, getToken } from '../api.jsx';
import { useToast, Avatar, Modal, CouncilorBadge } from '../ui.jsx';
import { Shield, Users, ScrollText, Tag, Megaphone, Gift, Ban, Crown, Trash2, Plus, Copy, Check, Search, AlertTriangle, Cpu, Landmark, Gavel, Scale, Radio, X, MessageSquare, UserCheck, TrendingUp, Volume2, RefreshCw, Download, Upload, Coins, Gem } from 'lucide-react';
import { BarChart, LineChart } from '../components/Charts.jsx';

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
  const [series, setSeries] = useState(null);
  const [economy, setEconomy] = useState(null);
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const restoreRef = React.useRef();
  useEffect(() => {
    api('/admin/stats').then(d => { setStats(d.stats); setSeries(d.series); setEconomy(d.economy); }).catch(e => toast(e.message, 'err'));
    /* eslint-disable-next-line */
  }, []);

  const backup = async () => {
    try {
      const d = await api('/admin/backup');
      const blob = new Blob([JSON.stringify(d)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `huanyu-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已导出全站数据备份');
    } catch (e) { toast(e.message, 'err'); }
  };
  const restore = async (file) => {
    if (!file) return;
    if (!confirm('确定用该备份覆盖当前全站数据？此操作不可撤销，建议先导出当前数据。')) return;
    try {
      const data = JSON.parse(await file.text());
      await api('/admin/restore', { method: 'POST', body: data });
      toast('数据已恢复，请刷新页面'); setTimeout(() => location.reload(), 1200);
    } catch (e) { toast('恢复失败：' + e.message, 'err'); }
  };

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

      {series && (
        <div className="card chart-card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2><TrendingUp size={16} style={{ verticalAlign: -3, marginRight: 6 }} />近 14 天新增用户</h2></div>
          <LineChart data={(series.users || []).map(d => ({ x: d.date, y: d.n }))} color="var(--diamond)" unit=" 人" />
          <div className="chart-grid" style={{ marginTop: 14 }}>
            <div><div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>每日新增角色</div><BarChart data={(series.characters || []).slice(-10).map(d => ({ label: d.date.slice(3), value: d.n }))} color="var(--accent)" height={130} /></div>
            <div><div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>每日新增对话</div><BarChart data={(series.conversations || []).slice(-10).map(d => ({ label: d.date.slice(3), value: d.n }))} color="var(--ok)" height={130} /></div>
          </div>
        </div>
      )}
      {economy && (
        <div className="adm-stats adm-stats-rich" style={{ marginTop: 14 }}>
          <div className="adm-stat"><span className="adm-stat-ic"><Coins size={16} /></span><b className="gold-num">{economy.gold_in}</b><span>金币产出</span></div>
          <div className="adm-stat"><span className="adm-stat-ic"><Coins size={16} /></span><b>{economy.gold_out}</b><span>金币消耗</span></div>
          <div className="adm-stat"><span className="adm-stat-ic"><Gem size={16} /></span><b>{economy.diamond_in}</b><span>钻石产出</span></div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}><Download size={16} style={{ verticalAlign: -3, marginRight: 6 }} />数据保全（备份 / 恢复）</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>导出整站数据为 JSON 离线保存；重新部署导致数据重置后，可用备份一键恢复，避免数据丢失。</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={backup}><Download size={15} /> 导出全站备份</button>
          <button className="btn" onClick={() => restoreRef.current?.click()}><Upload size={15} /> 从备份恢复</button>
          <input ref={restoreRef} type="file" accept="application/json" hidden onChange={e => { restore(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
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
            <b>{u.display_name} {u.is_gm && <span className="gm-tag">GM</span>} {u.is_councilor && <CouncilorBadge size={12} />} {u.is_banned && <span className="ban-flag">已封禁</span>}</b>
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

// Provider presets shared with the user-facing Settings page (kept in sync conceptually).
const PF_LLM_PRESETS = [
  ['openai', 'OpenAI', 'https://api.openai.com/v1', 'openai'], ['anthropic', 'Anthropic Claude', 'https://api.anthropic.com', 'anthropic'],
  ['zhipu', '智谱 GLM（清言）', 'https://open.bigmodel.cn/api/paas/v4', 'openai'], ['deepseek', 'DeepSeek 深度求索', 'https://api.deepseek.com/v1', 'openai'],
  ['moonshot', 'Moonshot / Kimi', 'https://api.moonshot.cn/v1', 'openai'], ['qwen', '通义千问 Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai'],
  ['doubao', '字节豆包 Doubao', 'https://ark.cn-beijing.volces.com/api/v3', 'openai'], ['yi', '零一万物 Yi', 'https://api.lingyiwanwu.com/v1', 'openai'],
  ['stepfun', '阶跃星辰 StepFun', 'https://api.stepfun.com/v1', 'openai'], ['minimax', 'MiniMax', 'https://api.minimax.chat/v1', 'openai'],
  ['spark', '讯飞星火', 'https://spark-api-open.xf-yun.com/v1', 'openai'], ['baidu', '百度文心一言', 'https://qianfan.baidubce.com/v2', 'openai'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'openai'],
  ['siliconflow', '硅基流动 SiliconFlow', 'https://api.siliconflow.cn/v1', 'openai'], ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'openai'],
  ['groq', 'Groq', 'https://api.groq.com/openai/v1', 'openai'], ['together', 'Together', 'https://api.together.xyz/v1', 'openai'],
  ['mistral', 'Mistral AI', 'https://api.mistral.ai/v1', 'openai'], ['ollama', 'Ollama 本地', 'http://localhost:11434/v1', 'openai'],
  ['lmstudio', 'LM Studio 本地', 'http://localhost:1234/v1', 'openai'], ['custom', '自定义', '', 'openai'],
];
const PF_VOICE_PRESETS = [
  ['openai', 'OpenAI（tts-1 / gpt-4o-mini-tts）', 'https://api.openai.com/v1', 'openai'],
  ['groq', 'Groq · PlayAI TTS', 'https://api.groq.com/openai/v1', 'openai'],
  ['siliconflow', '硅基流动（CosyVoice / Fish-Speech）', 'https://api.siliconflow.cn/v1', 'openai'],
  ['aliyun', '阿里云百炼 · 通义千问语音（Qwen-TTS）', 'https://dashscope.aliyuncs.com', 'aliyun'],
  ['baidu', '百度智能云 · 在线语音合成', 'https://tsn.baidu.com', 'baidu'],
  ['volcano', '火山引擎 · 豆包语音合成', 'https://openspeech.bytedance.com', 'volcano'],
  ['tencent', '腾讯云 · 语音合成 TTS', 'https://tts.tencentcloudapi.com', 'tencent'],
  ['elevenlabs', 'ElevenLabs', 'https://api.elevenlabs.io/v1', 'elevenlabs'],
  ['minimax', 'MiniMax 海螺（需 GroupId）', 'https://api.minimax.chat/v1', 'minimax'],
  ['azure', 'Azure 认知语音', 'https://eastus.tts.speech.microsoft.com', 'azure'],
  ['google', 'Google Cloud TTS', 'https://texttospeech.googleapis.com', 'google'],
  ['deepgram', 'Deepgram Aura', 'https://api.deepgram.com', 'deepgram'],
  ['custom', '自定义（OpenAI /audio/speech 兼容）', '', 'openai'],
];
const PF_IMAGE_PRESETS = [
  ['openai', 'OpenAI（gpt-image-1 / dall-e-3）', 'https://api.openai.com/v1'],
  ['siliconflow', '硅基流动（Kolors / SD）', 'https://api.siliconflow.cn/v1'],
  ['custom', '自定义（OpenAI /images/generations 兼容）', ''],
];
const IMG_SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512', '768x1024', '1024x768'];

function PlatformTab({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  // language
  const [llm, setLlm] = useState({ provider: 'custom', base_url: '', model: '', protocol: 'openai', system_prompt: '', key: '' });
  // voice
  const [voice, setVoice] = useState({ provider: 'openai', base_url: '', model: '', protocol: 'openai', voice_name: '', key: '' });
  // image
  const [image, setImage] = useState({ provider: 'openai', base_url: '', model: '', protocol: 'openai', size: '1024x1024', key: '' });
  const [llmModels, setLlmModels] = useState([]);
  const [voiceModels, setVoiceModels] = useState([]);
  const [det, setDet] = useState('');
  const [vprev, setVprev] = useState(false);

  // 试听平台语音 — synthesize a sample with the current form values (server falls
  // back to the saved key when the key field is left blank).
  const previewVoice = async () => {
    if (vprev) return;
    if (!voice.base_url) { toast('请先填写语音服务的 Base URL', 'err'); return; }
    setVprev(true);
    try {
      const res = await fetch('/api/admin/platform/test-voice', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ voice: { protocol: voice.protocol, base_url: voice.base_url, model: voice.model, voice_name: voice.voice_name, key: voice.key } })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      audio.onended = () => setVprev(false); audio.onerror = () => setVprev(false);
      await audio.play();
      toast('平台语音试听播放中');
    } catch (e) { toast(e.message, 'err'); setVprev(false); }
  };

  const detect = async (kind) => {
    const cfg = kind === 'voice' ? voice : llm;
    if (!cfg.base_url) { toast('请先填写该服务的 Base URL', 'err'); return; }
    setDet(kind);
    try {
      const d = await api('/settings/models', { method: 'POST', body: { base_url: cfg.base_url, api_key: cfg.key || undefined, protocol: cfg.protocol } });
      if (!d.models?.length) { toast('未返回任何模型（请在下方先填入该服务的密钥再检测）', 'err'); return; }
      (kind === 'voice' ? setVoiceModels : setLlmModels)(d.models);
      toast(`检测到 ${d.models.length} 个可用模型`);
    } catch (e) { toast(e.message, 'err'); } finally { setDet(''); }
  };

  const load = () => api('/admin/platform').then(d => {
    const p = d.platform; setCfg(p);
    setLlm({ provider: 'custom', base_url: p.base_url || '', model: p.model || '', protocol: p.protocol || 'openai', system_prompt: p.system_prompt || '', key: '' });
    setVoice({ provider: p.voice?.provider || 'openai', base_url: p.voice?.base_url || '', model: p.voice?.model || '', protocol: p.voice?.protocol || 'openai', voice_name: p.voice?.voice_name || '', key: '' });
    setImage({ provider: p.image?.provider || 'openai', base_url: p.image?.base_url || '', model: p.image?.model || '', protocol: p.image?.protocol || 'openai', size: p.image?.size || '1024x1024', key: '' });
  }).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async (section) => {
    setBusy(true);
    try {
      let body = {};
      if (section === 'llm') { body = { base_url: llm.base_url, model: llm.model, protocol: llm.protocol, system_prompt: llm.system_prompt }; if (llm.key.trim()) body.key = llm.key.trim(); }
      if (section === 'voice') { body = { voice: { provider: voice.provider, base_url: voice.base_url, model: voice.model, protocol: voice.protocol, voice_name: voice.voice_name } }; if (voice.key.trim()) body.voice.key = voice.key.trim(); }
      if (section === 'image') { body = { image: { provider: image.provider, base_url: image.base_url, model: image.model, protocol: image.protocol, size: image.size } }; if (image.key.trim()) body.image.key = image.key.trim(); }
      const d = await api('/admin/platform', { method: 'PUT', body });
      setCfg(d.platform); setLlm(l => ({ ...l, key: '' })); setVoice(v => ({ ...v, key: '' })); setImage(i => ({ ...i, key: '' }));
      toast('已保存，立即对全体生效');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (!cfg) return <div className="empty">载入中…</div>;
  return (
    <>
      {/* ---- 语言模型 ---- */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title"><h2 style={{ fontSize: 17 }}><Cpu size={16} style={{ verticalAlign: -3, marginRight: 6 }} />平台内置语言服务</h2>
          <button className="btn sm primary" disabled={busy} onClick={() => save('llm')}><Check size={14} /> 保存</button></div>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>未配置自有 API 的用户对话时统一调用此服务。<b>群体性配置，修改后立即对全体无 API 用户生效</b>，普通用户看不到任何接口或密钥。</p>
        <div className="row">
          <div className="field"><label>服务商预设</label>
            <select className="select" value={llm.provider} onChange={e => { const v = e.target.value; const pr = PF_LLM_PRESETS.find(x => x[0] === v); setLlm(l => ({ ...l, provider: v, ...(pr ? { base_url: pr[2] || l.base_url, protocol: pr[3] } : {}) })); }}>
              {PF_LLM_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="field"><label>协议</label>
            <select className="select" value={llm.protocol} onChange={e => setLlm(l => ({ ...l, protocol: e.target.value }))}>
              <option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option>
            </select></div>
        </div>
        <div className="field"><label>API Base URL</label><input className="input" value={llm.base_url} onChange={e => setLlm(l => ({ ...l, base_url: e.target.value }))} placeholder="https://open.bigmodel.cn/api/paas/v4" /></div>
        <div className="field"><label>最终调用模型</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={llm.model} onChange={e => setLlm(l => ({ ...l, model: e.target.value }))} placeholder="glm-5.2" list="pf-llm-models" />
            <button className="btn" type="button" onClick={() => detect('llm')} disabled={det === 'llm'}><RefreshCw size={15} className={det === 'llm' ? 'spin' : ''} /> {det === 'llm' ? '检测中' : '检测模型'}</button>
          </div>
          {llmModels.length > 0 && (<>
            <datalist id="pf-llm-models">{llmModels.map(m => <option key={m} value={m} />)}</datalist>
            <select className="select" style={{ marginTop: 8 }} value={llmModels.includes(llm.model) ? llm.model : ''} onChange={e => e.target.value && setLlm(l => ({ ...l, model: e.target.value }))}>
              <option value="">— 从检测到的 {llmModels.length} 个模型中选择 —</option>
              {llmModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select></>)}
          <div className="hint">检测前请先在下方填入该服务的密钥（检测需要密钥）。</div></div>
        <div className="field"><label>API Key {cfg.key_set && <span className="tag">已配置 · {cfg.key_masked}</span>}</label>
          <input className="input" type="password" value={llm.key} onChange={e => setLlm(l => ({ ...l, key: e.target.value }))} placeholder={cfg.key_set ? '••••••（留空则不修改）' : '填写平台密钥'} /></div>
        <div className="field"><label>平台系统提示词（全局）</label>
          <textarea className="input" rows={5} value={llm.system_prompt} onChange={e => setLlm(l => ({ ...l, system_prompt: e.target.value }))} style={{ resize: 'vertical', lineHeight: 1.6 }}
            placeholder="统一的安全 / 风格约束、平台世界观等。自动前置注入到所有「无自有 API」用户的每次对话，与角色人设叠加。留空则不注入。" /></div>
        {cfg.fee && <p className="muted" style={{ fontSize: 12.5 }}>对话计费：每次 {cfg.fee.base} 金币；单对话超 {cfg.fee.heavy_threshold} 条后 {cfg.fee.heavy} 金币（VIP 75 折 / SVIP 5 折，结算自动应用）。</p>}
      </div>

      {/* ---- 语音合成 ---- */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title"><h2 style={{ fontSize: 17 }}><Volume2 size={16} style={{ verticalAlign: -3, marginRight: 6 }} />平台语音合成服务</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" disabled={vprev} onClick={previewVoice}><Volume2 size={14} className={vprev ? 'spin' : ''} /> {vprev ? '播放中' : '试听'}</button>
            <button className="btn sm primary" disabled={busy} onClick={() => save('voice')}><Check size={14} /> 保存</button>
          </div></div>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>未配置自有语音 API 的用户朗读时调用此服务，<b>每句扣费 {cfg.voice?.fee ?? 10} 金币</b>（VIP 75 折 / SVIP 5 折）。配置后用户即可付费朗读。</p>
        <div className="row">
          <div className="field"><label>服务商预设</label>
            <select className="select" value={voice.provider} onChange={e => { const v = e.target.value; const pr = PF_VOICE_PRESETS.find(x => x[0] === v); setVoice(s => ({ ...s, provider: v, ...(pr ? { base_url: pr[2] || s.base_url, protocol: pr[3] } : {}) })); }}>
              {PF_VOICE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="field"><label>模型</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} value={voice.model} onChange={e => setVoice(s => ({ ...s, model: e.target.value }))} placeholder="tts-1 / eleven_multilingual_v2" list="pf-voice-models" />
              <button className="btn" type="button" onClick={() => detect('voice')} disabled={det === 'voice'}><RefreshCw size={15} className={det === 'voice' ? 'spin' : ''} /></button>
            </div>
            {voiceModels.length > 0 && (<>
              <datalist id="pf-voice-models">{voiceModels.map(m => <option key={m} value={m} />)}</datalist>
              <select className="select" style={{ marginTop: 8 }} value={voiceModels.includes(voice.model) ? voice.model : ''} onChange={e => e.target.value && setVoice(s => ({ ...s, model: e.target.value }))}>
                <option value="">— 选择检测到的 {voiceModels.length} 个模型 —</option>
                {voiceModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select></>)}
          </div>
        </div>
        <div className="field"><label>API Base URL</label><input className="input" value={voice.base_url} onChange={e => setVoice(s => ({ ...s, base_url: e.target.value }))} placeholder="https://api.openai.com/v1" />
          {voice.protocol === 'minimax' && <div className="hint">MiniMax 海螺：Base URL 后附 <code>?GroupId=你的GroupId</code>（或不附、在 API Key 处填 <b>GroupId:APIKey</b>）。模型填 <code>speech-02-hd</code> / <code>speech-01-turbo</code>，默认音色填 <code>voice_id</code>（如 male-qn-qingse）。</div>}
          {voice.protocol === 'aliyun' && <div className="hint">阿里云百炼（DashScope）固定填 <code>https://dashscope.aliyuncs.com</code>，模型填 <code>qwen-tts</code>；API Key 为百炼控制台的 <code>DASHSCOPE_API_KEY</code>。</div>}
          {voice.protocol === 'baidu' && <div className="hint">百度智能云固定填 <code>https://tsn.baidu.com</code>；API Key 处填 <b>API Key:Secret Key</b>（英文冒号连接）。默认音色填发音人 <code>per</code>（如 0/1/3/5118）。</div>}
          {voice.protocol === 'volcano' && <div className="hint">火山引擎固定填 <code>https://openspeech.bytedance.com</code>，模型填集群名 <code>volcano_tts</code>；API Key 处填 <b>AppID:AccessToken</b>（英文冒号连接）。默认音色填 <code>voice_type</code>（如 BV001_streaming）。</div>}
          {voice.protocol === 'tencent' && <div className="hint">腾讯云固定填 <code>https://tts.tencentcloudapi.com</code>，模型处填地域 Region（如 <code>ap-guangzhou</code>）；API Key 处填 <b>SecretId:SecretKey</b>（英文冒号连接）。默认音色填 <code>VoiceType</code> 编号（如 101001 智瑜）。TC3 服务端签名，仅服务端部署版可用。</div>}</div>
        <div className="row">
          <div className="field"><label>默认音色</label><input className="input" value={voice.voice_name} onChange={e => setVoice(s => ({ ...s, voice_name: e.target.value }))} placeholder={voice.protocol === 'aliyun' ? 'Cherry / Ethan / Serena / Chelsie' : voice.protocol === 'baidu' ? '0 度小美 / 1 度小宇 / 5118 度小鹿' : voice.protocol === 'volcano' ? 'BV001_streaming / BV700_streaming' : voice.protocol === 'minimax' ? 'male-qn-qingse / female-shaonv' : voice.protocol === 'tencent' ? '101001 智瑜 / 101002 智聆' : 'alloy / 21m00Tcm... / zh-CN-XiaoxiaoNeural'} /></div>
          <div className="field"><label>API Key {cfg.voice?.key_set && <span className="tag">已配置 · {cfg.voice.key_masked}</span>}</label>
            <input className="input" type="password" value={voice.key} onChange={e => setVoice(s => ({ ...s, key: e.target.value }))} placeholder={cfg.voice?.key_set ? '••••••（留空则不修改）' : voice.protocol === 'baidu' ? 'API Key:Secret Key' : voice.protocol === 'volcano' ? 'AppID:AccessToken' : voice.protocol === 'minimax' ? 'APIKey（或 GroupId:APIKey）' : voice.protocol === 'tencent' ? 'SecretId:SecretKey' : '填写平台语音密钥'} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>留空密钥则平台语音关闭，用户需自备语音 API 才能朗读（自备则免费）。</p>
      </div>

      {/* ---- AI 生图 ---- */}
      <div className="card">
        <div className="section-title"><h2 style={{ fontSize: 17 }}><Cpu size={16} style={{ verticalAlign: -3, marginRight: 6 }} />平台 AI 生图服务</h2>
          <button className="btn sm primary" disabled={busy} onClick={() => save('image')}><Check size={14} /> 保存</button></div>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>「AI 绘图」页与聊天插图调用此服务，<b>每张扣费 {cfg.image?.fee ?? 20} 金币</b>（VIP 75 折 / SVIP 5 折）。需兼容 OpenAI <code>/images/generations</code>。</p>
        <div className="row">
          <div className="field"><label>服务商预设</label>
            <select className="select" value={image.provider} onChange={e => { const v = e.target.value; const pr = PF_IMAGE_PRESETS.find(x => x[0] === v); setImage(s => ({ ...s, provider: v, ...(pr ? { base_url: pr[2] || s.base_url } : {}) })); }}>
              {PF_IMAGE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="field"><label>模型</label><input className="input" value={image.model} onChange={e => setImage(s => ({ ...s, model: e.target.value }))} placeholder="gpt-image-1 / dall-e-3 / Kwai-Kolors/Kolors" /></div>
        </div>
        <div className="field"><label>API Base URL</label><input className="input" value={image.base_url} onChange={e => setImage(s => ({ ...s, base_url: e.target.value }))} placeholder="https://api.openai.com/v1" /></div>
        <div className="row">
          <div className="field"><label>默认画幅</label>
            <select className="select" value={image.size} onChange={e => setImage(s => ({ ...s, size: e.target.value }))}>
              {IMG_SIZES.map(z => <option key={z} value={z}>{z}</option>)}
            </select></div>
          <div className="field"><label>API Key {cfg.image?.key_set && <span className="tag">已配置 · {cfg.image.key_masked}</span>}</label>
            <input className="input" type="password" value={image.key} onChange={e => setImage(s => ({ ...s, key: e.target.value }))} placeholder={cfg.image?.key_set ? '••••••（留空则不修改）' : '填写平台生图密钥'} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>留空密钥则生图服务关闭，「AI 绘图」页会提示未开启。</p>
      </div>
    </>
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
            <div className="grow"><b>{u.display_name} {u.is_councilor && <CouncilorBadge size={12} />}</b><div className="sub2">@{u.username} · U{u.id}</div></div>
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
