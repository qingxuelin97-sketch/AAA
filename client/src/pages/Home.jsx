import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, GridSkeleton } from '../ui.jsx';
import { Heart, MessageCircle, Search, Sparkles, ScrollText, Flame, Drama, Coins, Play, Megaphone, X, Star, Clock } from 'lucide-react';
import { CategoryIcon, categoryName } from '../assets.jsx';

function Poster({ c, onView, onFav, onChat }) {
  return (
    <article className="poster" onClick={() => onView(c)}>
      {c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={44} /></div>}
      {c.featured ? <span className="p-feat"><Star size={11} fill="currentColor" /> 推荐</span>
        : c.category ? <span className="p-cat"><CategoryIcon slug={c.category} size={12} /> {categoryName(c.category)}</span> : null}
      <button className={'p-fav' + (c.faved ? ' on' : '')} onClick={e => onFav(e, c)} title="收藏"><Heart size={15} fill={c.faved ? 'currentColor' : 'none'} /></button>
      <div className="p-info">
        <h3>{c.name}</h3>
        <p>{c.tagline || c.intro || '暂无简介'}</p>
        <div className="p-meta">
          <div className="author"><Avatar name={c.owner_name} size={17} /><span>{c.owner_name}</span></div>
          <span className="uses"><MessageCircle size={11} /> {c.uses}</span>
        </div>
      </div>
    </article>
  );
}

export default function Home() {
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('hot');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ann, setAnn] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories)).catch(() => {}); }, []);
  useEffect(() => { api('/scripts?sort=hot').then(d => setScripts(d.scripts.slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => { api('/characters/public?sort=hot').then(d => setFeatured(d.characters.filter(c => c.featured).slice(0, 12))).catch(() => {}); }, []);
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('recent_chars') || '[]').slice(0, 12)); } catch { /* */ }
    api('/announcements').then(d => { const t = d.announcements?.[0]; if (t && localStorage.getItem('ann_seen') !== String(t.id)) setAnn(t); }).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    api(`/characters/public?category=${cat}&q=${encodeURIComponent(q)}&sort=${sort}`)
      .then(d => setChars(d.characters)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat, sort]);

  const view = (c) => nav('/character/' + c.id);
  const fav = async (e, c) => {
    e.stopPropagation();
    try {
      const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      const upd = x => x.id === c.id ? { ...x, faved: d.faved } : x;
      setChars(cs => cs.map(upd)); setFeatured(cs => cs.map(upd)); setRecent(cs => cs.map(upd));
    } catch (err) { toast(err.message, 'err'); }
  };
  const chat = async (e, c) => {
    e.stopPropagation();
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (err) { toast(err.message, 'err'); }
  };
  const dismissAnn = () => { if (ann) localStorage.setItem('ann_seen', String(ann.id)); setAnn(null); };

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

        {featured.length > 0 && (
          <>
            <div className="section-title"><h2><Star size={17} style={{ verticalAlign: -3, color: '#d99327' }} /> 官方推荐</h2></div>
            <div className="rail" style={{ marginBottom: 26 }}>
              {featured.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} onChat={chat} />)}
            </div>
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="section-title"><h2><Clock size={16} style={{ verticalAlign: -3 }} /> 最近浏览</h2></div>
            <div className="rail" style={{ marginBottom: 26 }}>
              {recent.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} onChat={chat} />)}
            </div>
          </>
        )}

        <div className="section-title"><h2>全部角色</h2></div>
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
            <div className="poster-grid">
              {chars.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} onChat={chat} />)}
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
