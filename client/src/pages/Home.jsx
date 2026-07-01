import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, GridSkeleton, CreatorV, CoinIcon } from '../ui.jsx';
import { Heart, MessageCircle, Search, Sparkles, ScrollText, Flame, Drama, Play, Megaphone, X, Star, Clock, ChevronLeft, ChevronRight, MessagesSquare, ListChecks, Check, Shuffle } from 'lucide-react';
import { CategoryIcon, categoryName } from '../assets.jsx';

// Auto-rotating spotlight of featured characters — the hero of the discover page.
function Spotlight({ items, onView, onChat }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = items.slice(0, 5);
  useEffect(() => {
    if (paused || list.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 5200);
    return () => clearInterval(t);
  }, [paused, list.length]);
  useEffect(() => { if (i >= list.length) setI(0); }, [i, list.length]);
  if (list.length === 0) return null;
  const c = list[i];
  const go = (d) => setI((x) => (x + d + list.length) % list.length);
  return (
    <div className="spotlight" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="sp-stage">
        {list.map((it, n) => (
          <div key={it.id} className={'sp-slide' + (n === i ? ' on' : '')} aria-hidden={n !== i}>
            {it.avatar ? <img src={it.avatar} alt="" loading="lazy" decoding="async" /> : <div className="sp-ph"><Drama size={64} /></div>}
          </div>
        ))}
        <div className="sp-scrim" />
        <div className="sp-body">
          <span className="sp-tag"><Star size={12} fill="currentColor" /> 官方推荐</span>
          <h2 key={c.id}>{c.name}</h2>
          <p>{c.tagline || c.intro || '一个等待被开启的故事。'}</p>
          <div className="sp-meta">
            <span className="sp-author"><Avatar src={c.owner_avatar} name={c.owner_name} size={20} /> {c.owner_name}<CreatorV tier={c.owner_tier} size={13} /></span>
            <span><MessageCircle size={13} /> {c.uses}</span>
            {c.category && <span><CategoryIcon slug={c.category} size={13} /> {categoryName(c.category)}</span>}
          </div>
          <div className="sp-acts">
            <button className="btn primary" onClick={(e) => onChat(e, c)}><MessagesSquare size={16} /> 开始对话</button>
            <button className="btn glass" onClick={() => onView(c)}>查看详情</button>
          </div>
        </div>
        {list.length > 1 && <>
          <button className="sp-nav prev" onClick={() => go(-1)} aria-label="上一个"><ChevronLeft size={20} /></button>
          <button className="sp-nav next" onClick={() => go(1)} aria-label="下一个"><ChevronRight size={20} /></button>
        </>}
      </div>
      {list.length > 1 && (
        <div className="sp-dots">
          {list.map((_, n) => <button key={n} className={'sp-dot' + (n === i ? ' on' : '')} onClick={() => setI(n)} aria-label={'第' + (n + 1) + '个'} />)}
        </div>
      )}
    </div>
  );
}

