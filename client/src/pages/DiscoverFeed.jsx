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
import { useNav } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt, QuietAquaCharacterArt, resolveCharacterMedia } from '../art.jsx';
import { shareUrl } from '../util.js';
import { tick } from '../appgestures.js';
import CallScreen from '../components/CallScreen.jsx';
import AppPressMenu from '../components/AppPressMenu.jsx';
import { useLongPress } from '../chat/hooks.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { useAppOverlay } from '../overlay.jsx';
import {
  Heart, MessageCircle, Star, Share2, Drama, Loader2, ChevronUp,
  ChevronRight, ScrollText, Maximize2, Phone, Search, History, X
} from 'lucide-react';
// Lumen Glass · Web 形态（每条选择器 fenced 在 html:not([data-app="1"])，App 零影响）
import '../styles/web-lumen-discover.css';

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

// 叠印：顶部分段是一条可滚动的轨，三个基础流打头、服务端分类续在其后
// —— 浏览意图（想看什么题材）和排序意图（关注/热/新）本来就该在同一层选，
// 分成两处会让人先选完排序再去别处找分类。分类经 /characters/public?category=
// 落到同一个查询上，不新增接口。
const BASE_SEGS = [
  { key: 'follow', label: '关注', query: 'sort=hot&scope=following' },
  { key: 'recommend', label: '推荐', query: 'sort=hot' },
  { key: 'new', label: '新作', query: 'sort=new' },
];
const CAT_PREFIX = 'cat:';

// 首次进入沉浸流时提示一次双击点赞；看过即不再出现。
const COACH_KEY = 'huanyu_feed_coach';
const readCoach = () => { try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return true; } };

