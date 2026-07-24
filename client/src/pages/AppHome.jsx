// 「今日」— the app-only launcher home. A game-home style dashboard that exists
// ONLY in the native/app shell (see AppLayout). It deliberately does NOT reuse
// the web discover page: instead it greets the user, surfaces the daily check-in,
// a "continue your story" rail, daily tasks and a personalised pick — the things
// you reach for when you open the app, not a browse-everything grid.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNav } from '../nav.js';
import { haptic } from '../haptics.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import { cnToday, fmtNum } from '../util.js';
import { CoverArt } from '../art.jsx';
import {
  Check, Flame, MessagesSquare, ChevronRight, Sparkles,
  Drama, PartyPopper, Dices, Gift, Crown, Star, Compass, Search, Bell,
  ScrollText, Users, Trophy, Clock, Tag, X, Plus, RotateCcw, GripVertical, Wallet
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

// 问候卡天色：随真实时段切换渐变（晨曦 / 白昼 / 暮色 / 夜晚）。
function skyClass() {
  const h = new Date().getHours();
  if (h < 5 || h >= 20) return 'sky-night';
  if (h < 11) return 'sky-morning';
  if (h < 17) return '';        // 白昼用默认暖阳渐变
  return 'sky-dusk';
}

// —— 包 D4：磁贴自定义 ——
// 磁贴目录：default=true 的为默认显示项，其余可选添加。用户排序 + 隐藏态持久化到
// localStorage `huanyu_app_tiles`，结构 [{to, hidden}]，按数组顺序即显示顺序。
// 缺省（无存储 / 解析失败）→ 目录默认态。新增目录项时，已存用户自动获得该项（默认不隐藏）。
const TILE_CATALOG = [
  { to: '/gacha', ic: Dices, label: '扭蛋', default: true },
  { to: '/events', ic: PartyPopper, label: '活动', default: true },
  { to: '/scripts', ic: ScrollText, label: '剧本', default: true },
  { to: '/theater', ic: Drama, label: '剧场', default: true },
  { to: '/community', ic: Users, label: '社区', default: true },
  { to: '/leaderboard', ic: Trophy, label: '排行榜', default: true },
  { to: '/tags', ic: Tag, label: '标签', default: false },
  { to: '/friends', ic: Users, label: '好友', default: false },
  { to: '/wallet', ic: Wallet, label: '钱包', default: false },
];
const TILES_KEY = 'huanyu_app_tiles';

function loadTiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(TILES_KEY) || '[]');
    if (Array.isArray(saved) && saved.length) {
      const order = new Map(saved.map((s, i) => [s.to, { hidden: !!s.hidden, order: i }]));
      // 已存项按 order 排序；目录里新增的项追加到末尾（默认显示）。
      const known = TILE_CATALOG
        .filter(t => order.has(t.to))
        .sort((a, b) => order.get(a.to).order - order.get(b.to).order)
        .map(t => ({ ...t, hidden: order.get(t.to).hidden }));
      const fresh = TILE_CATALOG.filter(t => !order.has(t.to)).map(t => ({ ...t, hidden: false }));
      return [...known, ...fresh];
    }
  } catch { /* */ }
  return TILE_CATALOG.map(t => ({ ...t, hidden: !t.default && false }));
}
function saveTiles(tiles) {
  try { localStorage.setItem(TILES_KEY, JSON.stringify(tiles.map(t => ({ to: t.to, hidden: t.hidden })))); } catch { /* */ }
}
function resetTiles() {
  try { localStorage.removeItem(TILES_KEY); } catch { /* */ }
  return TILE_CATALOG.map(t => ({ ...t, hidden: !t.default }));
}

// —— 包 D1：最近浏览数据源 ——
// 复用 CharacterView.jsx 的 recordRecent 写入的 `recent_chars`（与 web 共享存储，
// 因为「最近看过哪些角色」是用户行为而非平台特征）。AppHome 只读取、不写入。
const RECENT_KEY = 'recent_chars';
function loadRecent() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(arr)) return arr.filter(x => x && x.id && x.name).slice(0, 10);
  } catch { /* */ }
  return [];
}

