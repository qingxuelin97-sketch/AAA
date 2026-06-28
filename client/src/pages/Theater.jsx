import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Uploader, Modal, Avatar } from '../ui.jsx';
import { BookOpen, Users, Plus, Check, Feather, Sparkles, ChevronRight } from 'lucide-react';

// 互动小说（原「剧场」）：以你为主角的即兴叙事。挑选登场角色、写下序章，
// 进入后写行动 / 台词，旁白续写后果，角色随时接话 —— 一部由你共同写就的小说。
export default function Theater() {
  const [theaters, setTheaters] = useState([]);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api('/theater').then(d => setTheaters(d.theaters)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
        {theaters.length === 0 ? (
          <div className="empty">
            <div className="big"><BookOpen size={46} /></div>
            还没有故事
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => setCreating(true)}><Feather size={15} /> 开写你的第一部互动小说</button></div>
          </div>
        ) : (
          <div className="inovel-shelf">
            {theaters.map(t => (
              <div key={t.id} className="inovel-book-card" onClick={() => nav('/theater/' + t.id)}>
                <div className="inovel-spine" />
                <div className="inovel-bc-cover">
                  {t.cover ? <img src={t.cover} alt="" /> : <div className="inovel-bc-ph"><BookOpen size={26} /></div>}
                  <div className="inovel-bc-kicker"><Feather size={11} /> 互动小说</div>
                </div>
                <div className="inovel-bc-meta">
                  <b>{t.name}</b>
                  <p>{t.scene || '一个等待被写下的故事…'}</p>
                  <div className="inovel-bc-foot">
                    <span><BookOpen size={11} /> {t.cast_count} 位角色</span>
                    <span><Users size={11} /> {t.member_count} 读者</span>
                    <span className="inovel-bc-open">进入故事 <ChevronRight size={12} /></span>
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
  const [form, setForm] = useState({ name: '', scene: '', cover: '' });
  const [pool, setPool] = useState([]);
  const [picked, setPicked] = useState([]);
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
      const d = await api('/theater', { method: 'POST', body: { ...form, cast: picked } });
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
      <div className="row">
        <button className="btn block" onClick={onClose}>取消</button>
        <button className="btn primary block" onClick={create} disabled={busy}><Sparkles size={15} /> {busy ? '落笔中…' : '落笔开篇'}</button>
      </div>
    </Modal>
  );
}
