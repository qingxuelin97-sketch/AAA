// 沉浸式角色流 —— app 端「发现」tab 的全屏竖滑形态（对标一线角色扮演 App 的信息层级）。
// 每屏一张角色卡：全幅立绘打底，其上依次浮着 —— 介绍卡（可展开）、开场白气泡、
// 角色名 + 作者行、横向互动条（赞/收藏/评论/分享）、以及一条「自由输入」胶囊：
// 在流里直接开口说话，落地即进入对话并带着这句话。
//
// 结构要点（修复「模块塌掉」的老 bug）：
//  - 外层 .feed-wrap 拿到确定高度（app 壳下按 --app-top/--app-bot 显式计算，
//    不再依赖脆弱的 flex 百分比链），内层 .feed-root 才是滚动容器；
//  - 分类条 / 加载提示 / 到底提示全部悬浮在 wrap 上，不进滚动流。
// 性能要点：前两屏图片 eager、其余 lazy；开场白/介绍均为纯文本层，无额外请求；
//  IntersectionObserver 驱动当前卡索引（比 scroll 事件在 snap 下更稳、更省电）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { shareUrl } from '../util.js';
import { tick } from '../appgestures.js';
import CallScreen from '../components/CallScreen.jsx';
import {
  Heart, MessageCircle, Star, Share2, Drama, Sparkles, ChevronUp,
  ChevronRight, ScrollText, Maximize2, Phone, Search, History, X
} from 'lucide-react';

// 开场白预览：*动作* 星号只是排版标记，流里展示时去掉更干净。
const cleanGreeting = (t) => (t || '').replace(/\*/g, '').replace(/\n{2,}/g, '\n').trim();
// 互动计数：过万转「1.2w」，与内容平台习惯一致。
const fmtW = (n) => { n = n || 0; return n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + 'w' : String(n); };
// 「历史」浏览记录（与角色详情页共用同一份 recent_chars 本地存储）。
const readRecent = () => { try { return JSON.parse(localStorage.getItem('recent_chars') || '[]'); } catch { return []; } };
const pushRecent = (c) => {
  try {
    const prev = readRecent().filter(x => x.id !== c.id);
    const item = { id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline, owner_name: c.owner_name, category: c.category, uses: c.uses };
    localStorage.setItem('recent_chars', JSON.stringify([item, ...prev].slice(0, 12)));
  } catch { /* */ }
};

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

