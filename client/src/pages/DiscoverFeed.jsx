// 沉浸式角色流 —— app 端「发现」tab 的抖音化形态。
// 全屏竖向 snap 滚动，每屏一张角色卡：背景图铺满 + 底部信息 + 右侧操作栏。
// 上下滑动切换角色，触底自动加载更多；新角色卡发布时 SSE 秒级插入顶部。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { shareUrl } from '../util.js';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { Heart, MessageCircle, Star, Share2, Drama, Sparkles, ChevronUp } from 'lucide-react';

export default function DiscoverFeed() {
  const nav = useNavigate();
  const toast = useToast();
  const [chars, setChars] = useState([]);
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [favSet, setFavSet] = useState(new Set());
  const [likedSet, setLikedSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('feed_liked') || '[]')); } catch { return new Set(); }
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef(null);
  const loadFlag = useRef(0); // 防竞态

  const persistLiked = (s) => { try { localStorage.setItem('feed_liked', JSON.stringify([...s].slice(-200))); } catch { /* */ } };

  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories || [])).catch(() => {}); }, []);

  const load = useCallback((category, reset = true) => {
    const flag = ++loadFlag.current;
    if (reset) { setLoading(true); setHasMore(true); }
    setLoadingMore(true);
    const q = category && category !== 'all' ? `&category=${category}` : '';
    api(`/characters/public?sort=hot${q}&limit=20`)
      .then(d => {
        if (flag !== loadFlag.current) return;
        const list = d.characters || [];
        if (reset) setChars(list);
        else setChars(prev => [...prev, ...list.filter(c => !prev.some(x => x.id === c.id))]);
        setHasMore(list.length >= 20);
      })
      .catch(() => {})
      .finally(() => { if (flag === loadFlag.current) { setLoading(false); setLoadingMore(false); } });
  }, []);

  useEffect(() => { load(cat); }, [cat, load]);

  // 收藏状态初始拉取。此前打的是不存在的 /favorites（双端都 404），
  // 导致流里的收藏态永远显示「未收藏」。
  useEffect(() => {
    api('/characters/favorites/list').then(d => { setFavSet(new Set((d.characters || []).map(c => c.id))); }).catch(() => {});
  }, []);

  // SSE：他人发布新公开角色卡时秒级插入到流顶部（首次提示），不打断当前观看。
  useRealtimeEvent('character_new', (data) => {
    const c = data?.character; if (!c) return;
    setChars(prev => prev.some(x => x.id === c.id) ? prev : [{ ...c, uses: 0, likes: 0 }, ...prev]);
    toast(`✨ ${c.owner_name || '有人'} 发布了新角色「${c.name}」`);
  });

  // 滚动监听：更新当前卡索引 + 触底加载更多。用 IntersectionObserver 而非 scroll，
  // snap 滚动下更稳，且不阻塞主线程。
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const idx = Number(e.target.dataset.idx);
          if (!isNaN(idx)) setActiveIdx(idx);
        }
      }
    }, { root, threshold: 0.6 });
    const cards = root.querySelectorAll('[data-idx]');
    cards.forEach(c => io.observe(c));
    return () => io.disconnect();
  }, [chars.length]);

  // 触底加载：当前卡接近末尾时拉下一页。
  useEffect(() => {
    if (loadingMore || !hasMore || chars.length === 0) return;
    if (activeIdx >= chars.length - 3) {
      setLoadingMore(true);
      const flag = ++loadFlag.current;
      const q = cat && cat !== 'all' ? `&category=${cat}` : '';
      api(`/characters/public?sort=hot${q}&limit=20&offset=${chars.length}`)
        .then(d => {
          if (flag !== loadFlag.current) return;
          const list = d.characters || [];
          setChars(prev => [...prev, ...list.filter(c => !prev.some(x => x.id === c.id))]);
          setHasMore(list.length >= 20);
        })
        .catch(() => {})
        .finally(() => { if (flag === loadFlag.current) setLoadingMore(false); });
    }
  }, [activeIdx, chars.length, hasMore, loadingMore, cat]);

  const fav = async (c) => {
    try {
      const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      setFavSet(prev => { const n = new Set(prev); d.faved ? n.add(c.id) : n.delete(c.id); return n; });
    } catch (e) { toast(e.message, 'err'); }
  };
  const like = (c) => {
    // 点赞为本地态（后端无独立点赞端点，复用 favorite 计数）；记本地避免重复。
    setLikedSet(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); persistLiked(n); return n; });
  };
  const chat = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch { nav('/character/' + c.id); }
  };
  const share = async (c) => {
    const url = shareUrl('/character/' + c.id);
    try { if (navigator.share) { await navigator.share({ title: c.name, url }); return; } } catch { /* */ }
    try { await navigator.clipboard.writeText(url); toast('链接已复制'); }
    catch { toast('分享：' + c.name); }
  };

  if (loading && chars.length === 0) {
    return <div className="feed-root feed-loading"><Drama size={40} className="feed-spin" /><span>正在挑选精彩角色…</span></div>;
  }
  if (chars.length === 0) {
    return <div className="feed-root feed-empty"><EmptyArt kind="library" />暂无角色，快来发布第一个</div>;
  }

  return (
    <div className="feed-root" ref={containerRef}>
      {/* 顶部分类条 —— 半透明悬浮，不遮挡沉浸感 */}
      <div className="feed-cats">
        <button className={'feed-cat' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>全部</button>
        {cats.map(c => (
          <button key={c.slug} className={'feed-cat' + (cat === c.slug ? ' on' : '')} onClick={() => setCat(c.slug)}>
            <CategoryIcon slug={c.slug} size={13} /> {c.name}
          </button>
        ))}
      </div>

      {/* 右上角新角色提示锚点（toast 已覆盖，这里留位给未来 inline 提示） */}

      {chars.map((c, i) => {
        const liked = likedSet.has(c.id);
        const faved = favSet.has(c.id);
        return (
          <section key={c.id} className="feed-card" data-idx={i}>
            {c.avatar
              ? <img className="feed-bg" src={c.avatar} alt="" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />
              : <div className="feed-bg cover-art-box"><CoverArt name={c.name} /></div>}
            <div className="feed-scrim" />
            <div className="feed-body">
              <div className="feed-info">
                {c.category && <span className="feed-tag"><CategoryIcon slug={c.category} size={12} /> {categoryName(c.category)}</span>}
                <h2 className="feed-name">{c.name}</h2>
                <p className="feed-desc">{c.tagline || c.intro || '一个等待被开启的故事。'}</p>
                <div className="feed-author">
                  <Avatar src={c.owner_avatar} name={c.owner_name} size={26} />
                  <span>{c.owner_name}</span>
                  <CreatorV tier={c.owner_tier} size={12} />
                  <span className="feed-uses"><MessageCircle size={12} /> {c.uses || 0}</span>
                </div>
              </div>
              <div className="feed-acts">
                <button className={'feed-act' + (liked ? ' on' : '')} onClick={() => like(c)} aria-label="点赞">
                  <Heart size={26} fill={liked ? 'currentColor' : 'none'} />
                  <span>{(c.likes || 0) + (liked ? 1 : 0)}</span>
                </button>
                <button className={'feed-act' + (faved ? ' on' : '')} onClick={() => fav(c)} aria-label="收藏">
                  <Star size={26} fill={faved ? 'currentColor' : 'none'} />
                  <span>{faved ? '已藏' : '收藏'}</span>
                </button>
                <button className="feed-act" onClick={() => nav('/character/' + c.id)} aria-label="详情">
                  <Drama size={26} />
                  <span>详情</span>
                </button>
                <button className="feed-act" onClick={() => share(c)} aria-label="分享">
                  <Share2 size={26} />
                  <span>分享</span>
                </button>
              </div>
            </div>
            <button className="feed-chat" onClick={() => chat(c)}>
              <MessageCircle size={18} /> 开始对话
            </button>
          </section>
        );
      })}

      {loadingMore && <div className="feed-more"><Sparkles size={16} /> 正在加载更多…</div>}
      {!hasMore && chars.length > 0 && <div className="feed-end"><ChevronUp size={18} /> 已经到底啦，下拉回顶</div>}
    </div>
  );
}
