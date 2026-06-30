// AppDiscoverFeed — the app-only "发现" tab in 抖音-style: full-bleed, one
// character per screen, vertical swipe (native CSS scroll-snap, no custom
// touch math needed), right-side action rail, double-tap to like. Replaces
// the web poster-grid Home page ONLY inside the app shell — same brand colors
// (--accent / --bg-2 etc.), just a feed-shaped layout instead of a grid.
//
// This is the primary "core loop" surface: swipe → read → tap to view or chat,
// so every card pushes toward the one action that matters — starting a chat.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { Heart, MessageCircle, Search, Info, Flame, Drama } from 'lucide-react';

const DOUBLE_TAP_MS = 280;

export default function AppDiscoverFeed() {
  const nav = useNavigate();
  const toast = useToast();
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [list, setList] = useState(null); // null = loading
  const [favOverride, setFavOverride] = useState({});
  const [burstKey, setBurstKey] = useState({});
  const tapRef = useRef({ id: 0, t: 0 });
  const tapTimerRef = useRef(0);

  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories || [])).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    setList(null);
    const qs = cat === 'all' ? '' : `&category=${encodeURIComponent(cat)}`;
    // Personalised picks lead the 全部 feed; backfilled with the hot pool, de-duped.
    Promise.all([
      cat === 'all' ? api('/characters/recommended').catch(() => ({ characters: [] })) : Promise.resolve({ characters: [] }),
      api(`/characters/public?sort=hot${qs}`).catch(() => ({ characters: [] }))
    ]).then(([rec, hot]) => {
      if (!alive) return;
      const seen = new Set();
      const merged = [...(rec.characters || []), ...(hot.characters || [])].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id); return true;
      });
      setList(merged);
    });
    return () => { alive = false; };
  }, [cat]);

  const openChat = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch { nav('/character/' + c.id); }
  };

  const toggleFav = async (c) => {
    try {
      const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      setFavOverride(f => ({ ...f, [c.id]: d.faved }));
    } catch (e) { toast(e?.message || '操作失败'); }
  };

  // Double-tap-to-like (Douyin convention: always likes, never un-likes) vs.
  // single-tap-to-view-detail. A single shared ref is enough since only one
  // card is interactive at a time in a snap feed.
  const onCardTap = (c) => () => {
    const now = Date.now();
    const last = tapRef.current;
    if (last.id === c.id && now - last.t < DOUBLE_TAP_MS) {
      clearTimeout(tapTimerRef.current);
      tapRef.current = { id: 0, t: 0 };
      const isFaved = favOverride[c.id] ?? c.faved;
      if (!isFaved) toggleFav(c);
      setBurstKey(b => ({ ...b, [c.id]: (b[c.id] || 0) + 1 }));
      return;
    }
    tapRef.current = { id: c.id, t: now };
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => nav('/character/' + c.id), DOUBLE_TAP_MS - 20);
  };

  return (
    <div className="app-feed-page">
      <div className="app-feed-top">
        <b className="app-feed-brand">发现</b>
        <button className="app-feed-search" onClick={() => nav('/search')} aria-label="搜索"><Search size={19} /></button>
      </div>
      <div className="app-feed-cats">
        <button className={'afc-chip' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}><Flame size={13} /> 全部</button>
        {cats.map(c => (
          <button key={c.slug} className={'afc-chip' + (cat === c.slug ? ' on' : '')} onClick={() => setCat(c.slug)}>
            <CategoryIcon slug={c.slug} size={13} /> {c.name}
          </button>
        ))}
      </div>

      {list === null ? (
        <div className="app-feed-skel" />
      ) : list.length === 0 ? (
        <div className="app-feed-empty">
          <Drama size={32} />
          <p>这个分类还没有角色，换一个看看？</p>
        </div>
      ) : (
        <div className="app-feed-scroll" key={cat}>
          {list.map(c => {
            const isFaved = favOverride[c.id] ?? c.faved;
            return (
              <div className="app-feed-card" key={c.id} onClick={onCardTap(c)}>
                {c.avatar ? <img className="afc-bg" src={c.avatar} alt="" loading="lazy" /> : <div className="afc-bg ph" />}
                <div className="afc-scrim" />
                {!!burstKey[c.id] && <Heart key={burstKey[c.id]} className="afc-heart-burst" size={96} fill="currentColor" />}

                <div className="afc-body">
                  <span className="afc-owner"><Avatar src={c.owner_avatar} name={c.owner_name} size={20} /> {c.owner_name}</span>
                  <b className="afc-name">{c.name}</b>
                  <p className="afc-tag">{c.tagline || c.intro || '一个等待被开启的故事'}</p>
                  {c.category && <span className="afc-cat-pill"><CategoryIcon slug={c.category} size={12} /> {categoryName(c.category)}</span>}
                </div>

                <div className="afc-rail" onClick={e => e.stopPropagation()}>
                  <button className="afc-rail-av" onClick={() => nav('/user/' + c.owner_id)} aria-label="查看创作者主页">
                    <Avatar src={c.owner_avatar} name={c.owner_name} size={44} />
                  </button>
                  <button className={'afc-rail-btn' + (isFaved ? ' on' : '')} data-burst onClick={() => toggleFav(c)} aria-label="喜欢">
                    <Heart size={26} fill={isFaved ? 'currentColor' : 'none'} />
                    <span>{isFaved ? '已喜欢' : '喜欢'}</span>
                  </button>
                  <button className="afc-rail-btn" onClick={() => openChat(c)} aria-label="开始对话">
                    <MessageCircle size={26} />
                    <span>聊天</span>
                  </button>
                  <button className="afc-rail-btn" onClick={() => nav('/character/' + c.id)} aria-label="详情">
                    <Info size={24} />
                    <span>详情</span>
                  </button>
                </div>
              </div>
            );
          })}
          <div className="app-feed-card app-feed-end">
            <Flame size={30} />
            <b>你已经刷到底啦</b>
            <p>去剧本市集或社区看看，还有更多故事在等你</p>
            <div className="afe-acts">
              <button className="btn glass" onClick={() => nav('/scripts')}>逛剧本</button>
              <button className="btn primary" onClick={() => nav('/community')}>看社区</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
