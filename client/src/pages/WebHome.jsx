// WebHome —— Web 壳「混合货架」首页（去 App 化重布局 D2）。
// 单列满宽结构（.page.lgwh，max-width 走 --lgw-content-wide）：
//   公告 → Spotlight 精选轮播 → 继续聊天货架 → 为你推荐 / 热门 / 新作 rail →
//   热门剧本货架 → 最近浏览 rail → 全量目录（分类 chip / 热门·最新分段 /
//   搜索 / character_new 实时插卡 / 错误重试 / 空态）。
// 问候 Hero、右栏（签到/任务/续读/快捷入口）已整列删除 —— 仪表盘职能归
// App 壳 /today；本页回归纯内容浏览。数据层仍消费 pages/home/shared.js。
// 样式：styles/web-lumen-home.css（html:not([data-app="1"]) 围栏，内容卡走
// .lgw-card 三件套，零实时模糊）。
import React, { useEffect, useRef, useState } from 'react';
import { useNav } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, GridSkeleton, CreatorV, CoinIcon } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { loadResumeRail, loadHeroAndPicks } from './home/shared.js';
import { msgPreview } from '../util.js';
import Spotlight from '../components/Spotlight.jsx';
import {
  Heart, MessageCircle, Search, Sparkles, ScrollText, Flame, Play,
  Megaphone, X, Star, Clock, ChevronLeft, ChevronRight, MessagesSquare,
  Shuffle, RotateCcw, ThumbsUp
} from 'lucide-react';
import '../styles/web-lumen-home.css';

// 目录海报卡（从 Home.jsx 搬运；类名沿用已换装的 .poster 家族）。
function Poster({ c, onView, onFav }) {
  return (
    <article className="poster lgwh-poster" onClick={() => onView(c)}>
      {c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
      {c.featured ? <span className="p-feat"><Star size={11} fill="currentColor" /> 推荐</span>
        : c.category ? <span className="p-cat"><CategoryIcon slug={c.category} size={12} /> {categoryName(c.category)}</span> : null}
      <button className={'p-fav' + (c.faved ? ' on' : '')} onClick={e => onFav(e, c)} title="收藏" aria-label={c.faved ? `取消收藏${c.name}` : `收藏${c.name}`}>
        <Heart size={15} fill={c.faved ? 'currentColor' : 'none'} />
      </button>
      <div className="p-info">
        <h3>{c.name}</h3>
        <p>{c.tagline || c.intro || '暂无简介'}</p>
        <div className="p-meta">
          <div className="author"><Avatar name={c.owner_name} size={17} /><span>{c.owner_name}</span><CreatorV tier={c.owner_tier} size={13} /></div>
          <span className="uses"><MessageCircle size={11} /> {c.uses}</span>
        </div>
      </div>
    </article>
  );
}

// 货架分区壳：头部（图标 + 标题 + 可选「更多」）+ 横滑轨 + 桌面左右滚动钮
// （hover 容器时显现；scrollBy 平滑翻 80% 视口宽，触屏直接手指横滑）。
function Shelf({ icon: Icon, title, more, onMore, children }) {
  const trackRef = useRef(null);
  const scroll = (dir) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <section className="lgwh-shelf" aria-label={title}>
      <div className="lgwh-shelf-head">
        <h2>{Icon && <Icon size={17} aria-hidden="true" />} {title}</h2>
        {more && <button type="button" className="lgwh-more" onClick={onMore}>{more} <ChevronRight size={14} aria-hidden="true" /></button>}
      </div>
      <div className="lgwh-shelf-body">
        <div className="lgwh-shelf-track" ref={trackRef}>{children}</div>
        <button type="button" className="lgwh-shelf-nav prev" aria-label={`「${title}」向左滚动`} onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
        <button type="button" className="lgwh-shelf-nav next" aria-label={`「${title}」向右滚动`} onClick={() => scroll(1)}><ChevronRight size={18} /></button>
      </div>
    </section>
  );
}

