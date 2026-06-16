import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Uploader } from '../ui.jsx';

export default function Publish() {
  const nav = useNavigate();
  const toast = useToast();
  const [type, setType] = useState('script');
  const [form, setForm] = useState({ title: '', body: '', cover: '', tags: '', character_id: '' });
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/characters/mine').then(d => setMine(d.characters)).catch(() => {}); }, []);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { toast('请填写标题', 'err'); return; }
    setBusy(true);
    try {
      if (type === 'card' && form.character_id) {
        await api('/community/publish-character/' + form.character_id, { method: 'POST' });
      } else {
        await api('/community/posts', { method: 'POST', body: { ...form, type, character_id: form.character_id || null } });
      }
      toast('发布成功 🎉');
      nav('/');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← 返回</button>
        <div style={{ flex: 1 }}><h1>发布到广场</h1><div className="sub">分享你的剧本或角色卡，让更多玩家体验</div></div>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? '发布中…' : '发布'}</button>
      </div>
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="tabs-bar">
          <button className={type === 'script' ? 'active' : ''} onClick={() => setType('script')}>📜 剧本 / 故事</button>
          <button className={type === 'card' ? 'active' : ''} onClick={() => setType('card')}>🎭 角色卡</button>
        </div>

        {type === 'card' && (
          <div className="field">
            <label>选择要发布的角色</label>
            <select className="select" value={form.character_id} onChange={e => {
              const c = mine.find(x => String(x.id) === e.target.value);
              setForm(p => ({ ...p, character_id: e.target.value, title: c?.name || p.title, body: c?.tagline || p.body, cover: c?.avatar || p.cover }));
            }}>
              <option value="">— 选择我的角色 —</option>
              {mine.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="hint">发布角色卡会将该角色设为公开，其他玩家可一键导入到自己的角色库。</div>
          </div>
        )}

        <div className="field"><label>标题</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder={type === 'script' ? '剧本标题' : '角色卡标题'} /></div>
        <div className="field"><label>简介 / 正文</label>
          <textarea className="textarea" style={{ minHeight: type === 'script' ? 200 : 100 }} value={form.body} onChange={e => set('body', e.target.value)}
            placeholder={type === 'script' ? '描述剧情背景、玩法、开场设定…' : '介绍这个角色的亮点'} /></div>
        <div className="field"><label>标签 <span className="muted">(逗号分隔)</span></label>
          <input className="input" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="悬疑, 校园, 多结局" /></div>
        <div className="field"><label>封面图</label>
          <Uploader value={form.cover} onChange={url => set('cover', url)} accept="image/*" /></div>
      </div>
    </>
  );
}
