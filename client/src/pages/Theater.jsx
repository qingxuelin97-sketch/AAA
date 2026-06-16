import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Uploader, Modal, Avatar } from '../ui.jsx';
import { Drama, Users, Plus, Check } from 'lucide-react';

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
          <h1>剧场</h1>
          <div className="sub">多名玩家与多个 AI 角色同台即兴演出，谁都不知道剧情会走向何方</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 创建剧场</button>
      </div>
      <div className="page">
        {theaters.length === 0 ? (
          <div className="empty"><div className="big">🎭</div>还没有剧场，开一个把你的角色们拉到同一个舞台吧</div>
        ) : theaters.map(t => (
          <div key={t.id} className="room-row" onClick={() => nav('/theater/' + t.id)}>
            {t.cover ? <img className="ava" src={t.cover} alt="" /> : <div className="ava" style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-2)' }}><Drama size={22} /></div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 15 }}>{t.name}</b>
              <div className="muted" style={{ fontSize: 13, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.scene || '自由发挥的舞台'}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>🎭 {t.cast_count} 位 AI 角色 · <Users size={11} style={{ verticalAlign: -1 }} /> {t.member_count} 人 · 由 {t.owner_name} 创建</div>
            </div>
          </div>
        ))}
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
    if (!form.name.trim()) return toast('请填写剧场名称', 'err');
    if (picked.length === 0) return toast('至少选择一位 AI 角色登场', 'err');
    setBusy(true);
    try {
      const d = await api('/theater', { method: 'POST', body: { ...form, cast: picked } });
      onDone(d.theater.id);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>创建剧场</h2>
      <div className="field"><label>剧场名称</label>
        <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：永青森林的不速之客" /></div>
      <div className="field"><label>开场场景 / 设定</label>
        <textarea className="textarea" value={form.scene} onChange={e => setForm({ ...form, scene: e.target.value })} placeholder="描述故事发生的舞台与起始情境，将作为旁白开场…" /></div>
      <div className="field"><label>封面 <span className="muted">(可选)</span></label>
        <Uploader value={form.cover} onChange={url => setForm({ ...form, cover: url })} accept="image/*" /></div>
      <div className="field">
        <label>登场 AI 角色 <span className="muted">({picked.length} 已选)</span></label>
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
        <button className="btn primary block" onClick={create} disabled={busy}>{busy ? '创建中…' : '开演'}</button>
      </div>
    </Modal>
  );
}
