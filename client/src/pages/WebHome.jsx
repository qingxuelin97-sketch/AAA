// WebHome —— Web 壳「今日仪表盘 × 浏览目录」合体首页（Lumen Glass 大更新）。
// 主列：时段问候 Hero → 公告 → 今日精选大卡 → 为你推荐 / 最近浏览 rail →
//       全部角色目录（分类 chip / 热门·最新分段 / 搜索 / character_new 实时
//       插卡）→ 热门剧本。
// 右栏（≥1024px 固定 320px；<1024px 折到主列顶部）：签到卡（未签 act 实底 /
//       已签 jade / 连签天数）→ 每日任务（保留 Web 的直接领取）→ 续读轨
//       （头像 + 好感度）→ 快捷入口 6 宫（语义 tone 色）。
// 数据层与 App 端 /today 共用 pages/home/shared.js；浏览目录逻辑从 Home.jsx
// 搬运复用（Home.jsx 保留一个发布周期，本页不动它），API 调用与行为一致。
// 样式：styles/web-lumen-home.css（html:not([data-app="1"]) 围栏，内容卡走
// .lgw-card 三件套，零实时模糊）。
import React, { useEffect, useState } from 'react';
import { useNav } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, GridSkeleton, CreatorV, CoinIcon } from '../ui.jsx';
import { CategoryIcon, categoryName } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { greeting, skyClass, useCheckin, loadResumeRail, loadHeroAndPicks } from './home/shared.js';
import {
  Heart, MessageCircle, Search, Sparkles, ScrollText, Flame, Drama, Play,
  Megaphone, X, Star, Clock, ChevronRight, MessagesSquare, Check, Shuffle,
  Gift, Compass, Dices, PartyPopper, Users, Trophy, RotateCcw, ThumbsUp,
  ListChecks
} from 'lucide-react';
import '../styles/web-lumen-home.css';

// 快捷入口 —— 与 App 启动页同一张目的地清单；tone 走内容语义色
// （金=奖励、珊瑚=活动、墨=剧本、紫=剧场创作、蓝=社区关系、金=荣誉）。
const QUICK_LINKS = [
  { to: '/gacha', ic: Dices, label: '扭蛋', tone: 'gold' },
  { to: '/events', ic: PartyPopper, label: '活动', tone: 'coral' },
  { to: '/scripts', ic: ScrollText, label: '剧本', tone: 'ink' },
  { to: '/theater', ic: Drama, label: '剧场', tone: 'violet' },
  { to: '/community', ic: Users, label: '社区', tone: 'azure' },
  { to: '/leaderboard', ic: Trophy, label: '排行榜', tone: 'gold' }
];

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

// 今日精选大卡 —— 取代 Home 的自动轮播聚光灯：一张编辑推荐位，媒体在左、
// 文案在右（窄屏上下叠放），CTA 直接开聊。
function FeatureHero({ hero, onView, onChat }) {
  return (
    <article className="lgwh-feature lgw-card lgw-hoverable" aria-labelledby="lgwh-feature-name">
      <button
        type="button"
        className="lgwh-feature-open"
        onClick={() => onView(hero)}
        aria-label={`查看今日精选角色：${hero.name}`}
      >
        <span className="lgwh-feature-media" aria-hidden="true">
          {hero.avatar
            ? <img src={assetUrl(hero.avatar)} alt="" loading="eager" fetchPriority="high" />
            : <span className="lgwh-feature-ph"><CoverArt name={hero.name} /></span>}
          <span className="lgwh-feature-scrim" />
        </span>
        <span className="lgwh-feature-body">
          <span className="lgwh-feature-tag"><Star size={12} fill="currentColor" /> 今日精选</span>
          <b className="lgwh-feature-name" id="lgwh-feature-name">{hero.name}</b>
          <span className="lgwh-feature-copy">{hero.tagline || hero.intro || '一个等待被开启的故事'}</span>
          <span className="lgwh-feature-meta">
            <span className="lgwh-feature-author">
              <Avatar src={hero.owner_avatar} name={hero.owner_name} size={20} /> {hero.owner_name}
              <CreatorV tier={hero.owner_tier} size={13} />
            </span>
            <span className="lgwh-feature-uses"><MessageCircle size={13} /> {hero.uses}</span>
            {hero.category && <span className="lgwh-feature-cat"><CategoryIcon slug={hero.category} size={13} /> {categoryName(hero.category)}</span>}
          </span>
        </span>
      </button>
      <div className="lgwh-feature-acts">
        <button type="button" className="lgwh-btn primary" onClick={(e) => onChat(e, hero)} aria-label={`与${hero.name}开始对话`}>
          <MessagesSquare size={16} /> 开始对话
        </button>
        <button type="button" className="lgwh-btn ghost" onClick={() => onView(hero)}>查看详情</button>
      </div>
    </article>
  );
}

