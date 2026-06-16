import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Heart, HeartCrack, Drama } from 'lucide-react';

export default function Favorites() {
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const nav = useNavigate();

  const load = () =>
    api('/characters/favorites/list')
      .then(d => setChars(d.characters || []))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const startChat = async (e, c) => {
    e.stopPropagation();
    try {
      const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } });
      nav('/chats/' + d.conversation.id);
    } catch (err) { toast(err.message, 'err'); }
  };

  const unfavorite = async (e, c) => {
    e.stopPropagation();
    try {
      await api('/characters/' + c.id + '/favorite', { method: 'POST' });
      toast('已取消收藏');
      load();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的收藏</h1>
          <div className="sub">收藏的角色，随时开启对话</div>
        </div>
      </div>

      <div className="page">
        {loading ? (
          <div className="empty">载入中…</div>
        ) : chars.length === 0 ? (
          <div className="empty"><div className="big"><HeartCrack size={46} /></div>还没有收藏角色</div>
        ) : (
          <div className="grid">
            {chars.map(c => (
              <div key={c.id} className="char-card">
                <div className="cover">
                  {c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={46} /></div>}
                  <button
                    className="btn sm danger"
                    style={{ position: 'absolute', top: 8, right: 8 }}
                    title="取消收藏"
                    onClick={e => unfavorite(e, c)}
                  ><Heart size={14} fill="currentColor" /></button>
                </div>
                <div className="meta">
                  <h3>{c.name}</h3>
                  <p>{c.tagline || c.intro || '暂无简介'}</p>
                  {c.tags && c.tags.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                      {(Array.isArray(c.tags) ? c.tags : String(c.tags).split(',')).filter(Boolean).slice(0, 4).map((t, i) => (
                        <span key={i} className="tag">{t}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="foot">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Heart size={14} /> {c.likes || 0}
                    </span>
                    <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={e => startChat(e, c)}>对话</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