export default function DiscoverFeed() {
  const nav = useNav();
  const toast = useToast();
  const appMode = isAppMode();
  const [chars, setChars] = useState([]);
  const [mode, setMode] = useState('recommend'); // 发现流分段：recommend 推荐 / new 新作 / follow 关注
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pageError, setPageError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [favSet, setFavSet] = useState(new Set());
  const [likedSet, setLikedSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('feed_liked') || '[]')); } catch { return new Set(); }
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const historySheetRef = useRef(null);
  const [burst, setBurst] = useState(null);        // 双击点赞爱心迸发 { id, x, y, k }
  const [expandedId, setExpandedId] = useState(null); // 介绍卡展开态（每次只展开一张）
  const [enteringId, setEnteringId] = useState(null); // 正在建立对话的角色
  const [histOpen, setHistOpen] = useState(false); // 「历史」最近看过面板
  useAppOverlay(histOpen, () => setHistOpen(false), { rootRef: historySheetRef });
  const [callChar, setCallChar] = useState(null);  // 通话中的角色（电话键落点）
  const [cats, setCats] = useState([]);            // 服务端分类，接在三个基础流之后
  const [press, setPress] = useState(null);        // 长按菜单 { c, at:{x,y} }
  const [coached, setCoached] = useState(readCoach);
  const containerRef = useRef(null);
  const segsRef = useRef(null);
  const pressPt = useRef({ x: 0, y: 0 });
  const loadFlag = useRef(0);   // 防竞态
  const lastTap = useRef({ t: 0, id: null });

  // 壳类名：App 侧字符串逐字节不变（零波及）；Web 侧挂 Lumen 皮肤类 + immersive
  // （≤860px 复用 web-modules 的 .app-shell:has(.immersive) 机制隐藏移动顶栏/底部 dock，
  // 竖滑流真全屏）。
  const wrapCls = appMode ? 'feed-wrap qa-discover-page qa3-discover' : 'feed-wrap lgw-discover immersive';

  const persistLiked = (s) => { try { localStorage.setItem('feed_liked', JSON.stringify([...s].slice(-200))); } catch { /* */ } };

  // 分段轨：三个基础流 + 服务端分类。key 以 cat: 打头的落到 category 查询上。
  const segs = [...BASE_SEGS, ...cats.map(c => ({
    key: CAT_PREFIX + (c.slug || c.id || c),
    label: c.name || categoryName(c.slug || c) || String(c),
    query: `sort=hot&category=${encodeURIComponent(c.slug || c.id || c)}`,
  }))];
  const modeQuery = (m) => (segs.find(s => s.key === m) || BASE_SEGS[1]).query;

  const load = useCallback((m, reset = true) => {
    const flag = ++loadFlag.current;
    if (reset) { setLoading(true); setChars([]); setHasMore(true); setLoadError(''); setPageError(''); }
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
      .catch(error => {
        if (flag !== loadFlag.current) return;
        setLoadError(error?.message || '暂时无法载入发现内容');
        if (reset) setChars([]);
      })
      .finally(() => { if (flag === loadFlag.current) { setLoading(false); setLoadingMore(false); } });
  }, []);

  useEffect(() => { load(mode); }, [mode, load]);

  // 收藏状态初始拉取（轻量：只取 id 集合）
  useEffect(() => {
    api('/characters/favorites/list').then(d => { setFavSet(new Set((d.characters || []).map(c => c.id))); }).catch(() => {});
  }, []);

  // 分类轨：拉不到就只剩三个基础流，页面照常可用（分类是增强不是前提）。
  useEffect(() => {
    api('/meta/categories').then(d => setCats(d.categories || d || [])).catch(() => setCats([]));
  }, []);

  // 选中的分段滚到轨中央：轨可横滑后，选中项落在屏外会让人以为没选上。
  useEffect(() => {
    const strip = segsRef.current;
    const on = strip?.querySelector('[data-seg-on="1"]');
    if (!on) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    on.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [mode, cats.length]);

  // SSE：他人发布新公开角色卡时秒级插入到流顶部，不打断当前观看。
  useRealtimeEvent('character_new', (data) => {
    const c = data?.character; if (!c) return;
    setChars(prev => prev.some(x => x.id === c.id) ? prev : [{ ...c, uses: 0, likes: 0 }, ...prev]);
    toast(`${c.owner_name || '有人'} 发布了新角色「${c.name}」`);
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

  // A card becomes "recent" only after a deliberate pause. Fast swipes do not
  // pollute history, while browsing without starting a chat is still remembered.
  useEffect(() => {
    const current = chars[activeIdx];
    if (!current) return undefined;
    const timer = setTimeout(() => pushRecent(current), 600);
    return () => clearTimeout(timer);
  }, [activeIdx, chars]);

  // 触底加载：当前卡接近末尾时拉下一页。
  useEffect(() => {
    if (loadingMore || pageError || !hasMore || chars.length === 0) return;
    if (activeIdx >= chars.length - 3) {
      setLoadingMore(true);
      const flag = ++loadFlag.current;
      api(`/characters/public?${modeQuery(mode)}&limit=20&offset=${chars.length}`)
        .then(d => {
          if (flag !== loadFlag.current) return;
          const list = d.characters || [];
          setPageError('');
          setChars(prev => [...prev, ...list.filter(c => !prev.some(x => x.id === c.id))]);
          setHasMore(list.length >= 20);
        })
        .catch(error => {
          if (flag !== loadFlag.current) return;
          setPageError(error?.message || '更多内容载入失败');
        })
        .finally(() => { if (flag === loadFlag.current) setLoadingMore(false); });
    }
  }, [activeIdx, chars.length, hasMore, loadingMore, mode, pageError]);

  // Web 键盘导航（仅 !appMode）：↓/j 下一张、↑/k 上一张、Enter 开聊、Esc 关历史。
  // 输入框 / contenteditable / 打开的 dialog（命令面板等）内不劫持按键；
  // 焦点落在按钮/链接上时 Enter 交还给该控件自己处理。
  useEffect(() => {
    if (appMode) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (histOpen) { e.preventDefault(); setHistOpen(false); }
        return;
      }
      if (histOpen || callChar) return;
      const t = e.target;
      if (t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
      const step = (e.key === 'ArrowDown' || e.key === 'j') ? 1
        : (e.key === 'ArrowUp' || e.key === 'k') ? -1 : 0;
      if (step !== 0) {
        if (chars.length === 0) return;
        e.preventDefault();
        const next = Math.min(Math.max(activeIdx + step, 0), chars.length - 1);
        if (next === activeIdx) return;
        const el = containerRef.current?.querySelector(`[data-idx="${next}"]`);
        if (!el) return;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      if (e.key === 'Enter') {
        if (t?.closest?.('button, a, [role="button"], [tabindex]')) return;
        const c = chars[activeIdx];
        if (!c) return;
        e.preventDefault();
        chat(c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, chars, activeIdx, histOpen, callChar, enteringId]);

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
    dismissCoach();   // 会双击了，提示自然退场
    setBurst({ id: c.id, x, y, k: now });
    setTimeout(() => setBurst(b => (b && b.k === now ? null : b)), 850);
  };
  // 进入对话；draft 非空时随路由带过去，落地即预填在输入框里。
  const chat = async (c, draft) => {
    if (enteringId) return;
    setEnteringId(c.id);
    pushRecent(c);
    try {
      const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } });
      nav('/chats/' + d.conversation.id, draft ? { state: { draft } } : undefined);
    } catch (error) { toast(error?.message || '暂时无法进入对话，请稍后重试', 'err'); }
    finally { setEnteringId(null); }
  };
  const share = async (c) => {
    const url = shareUrl('/character/' + c.id);
    try { if (navigator.share) { await navigator.share({ title: c.name, url }); return; } }
    catch (error) { if (error?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('链接已复制'); }
    catch { toast('分享：' + c.name); }
  };

  const atEnd = !hasMore && activeIdx >= chars.length - 1;

  // 长按卡面 → 就地动作菜单。触屏专有（hover 在这里不存在），坐标由 pointerdown
  // 单独记录：useLongPress 只管计时，不带落点。
  const bindPress = useLongPress((c) => { tick(8); setPress({ c, at: pressPt.current }); });
  const dismissCoach = () => {
    setCoached(true);
    try { localStorage.setItem(COACH_KEY, '1'); } catch { /* */ }
  };

  // 顶部：分段（关注 / 推荐 / 新作，居中）+ 右侧搜索浮钮 —— 始终常驻（含空/加载态可切换）。
  // 分类只在 App 壳里接到轨上：Web 壳的发现页是另一套 Lumen 布局，
  // 三段固定宽的分段控件塞不下 N 个分类，且本代不碰 Web。
  const visibleSegs = appMode ? segs : BASE_SEGS;
  const topBar = (
    <div className="feed-top">
      <div className="feed-modes" ref={segsRef} role={appMode ? 'tablist' : undefined} aria-label={appMode ? '发现内容筛选' : undefined}>
        {visibleSegs.map(s => (
          <AppButton key={s.key} variant="tertiary" selected={mode === s.key}
            role={appMode ? 'tab' : undefined} aria-selected={appMode ? mode === s.key : undefined}
            data-seg-on={appMode && mode === s.key ? '1' : undefined}
            className={'feed-mode' + (mode === s.key ? ' on' : '')} onClick={() => setMode(s.key)}>{s.label}</AppButton>
        ))}
      </div>
      <AppIconButton className="feed-search" onClick={openCmdk} label="搜索" aria-label="搜索"><Search size={18} /></AppIconButton>
    </div>
  );

  if (loading && chars.length === 0) {
    return <div className={wrapCls}>{topBar}<div className="feed-state"><Drama size={40} className="feed-spin" /><span>正在挑选精彩角色…</span></div></div>;
  }
  if (loadError && chars.length === 0) {
    return (
      <div className={wrapCls}>{topBar}
        <div className="feed-state" role="alert"><EmptyArt kind="library" />
          <span>{loadError}</span>
          <AppButton variant="primary" onClick={() => load(mode)}>重新载入</AppButton>
        </div>
      </div>
    );
  }
  if (chars.length === 0) {
    return (
      <div className={wrapCls}>{topBar}
        <div className="feed-state"><EmptyArt kind="library" />
          {mode === 'follow' ? '还没有关注的创作者 —— 去「推荐」发现更多吧' : '暂无角色，快来发布第一个'}
        </div>
      </div>
    );
  }

  return (
    <div className={wrapCls}>
      {topBar}

      <div className="feed-root" ref={containerRef} data-scroll-root
        role={appMode ? undefined : 'feed'}
        aria-label={appMode ? undefined : '沉浸角色流'}
        aria-busy={appMode ? undefined : (loadingMore || undefined)}>
        {chars.map((c, i) => {
          const liked = likedSet.has(c.id);
          const faved = favSet.has(c.id);
          const expanded = expandedId === c.id;
          const near = Math.abs(i - activeIdx) <= 1; // 只有相邻卡渲染重文本层，长列表滚动更轻
          const greeting = near ? cleanGreeting(c.greeting) : '';
          // 角色带视频壁纸时，流里直接放动态背景 —— 和进对话后看到的是同一张
          // 「活的」壁纸，不再降级成静态头像。只给相邻卡挂 <video>（滑远即卸载，
          // 解码器和内存不随列表膨胀），远处的卡仍用静态图兜底。
          const media = resolveCharacterMedia(c);
          const liveBg = i === activeIdx && media.kind === 'video' && media.src;
          const sharedMediaStyle = i === activeIdx ? { viewTransitionName: 'qa-character-art' } : undefined;
          return (
            <section key={c.id} className={'feed-card' + (i === activeIdx ? ' cur' : '')} data-idx={i}
              role={appMode ? undefined : 'article'}
              aria-posinset={appMode ? undefined : i + 1}
              aria-setsize={appMode ? undefined : chars.length}
              aria-label={appMode ? undefined : c.name}>
              {liveBg
                ? <video className="feed-bg" src={assetUrl(media.src)} poster={media.poster ? assetUrl(media.poster) : undefined}
                    muted loop autoPlay playsInline preload="metadata" style={sharedMediaStyle} />
                : media.src
                  ? <img className="feed-bg" src={assetUrl(media.src)} alt="" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" style={sharedMediaStyle} />
                  : appMode
                    ? <QuietAquaCharacterArt className="feed-bg qa-oracle-character" loading={i < 2 ? 'eager' : 'lazy'} style={sharedMediaStyle} />
                    : <div className="feed-bg cover-art-box" style={sharedMediaStyle}><CoverArt name={c.name} /></div>}
              <div className="feed-scrim" />
              {c.ai_generated && <span className="feed-ai-mark" aria-hidden="true">由 AI 生成</span>}
              {/* 双击点赞层：盖住画面区域，按钮层在其上不受影响。
                  App 壳里同一层再接长按 → 就地动作菜单。 */}
              <div className="feed-tap" onClick={e => cardTap(e, c)}
                onPointerDown={appMode ? (e => { pressPt.current = { x: e.clientX, y: e.clientY }; }) : undefined}
                {...(appMode ? bindPress(c) : {})} />
              {burst && burst.id === c.id && (
                <span key={burst.k} className="feed-heart" style={{ left: burst.x, top: burst.y }} aria-hidden="true">
                  <Heart size={84} fill="currentColor" />
                </span>
              )}

              {/* 方案B：右侧竖排互动条（玻璃圆钮），浮于画面右缘，脱离底部信息栈 */}
              <div className="fd2-acts">
                <button className={'fd2-act' + (liked ? ' on' : '')} onClick={() => like(c)} aria-label={liked ? '取消本机心动标记' : '标记为心动，仅保存在本机'} aria-pressed={appMode ? liked : undefined}>
                  <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
                  <span>{liked ? '已心动' : '心动'}</span>
                </button>
                <button className={'fd2-act' + (faved ? ' on gold' : '')} onClick={() => fav(c)} aria-label="收藏" aria-pressed={appMode ? faved : undefined}>
                  <Star size={24} fill={faved ? 'currentColor' : 'none'} />
                  <span>{faved ? '已藏' : '收藏'}</span>
                </button>
                <button className="fd2-act" onClick={() => nav('/character/' + c.id)} aria-label={`查看角色详情，${c.uses || 0} 次对话`}>
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
                {/* 简介保持两行阅读节奏；需要时可展开或进入完整详情。 */}
                {!appMode && (c.intro || c.tagline) && (
                  <div className={'fd2-intro' + (expanded ? ' open' : '')}>
                    <button className="fd2-intro-copy" type="button" aria-expanded={appMode ? expanded : undefined}
                      onClick={() => setExpandedId(expanded ? null : c.id)}>
                      <span><ScrollText size={13} className="fd2-intro-ic" /><b>介绍：</b>{c.intro || c.tagline}</span>
                    </button>
                    <AppIconButton className="fd2-zoom" label="查看角色详情" aria-label="查看角色详情"
                      onClick={e => { e.stopPropagation(); nav('/character/' + c.id); }}>
                      <Maximize2 size={14} />
                    </AppIconButton>
                  </div>
                )}

                {/* 开场白仍可点击入戏，但视觉上降为一条补充叙事。 */}
                {greeting && (
                  <div className="fd2-greet" role="button" tabIndex={0}
                    onClick={() => chat(c)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      chat(c);
                    }}>
                    {greeting}
                  </div>
                )}

                <div className="fd2-meta">
                  <div className="fd2-id" role="button" tabIndex={0}
                    onClick={() => nav('/character/' + c.id)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      nav('/character/' + c.id);
                    }}>
                    <h2 className="fd2-name">{c.name} <ChevronRight size={17} /></h2>
                    {appMode && c.tagline && <p className="fd2-tagline">{c.tagline}</p>}
                    <div className="fd2-author">
                      <Avatar src={c.owner_avatar} name={c.owner_name} size={20} />
                      <span>{appMode ? `创作者：${c.owner_name}` : `@${c.owner_name}`}</span>
                      <CreatorV tier={c.owner_tier} size={12} />
                      {c.category && <em className="fd2-cat"><CategoryIcon slug={c.category} size={11} /> {categoryName(c.category)}</em>}
                    </div>
                  </div>
                </div>

                <div className="fd2-cta">
                  <AppButton className="fd2-enter" variant="primary" loading={enteringId === c.id} disabled={Boolean(enteringId)} onClick={() => chat(c)} aria-label="进入对话">
                    <MessageCircle size={19} /> 进入对话
                  </AppButton>
                  <AppIconButton className="fd2-call" variant="filled" onClick={() => { pushRecent(c); tick(12); setCallChar(c); }} label="语音通话" aria-label="语音通话" title="给 TA 打电话">
                    <Phone size={20} />
                  </AppIconButton>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* 切卡宣告（仅 Web）：屏幕阅读器以 polite 级别播报当前角色名与位次 */}
      {!appMode && (
        <div className="lgwd-live" aria-live="polite">
          {chars[activeIdx] ? `${chars[activeIdx].name}，第 ${activeIdx + 1} 张，共 ${chars.length} 张` : ''}
        </div>
      )}

      {/* 桌面右侧信息板（仅 Web；<1024px 由 CSS 隐藏）：数据就是当前卡，零新请求 */}
      {!appMode && chars[activeIdx] && (() => {
        const cur = chars[activeIdx];
        const curFaved = favSet.has(cur.id);
        const curGreeting = cleanGreeting(cur.greeting);
        return (
          <aside className="lgwd-panel lgw-glass-2" aria-label={`当前角色：${cur.name}`}>
            <div className="lgwd-panel-head">
              <Avatar src={cur.avatar} name={cur.name} size={46} />
              <div className="lgwd-panel-id">
                <b className="lgwd-panel-name">{cur.name}</b>
                <span className="lgwd-panel-owner">
                  @{cur.owner_name || '佚名'} <CreatorV tier={cur.owner_tier} size={12} />
                </span>
              </div>
            </div>
            {cur.category && (
              <em className="lgwd-panel-cat"><CategoryIcon slug={cur.category} size={12} /> {categoryName(cur.category)}</em>
            )}
            {(cur.intro || cur.tagline) && (
              <div className="lgwd-panel-sec">
                <h3>介绍</h3>
                <p>{cur.intro || cur.tagline}</p>
              </div>
            )}
            {curGreeting && (
              <div className="lgwd-panel-sec">
                <h3>开场白</h3>
                <p className="lgwd-panel-greet">{curGreeting}</p>
              </div>
            )}
            <div className="lgwd-panel-acts">
              <button type="button" className="lgwd-panel-chat" disabled={Boolean(enteringId)} onClick={() => chat(cur)}>
                <MessageCircle size={17} /> {enteringId === cur.id ? '正在进入…' : '开始对话'}
              </button>
              <button type="button" className="lgwd-panel-call" aria-label="语音通话" title="语音通话"
                onClick={() => { pushRecent(cur); tick(12); setCallChar(cur); }}>
                <Phone size={17} />
              </button>
              <button type="button" className={'lgwd-panel-fav' + (curFaved ? ' on' : '')}
                aria-label={curFaved ? '取消收藏' : '收藏'} title={curFaved ? '取消收藏' : '收藏'}
                aria-pressed={curFaved} onClick={() => fav(cur)}>
                <Star size={17} fill={curFaved ? 'currentColor' : 'none'} />
              </button>
            </div>
          </aside>
        );
      })()}

      {/* 加载 / 到底提示 —— 悬浮胶囊，不参与 snap 流 */}
      {loadingMore && <div className="feed-hint"><Loader2 size={14} className={appMode ? 'qa5-spin' : 'lgwd-spin'} /> 正在加载更多…</div>}
      {pageError && !loadingMore && (
        <div className="feed-hint feed-hint-error" role="alert">
          <span>{pageError}</span>
          <AppButton variant="tertiary" size="sm" onClick={() => setPageError('')}>重试</AppButton>
        </div>
      )}
      {atEnd && !loadingMore && <div className="feed-hint"><ChevronUp size={15} /> 已经到底啦，上滑回顶</div>}

      {/* 「历史」—— 最近看过的角色（本地记录），一键回访 / 续聊 */}
      {histOpen && (
        <div className="app-sheet-mask" onClick={() => setHistOpen(false)}>
          <div ref={historySheetRef} className="app-sheet" role="dialog" aria-modal="true" aria-label="最近看过" tabIndex={-1} onClick={e => e.stopPropagation()}>
            <div className="app-sheet-grip" />
            <h3 className="app-sheet-title"><History size={16} style={{ verticalAlign: -2, marginRight: 6 }} />最近看过</h3>
            {readRecent().length === 0 && (
              <div className="fd2-hist-empty">还没有浏览记录 —— 滑一滑，喜欢的角色都会记在这里</div>
            )}
            {readRecent().map(rc => (
              <div key={rc.id} className="fd2-hist-row">
                <button className="fd2-hist-main" type="button" onClick={() => { setHistOpen(false); nav('/character/' + rc.id); }}>
                  <Avatar src={rc.avatar} name={rc.name} size={44} />
                  <span className="fd2-hist-tx">
                    <b>{rc.name}</b>
                    <span>{rc.tagline || `@${rc.owner_name || '佚名'}`}</span>
                  </span>
                </button>
                <AppButton className="fd2-hist-go" size="sm" onClick={e => { e.stopPropagation(); setHistOpen(false); chat(rc); }}>
                  <MessageCircle size={13} /> 续聊
                </AppButton>
              </div>
            ))}
            <AppButton className="fd2-hist-close" variant="tertiary" onClick={() => setHistOpen(false)}><X size={15} /> 关闭</AppButton>
          </div>
        </div>
      )}

      {/* 首启一次的双击提示：真的双击过就自动消失，不必等人去点它 */}
      {appMode && !coached && chars.length > 0 && (
        <button type="button" className="feed-coach" onClick={dismissCoach}>
          <Heart size={15} /> 双击画面即可心动
        </button>
      )}

      {/* 长按卡面 → 就地动作。「不感兴趣」只在本次列表里移除：
          没有对应的后端负反馈接口，与其伪造一个不如老实做本地收敛。 */}
      {press && (
        <AppPressMenu
          at={press.at}
          onClose={() => setPress(null)}
          items={[
            { label: '查看角色', onSelect: () => nav('/character/' + press.c.id) },
            { label: '分享', onSelect: () => share(press.c) },
            {
              label: '不感兴趣',
              danger: true,
              onSelect: () => {
                setChars(prev => prev.filter(x => x.id !== press.c.id));
                toast('已从这次的推荐里移开');
              },
            },
          ]}
        />
      )}

      {/* 通话 —— 给角色打电话（沉浸式全屏） */}
      {callChar && <CallScreen character={callChar} onClose={() => setCallChar(null)} />}
    </div>
  );
}