export default function DiscoverFeed() {
  const nav = useNavigate();
  const toast = useToast();
  const [chars, setChars] = useState([]);
  const [mode, setMode] = useState('recommend'); // 发现流分段：recommend 推荐 / new 新作 / follow 关注
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [favSet, setFavSet] = useState(new Set());
  const [likedSet, setLikedSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('feed_liked') || '[]')); } catch { return new Set(); }
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [burst, setBurst] = useState(null);        // 双击点赞爱心迸发 { id, x, y, k }
  const [expandedId, setExpandedId] = useState(null); // 介绍卡展开态（每次只展开一张）
  const [entering, setEntering] = useState(false); // 正在建立对话
  const [histOpen, setHistOpen] = useState(false); // 「历史」最近看过面板
  const [callChar, setCallChar] = useState(null);  // 通话中的角色（电话键落点）
  const containerRef = useRef(null);
  const loadFlag = useRef(0);   // 防竞态
  const lastTap = useRef({ t: 0, id: null });

  const persistLiked = (s) => { try { localStorage.setItem('feed_liked', JSON.stringify([...s].slice(-200))); } catch { /* */ } };

  // 分段 → 查询参数：推荐=热度、新作=最新、关注=已关注创作者。
  const modeQuery = (m) => (m === 'new' ? 'sort=new' : m === 'follow' ? 'sort=hot&scope=following' : 'sort=hot');

  const load = useCallback((m, reset = true) => {
    const flag = ++loadFlag.current;
    if (reset) { setLoading(true); setHasMore(true); }
    setLoadingMore(true);
    api(`/characters/public?${modeQuery(m)}&limit=20`)
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

  useEffect(() => { load(mode); }, [mode, load]);

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

  // 换卡时收起展开的介绍。
  useEffect(() => { setExpandedId(null); }, [activeIdx]);

  // 触底加载：当前卡接近末尾时拉下一页。
  useEffect(() => {
    if (loadingMore || !hasMore || chars.length === 0) return;
    if (activeIdx >= chars.length - 3) {
      setLoadingMore(true);
      const flag = ++loadFlag.current;
      api(`/characters/public?${modeQuery(mode)}&limit=20&offset=${chars.length}`)
        .then(d => {
          if (flag !== loadFlag.current) return;
          const list = d.characters || [];
          setChars(prev => [...prev, ...list.filter(c => !prev.some(x => x.id === c.id))]);
          setHasMore(list.length >= 20);
        })
        .catch(() => {})
        .finally(() => { if (flag === loadFlag.current) setLoadingMore(false); });
    }
  }, [activeIdx, chars.length, hasMore, loadingMore, mode]);

  const fav = async (c) => {
    try {
      const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      setFavSet(prev => { const n = new Set(prev); d.faved ? n.add(c.id) : n.delete(c.id); return n; });
    } catch (e) { toast(e.message, 'err'); }
  };
  const like = (c) => {
    setLikedSet(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); persistLiked(n); return n; });
  };
  // 双击点赞：卡面快速连点两下 → 点亮爱心 + 迸发动画（再双击不取消）。
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
  // 进入对话；draft 非空时随路由带过去，落地即预填在输入框里。
  const chat = async (c, draft) => {
    if (entering) return;
    setEntering(true);
    pushRecent(c);
    try {
      const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } });
      nav('/chats/' + d.conversation.id, draft ? { state: { draft } } : undefined);
    } catch { nav('/character/' + c.id); }
    finally { setEntering(false); }
  };
  const share = async (c) => {
    const url = shareUrl('/character/' + c.id);
    try { if (navigator.share) { await navigator.share({ title: c.name, url }); return; } } catch { /* */ }
    try { await navigator.clipboard.writeText(url); toast('链接已复制'); }
    catch { toast('分享：' + c.name); }
  };

  const atEnd = !hasMore && activeIdx >= chars.length - 1;

  // 顶部：分段（关注 / 推荐 / 新作，居中）+ 右侧搜索浮钮 —— 始终常驻（含空/加载态可切换）。
  const topBar = (
    <div className="feed-top">
      <div className="feed-modes">
        <button className={'feed-mode' + (mode === 'follow' ? ' on' : '')} onClick={() => setMode('follow')}>关注</button>
        <button className={'feed-mode' + (mode === 'recommend' ? ' on' : '')} onClick={() => setMode('recommend')}>推荐</button>
        <button className={'feed-mode' + (mode === 'new' ? ' on' : '')} onClick={() => setMode('new')}>新作</button>
      </div>
      <button className="feed-search" onClick={openCmdk} aria-label="搜索"><Search size={18} /></button>
    </div>
  );

  if (loading && chars.length === 0) {
    return <div className="feed-wrap">{topBar}<div className="feed-state"><Drama size={40} className="feed-spin" /><span>正在挑选精彩角色…</span></div></div>;
  }
  if (chars.length === 0) {
    return (
      <div className="feed-wrap">{topBar}
        <div className="feed-state"><EmptyArt kind="library" />
          {mode === 'follow' ? '还没有关注的创作者 —— 去「推荐」发现更多吧' : '暂无角色，快来发布第一个'}
        </div>
      </div>
    );
  }

  return (
    <div className="feed-wrap">
      {topBar}

      <div className="feed-root" ref={containerRef}>
        {chars.map((c, i) => {
          const liked = likedSet.has(c.id);
          const faved = favSet.has(c.id);
          const expanded = expandedId === c.id;
          const near = Math.abs(i - activeIdx) <= 1; // 只有相邻卡渲染重文本层，长列表滚动更轻
          const greeting = near ? cleanGreeting(c.greeting) : '';
          // 角色带视频壁纸时，流里直接放动态背景 —— 和进对话后看到的是同一张
          // 「活的」壁纸，不再降级成静态头像。只给相邻卡挂 <video>（滑远即卸载，
          // 解码器和内存不随列表膨胀），远处的卡仍用静态图兜底。
          const liveBg = near && c.background && c.background_type === 'video';
          return (
            <section key={c.id} className={'feed-card' + (i === activeIdx ? ' cur' : '')} data-idx={i}>
              {liveBg
                ? <video className="feed-bg" src={assetUrl(c.background)} poster={c.avatar ? assetUrl(c.avatar) : undefined}
                    muted loop autoPlay playsInline preload="metadata" />
                : c.avatar
                  ? <img className="feed-bg" src={assetUrl(c.avatar)} alt="" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />
                  : <div className="feed-bg cover-art-box"><CoverArt name={c.name} /></div>}
              <div className="feed-scrim" />
              <span className="feed-ai-mark" aria-hidden="true">由 AI 生成</span>
              {/* 双击点赞层：盖住画面区域，按钮层在其上不受影响 */}
              <div className="feed-tap" onClick={e => cardTap(e, c)} />
              {burst && burst.id === c.id && (
                <span key={burst.k} className="feed-heart" style={{ left: burst.x, top: burst.y }} aria-hidden="true">
                  <Heart size={84} fill="currentColor" />
                </span>
              )}

              {/* 方案B：右侧竖排互动条（玻璃圆钮），浮于画面右缘，脱离底部信息栈 */}
              <div className="fd2-acts">
                <button className={'fd2-act' + (liked ? ' on' : '')} onClick={() => like(c)} aria-label="点赞">
                  <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
                  <span>{fmtW((c.likes || 0) + (liked ? 1 : 0))}</span>
                </button>
                <button className={'fd2-act' + (faved ? ' on gold' : '')} onClick={() => fav(c)} aria-label="收藏">
                  <Star size={24} fill={faved ? 'currentColor' : 'none'} />
                  <span>{faved ? '已藏' : '收藏'}</span>
                </button>
                <button className="fd2-act" onClick={() => nav('/character/' + c.id)} aria-label="评论">
                  <MessageCircle size={24} />
                  <span>{fmtW(c.uses)}</span>
                </button>
                <button className="fd2-act" onClick={() => share(c)} aria-label="分享">
                  <Share2 size={24} />
                  <span>分享</span>
                </button>
                <button className="fd2-act" onClick={() => setHistOpen(true)} aria-label="历史">
                  <History size={24} />
                  <span>历史</span>
                </button>
              </div>

              <div className="fd2-stack">
                {/* 介绍卡：深色玻璃面板，可展开；右下角放大镜进详情 */}
                {(c.intro || c.tagline) && (
                  <div className={'fd2-intro' + (expanded ? ' open' : '')}
                    role="button" tabIndex={0}
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    onKeyDown={e => e.key === 'Enter' && setExpandedId(expanded ? null : c.id)}>
                    <p><ScrollText size={13} className="fd2-intro-ic" /><b>介绍：</b>{c.intro || c.tagline}</p>
                    <button className="fd2-zoom" aria-label="查看角色详情"
                      onClick={e => { e.stopPropagation(); nav('/character/' + c.id); }}>
                      <Maximize2 size={14} />
                    </button>
                  </div>
                )}

                {/* 开场白气泡：角色先开口 —— 点它即刻入戏。
                    用 div 而不是 button：气泡限高后内部要能滚，部分 WebView
                    不把 button 当滚动容器。 */}
                {greeting && (
                  <div className="fd2-greet" role="button" tabIndex={0}
                    onClick={() => chat(c)}
                    onKeyDown={e => e.key === 'Enter' && chat(c)}>
                    {greeting}
                  </div>
                )}

                {/* 角色名 + 作者 行（方案B：互动条移至右侧竖排，见 .fd2-acts） */}
                <div className="fd2-meta">
                  <div className="fd2-id" role="button" tabIndex={0}
                    onClick={() => nav('/character/' + c.id)}
                    onKeyDown={e => e.key === 'Enter' && nav('/character/' + c.id)}>
                    <h2 className="fd2-name">{c.name} <ChevronRight size={17} /></h2>
                    <div className="fd2-author">
                      <Avatar src={c.owner_avatar} name={c.owner_name} size={20} />
                      <span>@{c.owner_name}</span>
                      <CreatorV tier={c.owner_tier} size={12} />
                      {c.category && <em className="fd2-cat"><CategoryIcon slug={c.category} size={11} /> {categoryName(c.category)}</em>}
                    </div>
                  </div>
                </div>

                {/* 方案B：点击即聊 —— 「进入对话」大按钮 + 语音电话按钮（替代自由输入） */}
                <div className="fd2-cta">
                  <button className="fd2-enter" onClick={() => chat(c)} disabled={entering} aria-label="进入对话">
                    <MessageCircle size={19} /> 进入对话
                  </button>
                  <button className="fd2-call" onClick={() => { pushRecent(c); tick(12); setCallChar(c); }} aria-label="语音通话" title="给 TA 打电话">
                    <Phone size={20} />
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* 加载 / 到底提示 —— 悬浮胶囊，不参与 snap 流 */}
      {loadingMore && <div className="feed-hint"><Sparkles size={14} /> 正在加载更多…</div>}
      {atEnd && !loadingMore && <div className="feed-hint"><ChevronUp size={15} /> 已经到底啦，上滑回顶</div>}

      {/* 「历史」—— 最近看过的角色（本地记录），一键回访 / 续聊 */}
      {histOpen && (
        <div className="app-sheet-mask" onClick={() => setHistOpen(false)}>
          <div className="app-sheet" onClick={e => e.stopPropagation()}>
            <div className="app-sheet-grip" />
            <h3 className="app-sheet-title"><History size={16} style={{ verticalAlign: -2, marginRight: 6 }} />最近看过</h3>
            {readRecent().length === 0 && (
              <div className="fd2-hist-empty">还没有浏览记录 —— 滑一滑，喜欢的角色都会记在这里</div>
            )}
            {readRecent().map(rc => (
              <div key={rc.id} className="fd2-hist-row" role="button" tabIndex={0}
                onClick={() => { setHistOpen(false); nav('/character/' + rc.id); }}
                onKeyDown={e => e.key === 'Enter' && (setHistOpen(false), nav('/character/' + rc.id))}>
                <Avatar src={rc.avatar} name={rc.name} size={44} />
                <div className="fd2-hist-tx">
                  <b>{rc.name}</b>
                  <span>{rc.tagline || `@${rc.owner_name || '佚名'}`}</span>
                </div>
                <button className="fd2-hist-go" onClick={e => { e.stopPropagation(); setHistOpen(false); chat(rc); }}>
                  <MessageCircle size={13} /> 续聊
                </button>
              </div>
            ))}
            <button className="fd2-hist-close" onClick={() => setHistOpen(false)}><X size={15} /> 关闭</button>
          </div>
        </div>
      )}

      {/* 通话 —— 给角色打电话（沉浸式全屏） */}
      {callChar && <CallScreen character={callChar} onClose={() => setCallChar(null)} />}
    </div>
  );
}
