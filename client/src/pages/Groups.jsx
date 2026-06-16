import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, Uploader, Modal } from '../ui.jsx';
import { Users, Plus, MessageCircle } from 'lucide-react';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api('/groups').then(d => setGroups(d.groups)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const open = async (g) => {
    try { if (!g.joined) await api('/groups/' + g.id + '/join', { method: 'POST' }); nav('/group/' + g.id); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>群聊</h1><div className="sub">和同好们一起讨论角色、剧本与脑洞</div></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 创建群聊</button>
      </div>
      <div className="page">
        {groups.length === 0 ? <div className="empty"><div className="big"><MessageCircle size={46} /></div>还没有群聊，创建一个吧</div> :
          groups.map(g => (
            <div key={g.id} className="room-row" onClick={() => open(g)}>
              {g.avatar ? <img className="ava" src={g.avatar} alt="" /> : <div className="ava" style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-2)' }}><Users size={22} /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 15 }}>{g.name}</b>
                <div className="muted" style={{ fontSize: 13, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.description || '暂无群简介'}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}><Users size={11} style={{ verticalAlign: -1 }} /> {g.member_count} 人 · 群主 {g.owner_name}</div>
              </div>
              {g.joined ? <span className="tag">已加入</span> : <button className="btn sm">加入</button>}
            </div>
          ))}
      </div>
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={(id) => nav('/group/' + id)} />}
    </>
  );
}

function CreateModal({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', description: '', avatar: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const create = async () => {
    if (!form.name.trim()) return toast('请填写群名称', 'err');
    setBusy(true);
    try { const d = await api('/groups', { method: 'POST', body: form }); onDone(d.group.id); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>创建群聊</h2>
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}>
        <Uploader variant="avatar" value={form.avatar} onChange={url => setForm({ ...form, avatar: url })} accept="image/*" />
      </div>
      <div className="field"><label>群名称</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：幻域创作者联盟" /></div>
      <div className="field"><label>群简介</label><textarea className="textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="介绍一下这个群…" /></div>
      <div className="row"><button className="btn block" onClick={onClose}>取消</button><button className="btn primary block" onClick={create} disabled={busy}>{busy ? '创建中…' : '创建'}</button></div>
    </Modal>
  );
}
