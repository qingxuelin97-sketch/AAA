import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, GridSkeleton } from '../ui.jsx';
import { Heart, MessageCircle, Search, Sparkles, ScrollText, Flame, Drama, Coins, Play, Megaphone, X } from 'lucide-react';
import { CategoryIcon, categoryName } from '../assets.jsx';

export default function Home() {
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('hot');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ann, setAnn] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories)).catch(() => {}); }, []);
  useEffect(() => { api('/scripts?sort=hot').then(d => setScripts(d.scripts.slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => {
    api('/announcements').then(d => {
      const top = d.announcements?.[0];
      if (top && localStorage.getItem('ann_seen') !== String(top.id)) setAnn(top);
    }).catch(() => {});
  }, []);

  const dismissAnn = () => { if (ann) localStorage.setItem('ann_seen', String(ann.id)); setAnn(null); };

  const load = () => {
    setLoading(true);
    api(`/characters/public?category=${cat}&q=${encodeURIComponent(q)}&sort=${sort}`)
      .then(d => setChars(d.characters)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat, sort]);

  const fav = async (e, c) => {
    e.stopPropagation();
    try { const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      setChars(chars.map(x => x.id === c.id ? { ...x, faved: d.faved, likes: x.likes + (d.faved ? 1 : -1) } : x)); }
    catch (err) { toast(err.message, 'err'); }
  };
  const chat = async (e, c) => {
    e.stopPropagation();
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>发现广场</h1>
          <div className="sub">挑选一个角色，开启属于你的沉浸故事</div>
        </div>
        <button className="btn primary" onClick={() => nav('/publish')}><Sparkles size={16} /> 发布作品</button>
      </div>

      <div className="page">
        {ann && (
          <div className="ann-banner" onClick={() => nav('/announcements')} style={{ cursor: 'pointer' }}>
            <span className="ann-ic"><Megaphone size={19} /></span>
            <div className="ann-tx"><b>{ann.title}</b><p>{ann.body}</p></div>
            <button className="ann-x" onClick={e => { e.stopPropagation(); dismissAnn(); }}><X size={16} /></button>
          </div>
        )}

        <div className="cat-bar">
          <button className={'cat-chip' + (cat === 'all' ? ' active' : '')} onClick={() => setCat('all')}><Flame size={14} /> 全部</button>
          {cats.map(c => (
            <button key={c.slug} className={'cat-chip' + (cat === c.slug ? ' active' : '')} onClick={() => setCat(c.slug)}><CategoryIcon slug={c.slug} size={14} /> {c.name}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg">
            <button className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>热门</button>
            <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>最新</button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <input className="input" style={{ width: 220 }} placeholder="搜索角色 / 标签…" value={q}
              onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
            <button className="btn" onClick={load}><Search size={16} /></button>
          </div>
        </div>

        {loading ? <GridSkeleton n={8} /> :
          chars.length === 0 ? <div className="empty"><div className="big"><Drama size={46} /></div>该分类下还没有公开角色</div> : (
            <div className="disc-grid">
              {chars.map(c => (
                <article key={c.id} className="dcard" onClick={() => nav('/character/' + c.id)}>
                  <div className="dcard-cover">
                    {c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={46} /></div>}
                    {c.category && <span className="dcard-cat"><CategoryIcon slug={c.category} size={13} /> {categoryName(c.category)}</span>}
                    <button className={'dcard-fav' + (c.faved ? ' on' : '')} onClick={e => fav(e, c)} title="收藏">
                      <Heart size={16} fill={c.faved ? 'currentColor' : 'none'} />
                    </button>
                    <span className="dcard-uses"><MessageCircle size={12} /> {c.uses}</span>
                  </div>
                  <div className="dcard-body">
                    <h3>{c.name}</h3>
                    <p>{c.tagline || c.intro || '暂无简介'}</p>
                    <div className="dcard-foot">
                      <div className="dcard-author"><Avatar name={c.owner_name} size={20} /><span>{c.owner_name}</span></div>
                      <button className="btn sm primary" onClick={e => chat(e, c)}><MessageCircle size={13} /> 对话</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

        {scripts.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 36 }}>
              <h2><Flame size={17} style={{ verticalAlign: -3 }} /> 热门剧本</h2>
              <button className="btn sm ghost" onClick={() => nav('/scripts')}>查看全部 →</button>
            </div>
            <div className="grid">
              {scripts.map(s => (
                <div key={s.id} className="char-card" onClick={() => nav('/script/' + s.id)}>
                  <div className="cover">{s.cover ? <img src={s.cover} alt="" /> : <div className="ph"><ScrollText size={34} /></div>}
                    <div className="pill-pub">{s.price_gold > 0 ? <><Coins size={12} /> {s.price_gold}</> : '免费'}</div></div>
                  <div className="meta"><h3>{s.title}</h3><p>{s.summary}</p>
                    <div className="foot"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Play size={11} /> {s.plays}</span><span style={{ marginLeft: 'auto' }} className="muted">{s.author_name}</span></div></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
