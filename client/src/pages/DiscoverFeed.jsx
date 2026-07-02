// 沉浸式角色流 —— app 端「发现」tab 的抖音化形态。
// 全屏竖向 snap 滚动，每屏一张角色卡：背景图铺满 + 底部信息 + 右侧操作栏。
// 上下滑动切换角色，触底自动加载更多；双击卡面点赞（爱心迸发）；
// 新角色卡发布时 SSE 秒级插入顶部。
//
// 结构要点（修复「模块塌掉」的老 bug）：
//  - 外层 .feed-wrap 拿到确定高度（app 壳下按 --app-top/--app-bot 显式计算，
//    不再依赖脆弱的 flex 百分比链），内层 .feed-root 才是滚动容器；
//  - 分类条 / 加载提示 / 到底提示全部悬浮在 wrap 上，不进滚动流 ——
//    此前它们放在滚动容器里：一划就被卷走，页脚还会让 mandatory snap 卡死。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { shareUrl } from '../util.js';
import { tick } from '../appgestures.js';
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
  const [burst, setBurst] = useState(null); // 双击点赞爱心迸发 { id, x, y, k }
  const containerRef = useRef(null);
  const loadFlag = useRef(0);   // 防竞态
  const lastTap = useRef({ t: 0, id: null });

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
        if (reset) {
          setChars(list);
          // 切分类后回到第一张卡，避免停留在旧列表的中段索引
          setActiveIdx(0);
          containerRef.current?.scrollTo({ top: 0 });
        } else {
          setChars(prev => [...prev, ...list.filter(c => !prev.some(x => x.id === c.id))]);
        }
        setHasMore(list.length >= 20);
      })
      .catch(() => {})
      .finally(() => { if (flag === loadFlag.current) { setLoading(false); setLoadingMore(false); } });
  }, []);

  useEffect(() => { load(cat); }, [cat, load]);

  // 收藏状态初始拉取（轻量：只取 id 集合）
  useEffect(() => {
    api('/characters/favorites/list').then(d => { setFavSet(new Set((d.characters || []).map(c => c.id))); }).catch(() => {});
  }, []);

  // SSE：他人发布新公开角色卡时秒级插入到流顶部，不打断当前观看。
  useRealtimeEvent('character_new', (data) => {
    const c = data?.character; if (!c) return;
    setChars(prev => prev.some(x => x.id === c.id) ? prev : [{ ...c, uses: 0, likes: 0 }, ...prev]);
    toast(`✨ ${c.owner_name || '有人'} 发布了新角色「${c.name}」`);
  });

  // 滚动监听：更新当前卡索引。IntersectionObserver 比 scroll 事件在 snap 下更稳。
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
    root.querySelectorAll('[data-idx]').forEach(c => io.observe(c));
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
    setLikedSet(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); persistLiked(n); return n; });
  };
  // 抖音式双击点赞：卡面快速连点两下 → 点亮爱心 + 迸发动画（再双击不取消）。
  const cardTap = (e, c) => {
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = { t: now, id: c.id };
    if (prev.id !== c.id || now - prev.t > 320) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top;
    if (!likedSet.has(c.id)) like(c);
    tick(10);
    setBurst({ id: c.id, x, y, k: now });
    setTimeout(() => setBurst(b => (b && b.k === now ? null : b)), 850);
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
    return <div className="feed-wrap feed-loading"><Drama size={40} className="feed-spin" /><span>正在挑选精彩角色…</span></div>;
  }
  if (chars.length === 0) {
    return <div className="feed-wrap feed-empty"><EmptyArt kind="library" />暂无角色，快来发布第一个</div>;
  }

  const atEnd = !hasMore && activeIdx >= chars.length - 1;

  return (
    <div className="feed-wrap">
      {/* 顶部分类条 —— 悬浮于滚动流之上，划卡不再被卷走 */}
      <div className="feed-cats">
        <button className={'feed-cat' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>全部</button>
        {cats.map(c => (
          <button key={c.slug} className={'feed-cat' + (cat === c.slug ? ' on' : '')} onClick={() => setCat(c.slug)}>
            <CategoryIcon slug={c.slug} size={13} /> {c.name}
          </button>
        ))}
      </div>

      <div className="feed-root" ref={containerRef}>
        {chars.map((c, i) => {
          const liked = likedSet.has(c.id);
          const faved = favSet.has(c.id);
          return (
            <section key={c.id} className="feed-card" data-idx={i}>
              {c.avatar
                ? <img className="feed-bg" src={c.avatar} alt="" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />
                : <div className="feed-bg cover-art-box"><CoverArt name={c.name} /></div>}
              <div className="feed-scrim" />
              {/* 双击点赞层：盖住画面区域，按钮层在其上不受影响 */}
              <div className="feed-tap" onClick={e => cardTap(e, c)} />
              {burst && burst.id === c.id && (
                <span key={burst.k} className="feed-heart" style={{ left: burst.x, top: burst.y }} aria-hidden="true">
                  <Heart size={84} fill="currentColor" />
                </span>
              )}
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
      </div>

      {/* 加载 / 到底提示 —— 悬浮胶囊，不参与 snap 流（旧版会让 snap 卡死在页脚） */}
      {loadingMore && <div className="feed-hint"><Sparkles size={14} /> 正在加载更多…</div>}
      {atEnd && !loadingMore && <div className="feed-hint"><ChevronUp size={15} /> 已经到底啦，上滑回顶</div>}
    </div>
  );
}