function Poster({ c, onView, onFav, onChat }) {
  return (
    <article className="poster" onClick={() => onView(c)}>
      {c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : <div className="ph"><Drama size={44} /></div>}
      {c.featured ? <span className="p-feat"><Star size={11} fill="currentColor" /> 推荐</span>
        : c.category ? <span className="p-cat"><CategoryIcon slug={c.category} size={12} /> {categoryName(c.category)}</span> : null}
      <button className={'p-fav' + (c.faved ? ' on' : '')} onClick={e => onFav(e, c)} title="收藏"><Heart size={15} fill={c.faved ? 'currentColor' : 'none'} /></button>
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

export default function Home() {
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('hot');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ann, setAnn] = useState(null);
  const [resume, setResume] = useState([]);
  const [tasks, setTasks] = useState([]);
  const toast = useToast();
  const nav = useNavigate();

  const TASK_LINK = { checkin: '/wallet', chat: '/library', gacha: '/gacha', fav: '/', like: '/community' };
  useEffect(() => { api('/engage/tasks').then(d => setTasks(d.tasks || [])).catch(() => {}); }, []);
  const claimTask = async (t) => {
    if (t.claimed) return;
    if (!t.done) { nav(TASK_LINK[t.id] || '/events'); return; }
    try { await api(`/engage/tasks/${t.id}/claim`, { method: 'POST' }); toast(`领取成功！+${t.reward} 金币`); api('/engage/tasks').then(d => setTasks(d.tasks || [])); }
    catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { api('/chat/conversations').then(d => setResume((d.conversations || []).slice(0, 8))).catch(() => {}); }, []);
  useEffect(() => { api('/meta/categories').then(d => setCats(d.categories)).catch(() => {}); }, []);
  useEffect(() => { api('/scripts?sort=hot').then(d => setScripts(d.scripts.slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => { api('/characters/public?sort=hot').then(d => setFeatured(d.characters.filter(c => c.featured).slice(0, 12))).catch(() => {}); }, []);
  useEffect(() => { api('/characters/recommended').then(d => { if (d.personalized) setRecommended(d.characters || []); }).catch(() => {}); }, []);
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
      setChars(cs => cs.map(upd)); setFeatured(cs => cs.map(upd)); setRecent(cs => cs.map(upd)); setRecommended(cs => cs.map(upd));
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
    const pool = (chars.length ? chars : featured);
    if (!pool.length) { toast('还没有可漫游的角色', 'err'); return; }
    nav('/character/' + pool[Math.floor(Math.random() * pool.length)].id);
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>发现广场</h1>
          <div className="sub">挑选一个角色，开启属于你的沉浸故事</div>
        </div>
        <button className="btn ghost" onClick={lucky} title="随机漫游一个角色"><Shuffle size={16} /> 手气不错</button>
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

        {tasks.length > 0 && (
          <div className="daily-strip">
            <div className="ds-head"><ListChecks size={15} /> <b>每日任务</b><button className="ds-more" onClick={() => nav('/events')}>全部活动 →</button></div>
            <div className="ds-track">
              {tasks.map(t => (
                <button key={t.id} className={'ds-task' + (t.claimed ? ' claimed' : t.done ? ' done' : '')} onClick={() => claimTask(t)}
                  title={t.claimed ? '已领取' : t.done ? '点击领取奖励' : '去完成'}>
                  <span className="ds-task-tx">{t.name}</span>
                  <span className="ds-task-meta">{t.claimed ? <><Check size={12} /> 已领</> : t.done ? <><CoinIcon size={12} /> 领 {t.reward}</> : <>{t.progress}/{t.target}</>}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {resume.length > 0 && (
          <div className="resume-rail">
            <div className="rr-head"><Clock size={15} /> <b>继续聊天</b></div>
            <div className="rr-track">
              {resume.map(cv => (
                <button key={cv.id} className="rr-item" onClick={() => nav('/chats/' + cv.id)} title={cv.character_name}>
                  <Avatar src={cv.character_avatar} name={cv.character_name} size={48} />
                  <span>{cv.character_name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {featured.length > 0 && <Spotlight items={featured} onView={view} onChat={chat} />}

        {recommended.length > 0 && (
          <>
            <div className="section-title"><h2><Sparkles size={16} style={{ verticalAlign: -3, color: 'var(--accent)' }} /> 为你推荐</h2></div>
            <div className="rail" style={{ marginBottom: 26 }}>
              {recommended.map(c => <Poster key={c.id} c={c} onView={view} onFav={fav} onChat={chat} />)}
            </div>
          </>
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
                  <div className="cover">{s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <div className="ph"><ScrollText size={34} /></div>}
                    <div className="pill-pub">{s.price_gold > 0 ? <><CoinIcon size={12} /> {s.price_gold}</> : '免费'}</div></div>
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
