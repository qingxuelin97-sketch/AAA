import React, { useEffect, useMemo, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Uploader, Modal, Avatar } from '../ui.jsx';
import StageEditor from '../components/StageEditor.jsx';
import NovelWorldEditor from '../components/NovelWorldEditor.jsx';
import { BookOpen, Users, Plus, Check, Feather, Sparkles, ChevronRight, ChevronDown, ChevronUp,
  Image as ImageIcon, Search, Flag, Clock3, AlignLeft } from 'lucide-react';

const STYLE_PRESETS = ['古典雅致', '轻快幽默', '悬疑紧张', '热血激昂', '温柔治愈', '黑暗残酷', '武侠古风', '赛博科幻'];

// 相对时间：书架上的「x 前更新」。服务端给的是 UTC 的 'YYYY-MM-DD HH:MM:SS'。
function timeAgo(s) {
  if (!s) return '';
  const t = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') || String(s).includes('T') ? '' : 'Z')).getTime();
  if (!t) return '';
  const d = Date.now() - t;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + ' 小时前';
  if (d < 30 * 86_400_000) return Math.floor(d / 86_400_000) + ' 天前';
  return new Date(t).toLocaleDateString();
}

// 互动小说（原「剧场」）：以你为主角的即兴叙事。挑选登场角色、写下序章，
// 进入后写行动 / 台词，旁白续写后果，角色随时接话 —— 一部由你共同写就的小说。
export default function Theater() {
  const { user } = useAuth();
  const [theaters, setTheaters] = useState([]);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('all');   // all | mine | reading
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api('/theater').then(d => setTheaters(d.theaters)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const shown = useMemo(() => {
    let list = theaters;
    if (tab === 'mine') list = list.filter(t => user && t.owner_id === user.id);
    if (tab === 'reading') list = list.filter(t => t.joined && (!user || t.owner_id !== user.id));
    const k = q.trim().toLowerCase();
    if (k) list = list.filter(t => (t.name || '').toLowerCase().includes(k) || (t.scene || '').toLowerCase().includes(k) || (t.style || '').toLowerCase().includes(k));
    return list;
  }, [theaters, tab, q, user]);

  const counts = useMemo(() => ({
    mine: theaters.filter(t => user && t.owner_id === user.id).length,
    reading: theaters.filter(t => t.joined && (!user || t.owner_id !== user.id)).length,
  }), [theaters, user]);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>互动小说 <Feather size={17} style={{ color: 'var(--accent)' }} /></h1>
          <div className="sub">你是主角，也是作者 —— 写下行动，旁白续写后果，角色随时接话，剧情走向无人能预料</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 创作新故事</button>
      </div>
      <div className="page">
        <div className="wb-list-controls">
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部</button>
            <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我创作的{counts.mine ? ` (${counts.mine})` : ''}</button>
            <button className={tab === 'reading' ? 'active' : ''} onClick={() => setTab('reading')}>在读{counts.reading ? ` (${counts.reading})` : ''}</button>
          </div>
          <div className="wb-search">
            <Search size={14} />
            <input placeholder="搜索书名 / 序章 / 文风" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="empty">
            <div className="big"><BookOpen size={46} /></div>
            {q ? '没有匹配的故事' : tab === 'mine' ? '你还没有创作过故事' : tab === 'reading' ? '还没有在读的故事' : '还没有故事'}
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => setCreating(true)}><Feather size={15} /> 开写你的第一部互动小说</button></div>
          </div>
        ) : (
          <div className="inovel-shelf">
            {shown.map(t => (
              <div key={t.id} className="inovel-book-card" onClick={() => nav('/theater/' + t.id)}>
                <div className="inovel-spine" />
                <div className="inovel-bc-cover">
                  {t.cover ? <img src={assetUrl(t.cover)} alt="" /> : <div className="inovel-bc-ph"><BookOpen size={26} /></div>}
                  <div className="inovel-bc-kicker"><Feather size={11} /> 互动小说</div>
                  {t.status === 'finished'
                    ? <div className="inovel-bc-status fin"><Flag size={10} /> 完结</div>
                    : <div className="inovel-bc-status"><Clock3 size={10} /> 连载中</div>}
                </div>
                <div className="inovel-bc-meta">
                  <b>{t.name}{t.style && <span className="inovel-style-tag">{t.style}</span>}</b>
                  <p>{t.scene || '一个等待被写下的故事…'}</p>
                  <div className="inovel-bc-foot">
                    <span><BookOpen size={11} /> {t.cast_count} 位角色</span>
                    <span><Users size={11} /> {t.member_count} 读者</span>
                    {t.message_count > 0 && <span><AlignLeft size={11} /> {t.message_count} 段</span>}
                    {t.last_at && <span className="inovel-bc-time">{timeAgo(t.last_at)}更新</span>}
                    <span className="inovel-bc-open">{t.joined ? '继续阅读' : '进入故事'} <ChevronRight size={12} /></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={(id) => nav('/theater/' + id)} />}
    </>
  );
}

function CreateModal({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', scene: '', cover: '', style: '' });
  const [pool, setPool] = useState([]);
  const [picked, setPicked] = useState([]);
  const [stageCfg, setStageCfg] = useState({ charAuto: true, charBg: {}, scenes: [] });
  const [novelWb, setNovelWb] = useState([]);
  const [showStage, setShowStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([api('/characters/public').catch(() => ({ characters: [] })), api('/characters/mine').catch(() => ({ characters: [] }))])
      .then(([a, b]) => {
        const map = new Map();
        [...a.characters, ...b.characters].forEach(c => map.set(c.id, c));
        setPool([...map.values()]);
      });
  }, []);

  const toggle = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const create = async () => {
    if (!form.name.trim()) return toast('请填写作品名称', 'err');
    if (picked.length === 0) return toast('至少选择一位登场角色', 'err');
    setBusy(true);
    try {
      const d = await api('/theater', { method: 'POST', body: { ...form, cast: picked, stage_config: stageCfg, worldbook: novelWb } });
      onDone(d.theater.id);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Feather size={18} /> 创作互动小说</h2>
      <div className="field"><label>作品名称</label>
        <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：永青森林的不速之客" /></div>
      <div className="field"><label>序章 / 开场设定</label>
        <textarea className="textarea" value={form.scene} onChange={e => setForm({ ...form, scene: e.target.value })} placeholder="描述故事发生的舞台与起始情境，将作为开篇旁白引你入戏…" /></div>
      <div className="field"><label>文风基调 <span className="muted">(可选 · 影响旁白与角色的行文，之后可在导演台修改)</span></label>
        <div className="inovel-style-row">
          {STYLE_PRESETS.map(s => (
            <button key={s} type="button" className={'inovel-style-chip' + (form.style === s ? ' on' : '')}
              onClick={() => setForm(f => ({ ...f, style: f.style === s ? '' : s }))}>{s}</button>
          ))}
        </div>
      </div>
      <div className="field"><label>封面 <span className="muted">(可选)</span></label>
        <Uploader value={form.cover} onChange={url => setForm({ ...form, cover: url })} accept="image/*" /></div>
      <div className="field">
        <label>登场角色 <span className="muted">({picked.length} 已选)</span></label>
        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pool.length === 0 && <div className="muted" style={{ fontSize: 13 }}>暂无可选角色，先去创建或收藏一些角色吧</div>}
          {pool.map(c => (
            <div key={c.id} onClick={() => toggle(c.id)} style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: 8, borderRadius: 10, cursor: 'pointer',
              border: '1px solid var(--border)', background: picked.includes(c.id) ? 'var(--accent-soft)' : 'transparent'
            }}>
              <Avatar src={c.avatar} name={c.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{c.name}</b>
                <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.tagline}</div>
              </div>
              {picked.includes(c.id) && <Check size={18} color="var(--accent)" />}
            </div>
          ))}
        </div>
      </div>
      <div className="stage-fold">
        <button type="button" className="stage-fold-head" onClick={() => setShowStage(s => !s)}>
          <ImageIcon size={15} /> 舞台背景 · 专属世界书 <span className="muted">（进阶 · 可后续在故事内修改）</span>
          {(() => { const n = Object.keys(stageCfg.charBg).length + stageCfg.scenes.length + novelWb.length; return n > 0 ? <span className="stage-fold-badge">{n} 项</span> : null; })()}
          <span style={{ marginLeft: 'auto' }}>{showStage ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
        </button>
        {showStage && (
          <div className="stage-fold-body">
            <StageEditor cast={pool.filter(c => picked.includes(c.id))} value={stageCfg} onChange={setStageCfg} />
            <div className="stage-sec-title" style={{ marginTop: 14 }}><BookOpen size={13} /> 互动小说专属世界书</div>
            <NovelWorldEditor value={novelWb} onChange={setNovelWb} />
          </div>
        )}
      </div>

      <div className="row">
        <button className="btn block" onClick={onClose}>取消</button>
        <button className="btn primary block" onClick={create} disabled={busy}><Sparkles size={15} /> {busy ? '落笔中…' : '落笔开篇'}</button>
      </div>
    </Modal>
  );
}