// 右栏 · 签到卡（三态：未签 act 实底 / 已签 jade / 连签天数徽标）。
function CheckinCard() {
  const { checked, streak, busy, checkin } = useCheckin();
  return (
    <section className={'lgwh-card lgw-card lgwh-checkin' + (checked ? ' is-done' : '')} aria-labelledby="lgwh-checkin-title">
      <div className="lgwh-card-head">
        <h2 id="lgwh-checkin-title"><Gift size={16} aria-hidden="true" /> 每日签到</h2>
        {streak > 0 && <span className="lgwh-streak"><Flame size={12} aria-hidden="true" /> 连签 {streak} 天</span>}
      </div>
      <p className="lgwh-card-sub">{checked ? '今天的奖励已入账，明天再来续上连签。' : '签到领金币，连续签到奖励更丰厚。'}</p>
      <button
        type="button"
        className="lgwh-checkin-cta"
        onClick={checkin}
        disabled={busy || checked}
        aria-busy={busy || undefined}
        aria-label={checked ? (streak ? `已连续签到 ${streak} 天` : '今天已签到') : '签到领金币'}
      >
        {checked
          ? <><Check size={16} aria-hidden="true" /> {streak ? `已签到 · 连签 ${streak} 天` : '今天已签到'}</>
          : busy
            ? '签到中…'
            : <><Gift size={16} aria-hidden="true" /> 立即签到</>}
      </button>
    </section>
  );
}