export default function AppHome() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const nav = useNav();
  const [resume, setResume] = useState(null);
  const [pick, setPick] = useState(null);
  const [hero, setHero] = useState(null);
  const [tasks, setTasks] = useState([]);
  // 用 /auth/me 带回的 last_checkin 初始化，已签到就直接呈现「已签到」态，
  // 而不是等到用户点了按钮吃 400 才知道。
  const [checked, setChecked] = useState(() => !!user?.last_checkin && user.last_checkin === cnToday());
  const [streak, setStreak] = useState(user?.checkin_streak || 0);
  const [busy, setBusy] = useState(false);
  // 顶栏已随 app 壳移除，通知铃移到页面自己的顶部行；SSE 秒级刷角标。
  const [unread, setUnread] = useState(0);
  useEffect(() => { api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {}); }, []);
  useRealtimeEvent('notification', () => setUnread(u => u + 1));

  // —— 包 D1/D2/D3 数据源 ——
  const [recent, setRecent] = useState(() => loadRecent());
  const [tags, setTags] = useState(null);    // null=loading, []=empty
  const [creators, setCreators] = useState(null);
  useEffect(() => {
    // 标签：复用 /meta/tags（Tags 页同源），取前 12 个按热度。
    api('/meta/tags').then(d => setTags((d.tags || []).slice(0, 12))).catch(() => setTags([]));
    // 活跃创作者：复用 /social/suggested（Community 页同源），取前 5 个。
    api('/social/suggested').then(d => setCreators((d.users || []).slice(0, 5))).catch(() => setCreators([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 路由切回今日 tab 时重新读 recent（用户可能在 CharacterView 浏览过新角色）。
  useEffect(() => {
    const onFocus = () => setRecent(loadRecent());
    window.addEventListener('huanyu-today-focus', onFocus);
    return () => window.removeEventListener('huanyu-today-focus', onFocus);
  }, []);

  useEffect(() => {
    api('/chat/conversations').then(d => setResume((d.conversations || []).slice(0, 10))).catch(() => setResume([]));
    // One hot fetch feeds both the featured hero and the picks fallback; the
    // personalised "recommended" set takes precedence for picks when present.
    // (null = loading → skeleton; false/[] = loaded-empty → hidden.)
    api('/characters/public?sort=hot').then(d => {
      const hot = d.characters || [];
      const top = hot.find(c => c.featured) || hot[0] || null;
      setHero(top || false);
      setPick(p => (p && p.length) ? p : hot.filter(c => !top || c.id !== top.id).slice(0, 6));
    }).catch(() => { setHero(false); setPick(p => p || []); });
    api('/characters/recommended')
      .then(d => { const cs = d.characters || []; if (cs.length) setPick(cs.slice(0, 6)); })
      .catch(() => {});
    api('/engage/tasks').then(d => setTasks((d.tasks || []).filter(t => !t.claimed).slice(0, 3))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkin = async () => {
    if (busy || checked) return;
    setBusy(true);
    try {
      const d = await api('/economy/checkin', { method: 'POST' });
      setChecked(true); setStreak(d.streak || 0);
      toast(`签到成功 · +${d.reward} 金币 · 连续 ${d.streak} 天`);
      haptic.success(); // 签到成功 —— 肯定触觉
      refreshUser?.(); // 顶部金币余额立即更新，不留旧值
    } catch (e) {
      // already signed in today (or no endpoint) — mark done so the CTA settles
      setChecked(true);
      toast(e?.message || '今天已签到');
    } finally { setBusy(false); }
  };

  const openChat = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch { nav('/character/' + c.id); }
  };

  return (
    <div className="apphome">
      {/* 页首行：品牌 × 搜索 / 通知（壳层无持久顶栏，一级页自带头部） */}
      <div className="aht">
        <b className="aht-brand">幻域</b>
        <div className="aht-acts">
          <button onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
          <button onClick={() => nav('/notifications')} aria-label="通知" className="aht-bell">
            <Bell size={20} />
            {unread > 0 && <span className="aht-nb">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </div>
      </div>

      {/* greeting band — 天色渐变问候卡 */}
      <header className={'ah-hero ' + skyClass()}>
        <span className="ah-celestial" aria-hidden="true" />
        <div className="ah-hero-row">
          <div>
            <div className="ah-greet">{greeting()}，</div>
            <h1 className="ah-name">{user?.display_name || user?.username || '旅人'}</h1>
          </div>
          <button className="ah-avatar" onClick={() => nav('/profile')} aria-label="我的">
            <Avatar src={user?.avatar} name={user?.display_name} size={46} />
            {user?.svip ? <span className="ah-tier svip">SVIP</span> : user?.vip ? <span className="ah-tier vip"><Crown size={11} /></span> : null}
          </button>
        </div>
        <div className="ah-wallet">
          <button className="ah-coin" onClick={() => nav('/wallet')}><CoinIcon size={15} /> {fmtNum(user?.gold)}</button>
          <button className="ah-coin di" onClick={() => nav('/wallet')}><DiamondIcon size={15} /> {fmtNum(user?.diamond)}</button>
          <button className={'ah-checkin' + (checked ? ' done' : '')} onClick={checkin} disabled={busy}>
            {checked
              ? <><Check size={15} /> {streak ? `连签 ${streak} 天` : '已签到'}</>
              : <><Gift size={15} /> 签到领币</>}
          </button>
        </div>
      </header>

      {/* quick create shortcuts — 包 D4：可长按自定义 */}
      <AhShortcuts onNavigate={(to) => { haptic.tap(); nav(to); }} />

      {/* daily featured hero */}
      {hero === null && <div className="ah-hero-skel" />}
      {hero && (
        <button className="ah-hero-card" onClick={() => openChat(hero)}>
          {hero.avatar ? <img className="ah-hc-bg" src={assetUrl(hero.avatar)} alt="" /> : <div className="ah-hc-bg cover-art-box"><CoverArt name={hero.name} /></div>}
          <div className="ah-hc-scrim" />
          <div className="ah-hc-body">
            <span className="ah-hc-tag"><Star size={11} fill="currentColor" /> 今日精选</span>
            <b>{hero.name}</b>
            <p>{hero.tagline || hero.intro || '一个等待被开启的故事'}</p>
            <span className="ah-hc-cta"><MessagesSquare size={14} /> 开始对话</span>
          </div>
        </button>
      )}

      {/* 包 D1：最近浏览 rail —— 用户在 CharacterView 看过的角色 */}
      {recent.length > 0 && (
        <AhRecent items={recent} onOpen={(c) => { haptic.tap(); nav('/character/' + c.id); }} />
      )}

      {/* continue your story */}
      {resume === null ? (
        <div className="ah-rail-skel" />
      ) : resume.length > 0 ? (
        <section className="ah-sec ah-resume-sec">
          <div className="ah-sec-head"><h2><MessagesSquare size={16} /> 继续你的故事</h2>
            <button className="ah-more" onClick={() => nav('/chats')}>全部 <ChevronRight size={14} /></button>
          </div>
          <div className="ah-rail">
            {resume.map(cv => (
              <button key={cv.id} className="ah-resume" onClick={() => nav('/chats/' + cv.id)}>
                <Avatar src={cv.character_avatar} name={cv.character_name} size={56} />
                <b>{cv.character_name}</b>
                {cv.affinity ? <span className="ah-aff"><Flame size={11} /> {cv.affinity}</span> : <span className="ah-aff dim">未开始</span>}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <button className="ah-empty" onClick={() => nav('/')}>
          <Compass size={22} />
          <div><b>还没有开始任何故事</b><span>去发现广场，挑一个角色聊聊吧</span></div>
          <ChevronRight size={18} />
        </button>
      )}

      {/* 包 D2：热门标签 chip 横滑 */}
      {tags && tags.length > 0 && (
        <AhTags items={tags} onPick={(t) => { haptic.tap(); nav('/search?q=' + encodeURIComponent(t) + '&tab=character'); }} />
      )}

      {/* daily tasks */}
      {tasks.length > 0 && (
        <section className="ah-sec ah-tasks-sec">
          <div className="ah-sec-head"><h2><Flame size={16} /> 今日任务</h2></div>
          <div className="ah-tasks">
            {tasks.map(t => (
              <div key={t.id} className="ah-task" role="button" tabIndex={0} onClick={() => nav('/events')}
                onKeyDown={e => e.key === 'Enter' && nav('/events')}>
                <div className="ah-task-tx"><b>{t.name}</b><span>{t.done ? '可领取 · ' : ''}+{t.reward} 金币</span></div>
                <div className="ah-task-bar"><i style={{ width: Math.min(100, Math.round((t.progress || 0) / (t.target || 1) * 100)) + '%' }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 包 D3：活跃创作者 —— 「好友在玩」社交段的务实落地 */}
      {creators && creators.length > 0 && (
        <AhCreators items={creators} onOpen={(u) => { haptic.tap(); nav('/user/' + u.id); }} />
      )}

      {/* personalised pick */}
      {pick === null && (
        <section className="ah-sec ah-picks-sec">
          <div className="ah-sec-head"><h2><Sparkles size={16} /> 为你挑选</h2></div>
          <div className="ah-picks">{[0, 1].map(i => <div key={i} className="ah-pick-skel" />)}</div>
        </section>
      )}
      {pick && pick.length > 0 && (
        <section className="ah-sec ah-picks-sec">
          <div className="ah-sec-head"><h2><Sparkles size={16} /> 为你挑选</h2>
            <button className="ah-more" onClick={() => nav('/')}>逛广场 <ChevronRight size={14} /></button>
          </div>
          <div className="ah-picks">
            {pick.map(c => (
              <button key={c.id} className="ah-pick" onClick={() => openChat(c)}>
                <div className="ah-pick-av">
                  {c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ah-pick-ph cover-art-box"><CoverArt name={c.name} /></div>}
                </div>
                <div className="ah-pick-tx">
                  <b>{c.name}</b>
                  <span>{c.tagline || c.intro || '一个等待开启的故事'}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ============================================================
   包 D1：最近浏览 rail —— 头像横滑，点击继续看角色
   ============================================================ */
function AhRecent({ items, onOpen }) {
  return (
    <section className="ah-sec ah-recent-sec">
      <div className="ah-sec-head">
        <h2><Clock size={16} /> 最近浏览</h2>
        <span className="ah-sec-hint">{items.length} 个角色</span>
      </div>
      <div className="ah-rail ah-recent-rail">
        {items.map(c => (
          <button key={c.id} className="ah-recent" onClick={() => onOpen(c)}>
            <div className="ah-recent-av">
              {c.avatar
                ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" />
                : <div className="ah-pick-ph cover-art-box"><CoverArt name={c.name} /></div>}
            </div>
            <b>{c.name}</b>
            {c.category ? <span className="ah-recent-cat">{c.category}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   包 D2：热门标签 chip 横滑 —— 按热度字号，点击进搜索
   ============================================================ */
function AhTags({ items, onPick }) {
  const max = items.length ? Math.max(1, items[0].count) : 1;
  return (
    <section className="ah-sec ah-tags-sec">
      <div className="ah-sec-head">
        <h2><Tag size={16} /> 热门标签</h2>
        <button className="ah-more" onClick={() => onPick && onPick(null)}>全部 <ChevronRight size={14} /></button>
      </div>
      <div className="ah-tags-rail">
        {items.map(t => (
          <button key={t.name} className="ah-tag-chip" onClick={() => onPick(t.name)}>
            <span className="ah-tag-name">#{t.name}</span>
            <span className="ah-tag-count">{fmtNum(t.count)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   包 D3：活跃创作者 —— 好友在玩的社交段（务实版）
   复用 /social/suggested 数据，按粉丝数/角色数排序，展示头像+名字+作品数。
   点击进用户主页。社交属性：让用户发现"还有谁在创作"。
   ============================================================ */
function AhCreators({ items, onOpen }) {
  return (
    <section className="ah-sec ah-creators-sec">
      <div className="ah-sec-head">
        <h2><Users size={16} /> 活跃创作者</h2>
        <button className="ah-more" onClick={() => onOpen && onOpen({ id: 0 })}>逛社区 <ChevronRight size={14} /></button>
      </div>
      <div className="ah-rail ah-creators-rail">
        {items.map(u => (
          <button key={u.id} className="ah-creator" onClick={() => onOpen(u)}>
            <Avatar src={u.avatar} name={u.display_name} size={56} />
            <b>{u.display_name}</b>
            <span className="ah-creator-meta">
              {u.chars > 0 ? `${u.chars} 角色` : '暂无作品'}
              {u.followers > 0 ? ` · ${fmtNum(u.followers)} 粉丝` : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   包 D4：磁贴自定义 —— 长按进入编辑态（抖动 + ✕ 删除 + 添加 + 拖拽排序 + 重置）
   - 默认态：与原 ah-shortcuts 视觉/行为一致，仅多一个 onLongPress 入口。
   - 编辑态：磁贴抖动（@keyframes tileWiggle），右上角 ✕ 隐藏；底部展开「添加磁贴」抽屉。
   - 排序：HTML5 Drag API（桌面 + 现代移动浏览器原生支持 draggable）。
   - 持久化：localStorage huanyu_app_tiles [{to, hidden}]。
   ============================================================ */
function AhShortcuts({ onNavigate }) {
  const toast = useToast();
  const [tiles, setTiles] = useState(() => loadTiles());
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const longPressTimer = useRef(null);
  const longPressStart = useRef(null);
  const firedRef = useRef(false);

  const visible = useMemo(() => tiles.filter(t => !t.hidden), [tiles]);
  const hidden = useMemo(() => tiles.filter(t => t.hidden), [tiles]);

  // 持久化
  const commit = (next) => { setTiles(next); saveTiles(next); };

  const enterEdit = () => {
    if (editing) return;
    firedRef.current = true;
    haptic.bump();
    setEditing(true);
  };
  // 长按检测：触屏 / 鼠标都支持。500ms 未移动超 10px → 进入编辑态。
  const onTilePointerDown = (e) => {
    if (editing) return;
    const t = e.touches ? e.touches[0] : e;
    longPressStart.current = { x: t.clientX, y: t.clientY };
    firedRef.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      if (!firedRef.current) enterEdit();
    }, 500);
  };
  const onTilePointerMove = (e) => {
    if (!longPressStart.current) return;
    const t = e.touches ? e.touches[0] : e;
    if (Math.abs(t.clientX - longPressStart.current.x) > 10 ||
        Math.abs(t.clientY - longPressStart.current.y) > 10) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    }
  };
  const onTilePointerUp = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    longPressStart.current = null;
  };
  useEffect(() => () => onTilePointerUp(), []);

  const hideTile = (to) => {
    haptic.warn();
    commit(tiles.map(t => t.to === to ? { ...t, hidden: true } : t));
  };
  const showTile = (to) => {
    haptic.tap();
    commit(tiles.map(t => t.to === to ? { ...t, hidden: false } : t));
    setAddOpen(false);
  };
  const doReset = () => {
    haptic.confirm();
    setTiles(resetTiles());
    toast('已恢复默认磁贴');
    setAddOpen(false);
  };
  const exitEdit = () => {
    haptic.success();
    setEditing(false);
    setAddOpen(false);
  };

  // —— HTML5 拖拽排序 ——
  const onDragStart = (i) => (e) => {
    if (!editing) return;
    setDragIdx(i);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch { /* */ }
  };
  const onDragOver = (e) => { if (!editing || dragIdx == null) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { /* */ } };
  const onDrop = (i) => (e) => {
    if (!editing || dragIdx == null) return;
    e.preventDefault();
    if (dragIdx === i) { setDragIdx(null); return; }
    const next = [...tiles];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    haptic.select();
    commit(next);
    setDragIdx(null);
  };
  const onDragEnd = () => setDragIdx(null);

  return (
    <div className={'ah-shortcuts-wrap' + (editing ? ' editing' : '')}>
      {editing && (
        <div className="ah-sc-toolbar">
          <span className="ah-sc-tip">长按磁贴可拖动排序，点 ✕ 隐藏</span>
          <div className="ah-sc-btns">
            <button className="ah-sc-tool" onClick={doReset}><RotateCcw size={13} /> 重置</button>
            <button className="ah-sc-tool primary" onClick={exitEdit}><Check size={13} /> 完成</button>
          </div>
        </div>
      )}
      <div className="ah-shortcuts">
        {visible.map((t, i) => {
          const tileIdx = tiles.findIndex(x => x.to === t.to);
          return (
            <div key={t.to}
              className={'ah-tile' + (editing ? ' editing' : '') + (dragIdx === tileIdx ? ' dragging' : '')}
              style={editing ? { '--i': i } : undefined}
              draggable={editing}
              onDragStart={onDragStart(tileIdx)}
              onDragOver={onDragOver}
              onDrop={onDrop(tileIdx)}
              onDragEnd={onDragEnd}
            >
              <button className="ah-sc"
                onTouchStart={onTilePointerDown}
                onTouchMove={onTilePointerMove}
                onTouchEnd={onTilePointerUp}
                onMouseDown={onTilePointerDown}
                onMouseMove={onTilePointerMove}
                onMouseUp={onTilePointerUp}
                onMouseLeave={onTilePointerUp}
                onClick={(e) => {
                  if (firedRef.current) { e.preventDefault(); return; }
                  if (editing) return;
                  onNavigate(t.to);
                }}
                onContextMenu={(e) => { if (!editing) { e.preventDefault(); enterEdit(); } }}
              >
                <span className="ah-sc-ic"><t.ic size={20} /></span>
                <span>{t.label}</span>
              </button>
              {editing && (
                <>
                  <button className="ah-tile-x" onClick={(e) => { e.stopPropagation(); hideTile(t.to); }} aria-label="隐藏">
                    <X size={11} />
                  </button>
                  <span className="ah-tile-grip" aria-hidden="true"><GripVertical size={12} /></span>
                </>
              )}
            </div>
          );
        })}
        {editing && (
          <button className="ah-tile ah-tile-add" onClick={() => { haptic.tap(); setAddOpen(v => !v); }}>
            <span className="ah-sc-ic"><Plus size={20} /></span>
            <span>添加</span>
          </button>
        )}
      </div>

      {editing && addOpen && hidden.length > 0 && (
        <div className="ah-tile-addtray">
          <div className="ah-tile-addtray-head">已隐藏的磁贴</div>
          <div className="ah-tile-addtray-list">
            {hidden.map(t => (
              <button key={t.to} className="ah-tile-chip" onClick={() => showTile(t.to)}>
                <t.ic size={14} /> {t.label} <Plus size={11} />
              </button>
            ))}
          </div>
        </div>
      )}
      {editing && hidden.length === 0 && addOpen && (
        <div className="ah-tile-addtray-empty">所有磁贴都已显示</div>
      )}
    </div>
  );
}
