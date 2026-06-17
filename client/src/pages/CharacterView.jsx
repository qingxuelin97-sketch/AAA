import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { pid } from '../assets.jsx';
import { MessageCircle, Heart, Pencil, BookOpen, ArrowLeft, Sparkles, Globe } from 'lucide-react';

export default function CharacterView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [faved, setFaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/characters/' + id).then(d => setC(d.character)).catch(e => toast(e.message, 'err'));
    api('/characters/public').then(d => { const hit = d.characters.find(x => x.id === +id); if (hit) setFaved(!!hit.faved); }).catch(() => {});
  }, [id]);

  if (!c) return (
    <><div className="topbar"><button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button><div style={{ flex: 1 }}><h1>角色</h1></div></div>
      <div className="page"><div className="empty">载入中…</div></div></>
  );

  const isOwner = user && c.owner_id === user.id;
  const isVideo = c.background_type === 'video';

  const startChat = async () => {
    setBusy(true);
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const toggleFav = async () => {
    try { const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' }); setFaved(d.faved); toast(d.faved ? '已收藏' : '已取消收藏'); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1 }}><h1>{c.name}</h1><div className="sub">角色卡 · {pid('character', c.id)}</div></div>
        {isOwner && <button className="btn" onClick={() => nav('/character/' + c.id + '/edit')}><Pencil size={15} /> 编辑</button>}
      </div>
      <div className="page" style={{ maxWidth: 860 }}>
        <div className="char-hero">
          <div className="char-hero-bg">
            {c.background ? (isVideo
              ? <video src={c.background} muted loop autoPlay playsInline />
              : <img src={c.background} alt="" />) : null}
          </div>
          <div className="char-hero-fg">
            <Avatar src={c.avatar} name={c.name} size={92} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: '2px 0 6px' }}>{c.name}</h2>
              <div className="muted">{c.tagline || '这个角色还没有一句话简介'}</div>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {(c.tags || '').split(',').filter(Boolean).map(t => <span key={t} className="tag">{t.trim()}</span>)}
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageCircle size={12} /> {c.uses} 次对话</span>
                {c.is_public ? <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 公开</span> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="row" style={{ margin: '20px 0' }}>
          <button className="btn primary block" onClick={startChat} disabled={busy}><MessageCircle size={16} /> {busy ? '进入中…' : '开始对话'}</button>
          <button className={'btn block' + (faved ? ' danger' : '')} onClick={toggleFav}><Heart size={15} fill={faved ? 'currentColor' : 'none'} /> {faved ? '已收藏' : '收藏'}</button>
        </div>

        {c.intro && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>角色简介</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>{c.intro}</p>
          </div>
        )}
        {c.greeting && (
          <div className="card" style={{ marginBottom: 16, background: 'var(--bg-2)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--muted)' }}><Sparkles size={14} style={{ verticalAlign: -2 }} /> 开场白</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>{c.greeting}</p>
          </div>
        )}
        {Array.isArray(c.world) && c.world.length > 0 && (
          <div className="card">
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}><BookOpen size={14} style={{ verticalAlign: -2 }} /> 世界书</h3>
            <div className="muted" style={{ fontSize: 13 }}>包含 {c.world.length} 条世界观设定，对话时会按关键词自动注入。</div>
          </div>
        )}
      </div>
    </>
  );
}