// 右栏 · 每日任务（保留 Web 的直接领取：done 未领 → 点击即领；未完成 →
// 跳到对应玩法；已领取降权重展示）。
function TasksCard({ tasks, onClaim, onAll }) {
  return (
    <section className="lgwh-card lgw-card lgwh-tasks" aria-labelledby="lgwh-tasks-title">
      <div className="lgwh-card-head">
        <h2 id="lgwh-tasks-title"><ListChecks size={16} aria-hidden="true" /> 每日任务</h2>
        <button type="button" className="lgwh-more" onClick={onAll}>全部活动 <ChevronRight size={14} aria-hidden="true" /></button>
      </div>
      {tasks === null ? (
        <div className="lgwh-task-skels" role="status" aria-label="正在加载每日任务">
          {[0, 1, 2].map(i => <div key={i} className="lgwh-skel lgwh-task-skel" aria-hidden="true" />)}
        </div>
      ) : tasks.length === 0 ? (
        <p className="lgwh-card-sub">今天还没有任务，去活动页看看别的玩法。</p>
      ) : (
        <div className="lgwh-task-list">
          {tasks.map(t => (
            <button
              key={t.id}
              type="button"
              className={'lgwh-task' + (t.claimed ? ' is-claimed' : t.done ? ' is-done' : '')}
              onClick={() => onClaim(t)}
              title={t.claimed ? '已领取' : t.done ? '点击领取奖励' : '去完成'}
            >
              <span className="lgwh-task-tx">
                <b>{t.name}</b>
                <span className="lgwh-task-meta">
                  {t.claimed
                    ? <><Check size={12} aria-hidden="true" /> 已领取</>
                    : t.done
                      ? <><CoinIcon size={12} /> 领 {t.reward}</>
                      : <>{t.progress}/{t.target} · +{t.reward} 金币</>}
                </span>
              </span>
              <span className="lgwh-task-bar" aria-hidden="true">
                <i style={{ width: Math.min(100, Math.round((t.progress || 0) / (t.target || 1) * 100)) + '%' }} />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// 右栏 · 续读轨（最近对话：头像 + 好感度；空态给出真实的下一步）。
function ResumeCard({ resume, onOpen, onAll, onExplore }) {
  return (
    <section className="lgwh-card lgw-card lgwh-resume" aria-labelledby="lgwh-resume-title">
      <div className="lgwh-card-head">
        <h2 id="lgwh-resume-title"><Clock size={16} aria-hidden="true" /> 继续你的故事</h2>
        <button type="button" className="lgwh-more" onClick={onAll}>全部 <ChevronRight size={14} aria-hidden="true" /></button>
      </div>
      {resume === null ? (
        <div className="lgwh-task-skels" role="status" aria-label="正在加载最近对话">
          {[0, 1, 2].map(i => <div key={i} className="lgwh-skel lgwh-resume-skel" aria-hidden="true" />)}
        </div>
      ) : resume.length === 0 ? (
        <div className="lgwh-mini-empty">
          <EmptyArt kind="chat" size={104} />
          <b>还没有开始任何故事</b>
          <button type="button" className="lgwh-btn ghost" onClick={onExplore}>
            <Compass size={14} aria-hidden="true" /> 去挑一个角色
          </button>
        </div>
      ) : (
        <div className="lgwh-resume-list">
          {resume.map(cv => (
            <button
              key={cv.id}
              type="button"
              className="lgwh-resume-row"
              onClick={() => onOpen(cv)}
              aria-label={`继续与${cv.character_name || '角色'}的故事${cv.affinity ? `，好感度 ${cv.affinity}` : ''}`}
            >
              <Avatar src={cv.character_avatar} name={cv.character_name} size={40} />
              <span className="lgwh-resume-name">{cv.character_name}</span>
              {cv.affinity
                ? <span className="lgwh-aff"><Flame size={11} aria-hidden="true" /> {cv.affinity}</span>
                : <span className="lgwh-aff is-dim">未开始</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// 右栏 · 快捷入口 6 宫。
function QuickLinks({ onGo }) {
  return (
    <nav className="lgwh-card lgw-card lgwh-quick" aria-label="快捷入口">
      <div className="lgwh-card-head"><h2><Sparkles size={16} aria-hidden="true" /> 快捷入口</h2></div>
      <div className="lgwh-quick-grid">
        {QUICK_LINKS.map(s => (
          <button key={s.to} type="button" className="lgwh-quick-item" data-tone={s.tone} onClick={() => onGo(s.to)}>
            <span className="lgwh-quick-ic" aria-hidden="true"><s.ic size={20} /></span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function WebHome() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNav();

  // —— 仪表盘数据（共享数据层）——
  const [hero, setHero] = useState(null);     // null=加载中 / false=空 / 对象
  const [pick, setPick] = useState(null);     // null=加载中 / 数组（个性化优先）
  const [resume, setResume] = useState(null); // null=加载中 / 数组
  const [tasks, setTasks] = useState(null);   // null=加载中 / 数组（Web 全量含已领）

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

  const displayName = user?.display_name || user?.username || '旅人';

  useEffect(() => { loadHeroAndPicks(setHero, setPick); }, []);
  useEffect(() => { loadResumeRail(setResume, 8); }, []);
  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories)).catch(() => {}); }, []);
  useEffect(() => { api('/scripts?sort=hot').then(d => setScripts(d.scripts.slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('recent_chars') || '[]').slice(0, 12)); } catch { /* */ }
    api('/announcements').then(d => { const t = d.announcements?.[0]; if (t && localStorage.getItem('ann_seen') !== String(t.id)) setAnn(t); }).catch(() => {});
  }, []);

  // 每日任务：Web 语义 —— 全量清单（含已领取），支持右栏直接领取。
  const loadTasks = () => api('/engage/tasks').then(d => setTasks(d.tasks || [])).catch(() => setTasks([]));
  useEffect(() => { loadTasks(); }, []);
  const TASK_LINK = { checkin: '/wallet', chat: '/library', gacha: '/gacha', fav: '/', like: '/community' };
  const claimTask = async (t) => {
    if (t.claimed) return;
    if (!t.done) { nav(TASK_LINK[t.id] || '/events'); return; }
    try { await api(`/engage/tasks/${t.id}/claim`, { method: 'POST' }); toast(`领取成功！+${t.reward} 金币`); loadTasks(); }
    catch (e) { toast(e.message, 'err'); }
  };

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
    const pool = (chars.length ? chars : (Array.isArray(pick) ? pick : []));
    if (!pool.length) { toast('还没有可漫游的角色', 'err'); return; }
    nav('/character/' + pool[Math.floor(Math.random() * pool.length)].id);
  };

  return (
    <div className="page lgwh" aria-busy={hero === null || resume === null || tasks === null}>
      <div className="lgwh-grid">

        {/* —— 时段问候 Hero（主列顶部；大标题 --lg-type-hero + 衬线） —— */}
        <header className={'lgwh-hello ' + skyClass()}>
          <div className="lgwh-hello-copy">
            <span className="lgwh-eyebrow">{greeting()}，{displayName}</span>
            <h1 className="lgwh-title">发现你的下一段故事</h1>
            <p className="lgwh-sub">挑选一个角色，开启属于你的沉浸剧场。</p>
          </div>
          <div className="lgwh-hello-acts">
            <button type="button" className="lgwh-btn ghost" onClick={lucky} title="随机漫游一个角色">
              <Shuffle size={16} aria-hidden="true" /> 手气不错
            </button>
            <button type="button" className="lgwh-btn primary" onClick={() => nav('/publish')}>
              <Sparkles size={16} aria-hidden="true" /> 发布作品
            </button>
          </div>
        </header>

        {/* —— 右栏（<1024px 折到主列顶部，紧跟问候） —— */}
        <aside className="lgwh-rail" aria-label="今日面板">
          <CheckinCard />
          <TasksCard tasks={tasks} onClaim={claimTask} onAll={() => nav('/events')} />
          <ResumeCard
            resume={resume}
            onOpen={(cv) => nav('/chats/' + cv.id)}
            onAll={() => nav('/chats')}
            onExplore={() => document.getElementById('lgwh-catalog-title')?.scrollIntoView({ block: 'start' })}
          />
          <QuickLinks onGo={(to) => nav(to)} />
        </aside>

        {/* —— 主列 —— */}
        <main className="lgwh-main">
          {ann && (
            <div className="ann-banner lgwh-ann" onClick={() => nav('/announcements')} style={{ cursor: 'pointer' }}>
              <span className="ann-ic"><Megaphone size={19} /></span>
              <div className="ann-tx"><b>{ann.title}</b><p>{ann.body}</p></div>
              <button className="ann-x" onClick={e => { e.stopPropagation(); dismissAnn(); }} aria-label="关闭公告"><X size={16} /></button>
            </div>
          )}

          {/* 今日精选 */}
          {hero === null && <div className="lgwh-skel lgwh-feature-skel" role="status" aria-label="正在加载今日精选" />}
          {hero && <FeatureHero hero={hero} onView={view} onChat={chat} />}

          {/* 为你推荐（个性化优先，冷启动回落热门） */}
          {pick === null ? (
            <section className="lgwh-sec" aria-label="为你推荐">
              <div className="lgwh-sec-head"><h2><ThumbsUp size={16} aria-hidden="true" /> 为你推荐</h2></div>
              <div className="lgwh-rail-skels" role="status" aria-label="正在加载推荐">
                {[0, 1, 2].map(i => <div key={i} className="lgwh-skel lgwh-pick-skel" aria-hidden="true" />)}
              </div>
            </section>
          ) : pick.length > 0 && (
            <section className="lgwh-sec" aria-labelledby="lgwh-pick-title">
              <div className="lgwh-sec-head">
                <h2 id="lgwh-pick-title"><ThumbsUp size={16} aria-hidden="true" /> 为你推荐</h2>
              </div>
              <div className="rail lgwh-hrail">
                {pick.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
              </div>
            </section>
          )}

          {/* 最近浏览 */}
          {recent.length > 0 && (
            <section className="lgwh-sec" aria-labelledby="lgwh-recent-title">
              <div className="lgwh-sec-head">
                <h2 id="lgwh-recent-title"><Clock size={16} aria-hidden="true" /> 最近浏览</h2>
              </div>
              <div className="rail lgwh-hrail">
                {recent.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} />)}
              </div>
            </section>
          )}

          {/* 全部角色：分类 chip + 排序分段 + 搜索 + 海报网格（实时插卡落点） */}
          <section className="lgwh-sec lgwh-catalog" aria-labelledby="lgwh-catalog-title">
            <div className="lgwh-sec-head">
              <h2 id="lgwh-catalog-title">全部角色</h2>
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

          {/* 热门剧本 */}
          {scripts.length > 0 && (
            <section className="lgwh-sec" aria-labelledby="lgwh-scripts-title">
              <div className="lgwh-sec-head">
                <h2 id="lgwh-scripts-title"><Flame size={17} aria-hidden="true" /> 热门剧本</h2>
                <button type="button" className="lgwh-more" onClick={() => nav('/scripts')}>查看全部 <ChevronRight size={14} aria-hidden="true" /></button>
              </div>
              <div className="lgwh-scripts">
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
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
