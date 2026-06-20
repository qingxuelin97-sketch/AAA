import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { pid } from '../assets.jsx';
import Reviews from '../components/Reviews.jsx';
import ReportButton from '../components/ReportButton.jsx';
import { MessageCircle, Heart, Pencil, BookOpen, ArrowLeft, Sparkles, Globe, Eye, ChevronRight, Drama, BadgeCheck } from 'lucide-react';

function recordRecent(c) {
  try {
    const prev = JSON.parse(localStorage.getItem('recent_chars') || '[]').filter(x => x.id !== c.id);
    const item = { id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline, owner_name: c.owner_name, category: c.category, uses: c.uses, featured: c.featured };
    localStorage.setItem('recent_chars', JSON.stringify([item, ...prev].slice(0, 12)));
  } catch { /* */ }
}

export default function CharacterView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [related, setRelated] = useState([]);
  const [faved, setFaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wbOpen, setWbOpen] = useState(false);

  useEffect(() => {
    setWbOpen(false);
    api('/characters/' + id).then(d => { setC(d.character); setRelated(d.related || []); recordRecent(d.character); }).catch(e => toast(e.message, 'err'));
    api('/characters/public').then(d => { const hit = d.characters.find(x => x.id === +id); if (hit) setFaved(!!hit.faved); }).catch(() => {});
    api('/engage/view', { method: 'POST', body: { type: 'character', id: +id } }).catch(() => {});
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
        {!isOwner && <ReportButton type="character" id={c.id} />}
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
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Eye size={12} /> {c.views || 0} 浏览</span>
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Heart size={12} /> {c.fav_count || 0} 收藏</span>
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
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ cursor: 'pointer' }} onClick={() => setWbOpen(o => !o)}>
              <h2 style={{ fontSize: 15 }}><BookOpen size={14} style={{ verticalAlign: -2, marginRight: 5 }} />世界书 · {c.world.length} 条设定</h2>
              <button className="btn ghost sm">{wbOpen ? '收起' : '展开预览'}</button>
            </div>
            {!wbOpen
              ? <div className="muted" style={{ fontSize: 13 }}>对话时按关键词自动注入设定。点击展开预览全部条目。</div>
              : <div style={{ marginTop: 4 }}>{c.world.map((w, i) => (
                  <div className="wb-item" key={i}>
                    <div className="wb-keys">{(w.keys || '常驻').split(',').map(k => k.trim()).filter(Boolean).map((k, j) => <span key={j}>{k}</span>)}</div>
                    <p>{w.content}</p>
                  </div>
                ))}</div>}
          </div>
        )}

        {/* 作者 */}
        <div className="card author-card" style={{ marginBottom: 16 }} onClick={() => nav('/user/' + c.owner_id)}>
          <Avatar src={c.owner_avatar} name={c.owner_name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{c.owner_name || '匿名作者'}
              {c.owner_verified && <BadgeCheck size={14} style={{ color: 'var(--diamond)' }} />}</b>
            <span className="muted" style={{ fontSize: 12.5 }}>作者 · 另有 {c.author_char_count || 0} 个公开角色</span>
          </div>
          <ChevronRight size={18} className="muted" />
        </div>

        {related.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}><Sparkles size={15} style={{ verticalAlign: -2, marginRight: 5 }} />相关角色推荐</h3>
            <div className="grid">
              {related.map(rc => (
                <div key={rc.id} className="char-card" onClick={() => nav('/character/' + rc.id)}>
                  <div className="cover">{rc.avatar ? <img src={rc.avatar} alt="" /> : <div className="ph"><Drama size={42} /></div>}</div>
                  <div className="meta"><h3>{rc.name}</h3><p>{rc.tagline || '——'}</p>
                    <div className="foot"><span className="muted" style={{ fontSize: 12 }}><MessageCircle size={11} /> {rc.uses}</span></div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Reviews type="character" id={c.id} />
      </div>
    </>
  );
}