// 继续聊天横卡：头像 + 角色名 + 最后消息摘要 + 好感度火苗。
function ContinueCard({ cv, onOpen }) {
  const preview = msgPreview(cv.last_message);
  return (
    <button
      type="button"
      className="lgwh-cont lgw-card lgw-hoverable"
      onClick={() => onOpen(cv)}
      aria-label={`继续与${cv.character_name || '角色'}的对话${cv.affinity > 0 ? `，好感度 ${cv.affinity}` : ''}`}
    >
      <Avatar src={cv.character_avatar} name={cv.character_name} size={52} />
      <span className="lgwh-cont-tx">
        <b>{cv.character_name}</b>
        <span className="lgwh-cont-preview">{preview || '继续这段故事'}</span>
      </span>
      {cv.affinity > 0 && <span className="lgwh-aff"><Flame size={11} aria-hidden="true" /> {cv.affinity}</span>}
    </button>
  );
}

export default function WebHome() {
  const toast = useToast();
  const nav = useNav();

  // —— 货架数据 ——
  const [hero, setHero] = useState(null);     // shared.js 数据层附带（本布局不渲染大卡，只参与加载态）
  const [pick, setPick] = useState(null);     // null=加载中 / 数组（个性化优先）
  const [resume, setResume] = useState(null); // null=加载中 / 数组
  const [hot, setHot] = useState(null);       // null=加载中 / 数组（Spotlight + 热门货架共用）
  const [fresh, setFresh] = useState([]);     // 新作货架

  // —— 浏览目录数据（从 Home.jsx 搬运）——
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('hot');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState([]);
  const [recent, setRecent] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [ann, setAnn] = useState(null);

  useEffect(() => { loadHeroAndPicks(setHero, setPick); }, []);
  useEffect(() => { loadResumeRail(setResume, 12); }, []);
  useEffect(() => { api('/characters/public?sort=hot').then(d => setHot(d.characters || [])).catch(() => setHot([])); }, []);
  useEffect(() => { api('/characters/public?sort=new').then(d => setFresh((d.characters || []).slice(0, 12))).catch(() => {}); }, []);
  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories)).catch(() => {}); }, []);
  useEffect(() => { api('/scripts?sort=hot').then(d => setScripts(d.scripts.slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('recent_chars') || '[]').slice(0, 12)); } catch { /* */ }
    api('/announcements').then(d => { const t = d.announcements?.[0]; if (t && localStorage.getItem('ann_seen') !== String(t.id)) setAnn(t); }).catch(() => {});
  }, []);

  // Spotlight 选品：精选优先，不足 5 张回落热门前 5；热门货架去掉已上轮播的。
  const hotList = Array.isArray(hot) ? hot : [];
  const featuredSpot = hotList.filter(c => c.featured).slice(0, 5);
  const spot = featuredSpot.length >= 5 ? featuredSpot : hotList.slice(0, 5);
  const spotIds = new Set(spot.map(c => c.id));
  const hotRail = hotList.filter(c => !spotIds.has(c.id)).slice(0, 12);

  // 目录主加载（分类/排序/搜索）。错误不再只吐 toast：目录是页面主体，
  // 失败给 role="alert" + 原地重试。
  const load = () => {
    setLoading(true);
    setLoadErr(null);
    api(`/characters/public?category=${cat}&q=${encodeURIComponent(q)}&sort=${sort}`)
      .then(d => setChars(d.characters))
      .catch(e => setLoadErr(e?.message || '网络异常，请稍后重试'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat, sort]);

  // 实时新角色卡：他人发布公开角色时秒级广播到达，直接插到列表顶部第一时间可见，并弹提示。
  useRealtimeEvent('character_new', (data) => {
    const c = data?.character; if (!c) return;
    setChars(prev => prev.some(x => x.id === c.id) ? prev : [{ ...c, uses: 0, likes: 0, faved: false }, ...prev]);
    toast(`✨ ${c.owner_name || '有人'} 发布了新角色「${c.name}」`);
  });

  const view = (c) => nav('/character/' + c.id);
  const fav = async (e, c) => {
    e.stopPropagation();
    try {
      const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' });
      const upd = x => x.id === c.id ? { ...x, faved: d.faved } : x;
      setChars(cs => cs.map(upd));
      setRecent(cs => cs.map(upd));
      setFresh(cs => cs.map(upd));
      setHot(cs => Array.isArray(cs) ? cs.map(upd) : cs);
      setPick(cs => Array.isArray(cs) ? cs.map(upd) : cs);
    } catch (err) { toast(err.message, 'err'); }
  };
  const chat = async (e, c) => {
    e.stopPropagation();
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (err) { toast(err.message, 'err'); }
  };
  const dismissAnn = () => { if (ann) localStorage.setItem('ann_seen', String(ann.id)); setAnn(null); };
  // 手气不错：从当前公开角色中随机挑一个，带你去意外邂逅。
  const lucky = () => {
    const pool = (chars.length ? chars : hotList);
    if (!pool.length) { toast('还没有可漫游的角色', 'err'); return; }
    nav('/character/' + pool[Math.floor(Math.random() * pool.length)].id);
  };

  return (
    <div className="page lgwh" aria-busy={hero === null || hot === null || resume === null}>

      {/* —— 公告条 —— */}
      {ann && (
        <div className="ann-banner lgwh-ann" onClick={() => nav('/announcements')} style={{ cursor: 'pointer' }}>
          <span className="ann-ic"><Megaphone size={19} /></span>
          <div className="ann-tx"><b>{ann.title}</b><p>{ann.body}</p></div>
          <button className="ann-x" onClick={e => { e.stopPropagation(); dismissAnn(); }} aria-label="关闭公告"><X size={16} /></button>
        </div>
      )}

      {/* —— 精选轮播（载入中给等高骨架，避免首屏跳动） —— */}
      {hot === null
        ? <div className="lgwh-skel lgwh-spot-skel" role="status" aria-label="正在加载精选轮播" />
        : spot.length > 0 && <Spotlight items={spot} onView={view} onChat={chat} />}

      {/* —— 继续聊天货架（空则整段隐藏） —— */}
      {Array.isArray(resume) && resume.length > 0 && (
        <Shelf icon={MessagesSquare} title="继续聊天" more="全部" onMore={() => nav('/chats')}>
          {resume.map(cv => <ContinueCard key={cv.id} cv={cv} onOpen={(x) => nav('/chats/' + x.id)} />)}
        </Shelf>
      )}

      {/* —— 为你推荐（个性化优先，冷启动回落热门） —— */}
      {pick === null ? (
        <section className="lgwh-shelf" aria-label="为你推荐">
          <div className="lgwh-shelf-head"><h2><ThumbsUp size={17} aria-hidden="true" /> 为你推荐</h2></div>
          <div className="lgwh-rail-skels" role="status" aria-label="正在加载推荐">
            {[0, 1, 2, 3].map(i => <div key={i} className="lgwh-skel lgwh-pick-skel" aria-hidden="true" />)}
          </div>
        </section>
      ) : pick.length > 0 && (
        <Shelf icon={ThumbsUp} title="为你推荐">
          {pick.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
        </Shelf>
      )}

      {/* —— 热门货架（去掉轮播已展示的） —— */}
      {hotRail.length > 0 && (
        <Shelf icon={Flame} title="热门">
          {hotRail.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
        </Shelf>
      )}

      {/* —— 新作货架 —— */}
      {fresh.length > 0 && (
        <Shelf icon={Sparkles} title="新作">
          {fresh.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
        </Shelf>
      )}

      {/* —— 热门剧本货架 —— */}
      {scripts.length > 0 && (
        <Shelf icon={ScrollText} title="热门剧本" more="查看全部" onMore={() => nav('/scripts')}>
          {scripts.map(s => (
            <button key={s.id} type="button" className="lgwh-script lgw-card lgw-hoverable" onClick={() => nav('/script/' + s.id)}>
              <span className="lgwh-script-cover" aria-hidden="true">
                {s.cover ? <img src={assetUrl(s.cover)} alt="" loading="lazy" /> : <span className="lgwh-script-ph"><ScrollText size={30} /></span>}
                <span className={'lgwh-script-price' + (s.price_gold > 0 ? '' : ' is-free')}>
                  {s.price_gold > 0 ? <><CoinIcon size={12} /> {s.price_gold}</> : '免费'}
                </span>
              </span>
              <span className="lgwh-script-meta">
                <b>{s.title}</b>
                <span className="lgwh-script-sum">{s.summary}</span>
                <span className="lgwh-script-foot">
                  <span><Play size={11} aria-hidden="true" /> {s.plays}</span>
                  <span className="lgwh-script-author">{s.author_name}</span>
                </span>
              </span>
            </button>
          ))}
        </Shelf>
      )}

      {/* —— 最近浏览（目录前收口） —— */}
      {recent.length > 0 && (
        <Shelf icon={Clock} title="最近浏览">
          {recent.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
        </Shelf>
      )}

      {/* —— 全量目录：分类 chip + 排序分段 + 搜索 + 海报网格（实时插卡落点） —— */}
      <section className="lgwh-sec lgwh-catalog" aria-labelledby="lgwh-catalog-title">
        <div className="lgwh-sec-head">
          <h2 id="lgwh-catalog-title">全部角色</h2>
          <div className="lgwh-cat-acts">
            <button type="button" className="lgwh-btn ghost" onClick={lucky} title="随机漫游一个角色">
              <Shuffle size={16} aria-hidden="true" /> 手气不错
            </button>
            <button type="button" className="lgwh-btn primary" onClick={() => nav('/publish')}>
              <Sparkles size={16} aria-hidden="true" /> 发布作品
            </button>
          </div>
        </div>

        <div className="cat-bar lgwh-cats">
          <button className={'cat-chip' + (cat === 'all' ? ' active' : '')} onClick={() => setCat('all')} aria-pressed={cat === 'all'}>
            <Flame size={14} /> 全部
          </button>
          {cats.map(c => (
            <button key={c.slug} className={'cat-chip' + (cat === c.slug ? ' active' : '')} onClick={() => setCat(c.slug)} aria-pressed={cat === c.slug}>
              <CategoryIcon slug={c.slug} size={14} /> {c.name}
            </button>
          ))}
        </div>

        <div className="lgwh-toolbar">
          <div className="lgwh-seg" role="group" aria-label="排序方式">
            <button type="button" className={sort === 'hot' ? 'is-on' : ''} aria-pressed={sort === 'hot'} onClick={() => setSort('hot')}>
              <Flame size={14} aria-hidden="true" /> 热门
            </button>
            <button type="button" className={sort === 'new' ? 'is-on' : ''} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>
              <Clock size={14} aria-hidden="true" /> 最新
            </button>
          </div>
          <div className="lgwh-search">
            <input
              className="lgwh-search-input"
              placeholder="搜索角色 / 标签…"
              aria-label="搜索角色或标签"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
            />
            <button type="button" className="lgwh-search-btn" onClick={load} aria-label="搜索"><Search size={16} /></button>
          </div>
        </div>

        {loadErr ? (
          <div className="lgwh-error" role="alert">
            <b>目录加载失败</b>
            <span>{loadErr}</span>
            <button type="button" className="lgwh-btn ghost" onClick={load}>
              <RotateCcw size={14} aria-hidden="true" /> 重试
            </button>
          </div>
        ) : loading ? (
          <GridSkeleton n={8} />
        ) : chars.length === 0 ? (
          <div className="lgwh-empty">
            <EmptyArt kind="library" />
            <b>该分类下还没有公开角色</b>
            <span>换个分类逛逛，或者发布你的第一个角色。</span>
            <button type="button" className="lgwh-btn primary" onClick={() => nav('/publish')}>
              <Sparkles size={14} aria-hidden="true" /> 发布作品
            </button>
          </div>
        ) : (
          <div className="poster-grid lgwh-posters">
            {chars.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
          </div>
        )}
      </section>
    </div>
  );
}
