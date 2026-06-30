// 「今日」— the app-only launcher home. A game-home style dashboard that exists
// ONLY in the native/app shell (see AppLayout). It deliberately does NOT reuse
// the web discover page: instead it greets the user, surfaces the daily check-in,
// a "continue your story" rail, daily tasks and a personalised pick — the things
// you reach for when you open the app, not a browse-everything grid.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import {
  Check, Flame, MessagesSquare, ChevronRight, Sparkles, Wand2, Feather,
  Drama, PartyPopper, Dices, Gift, Crown, Star, Compass
} from 'lucide-react';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

const CREATE_SHORTCUTS = [
  { to: '/character/new', ic: Sparkles, label: '建角色' },
  { to: '/atelier', ic: Feather, label: '写小说' },
  { to: '/draw', ic: Wand2, label: 'AI 绘图' },
  { to: '/theater', ic: Drama, label: '开剧场' },
  { to: '/gacha', ic: Dices, label: '扭蛋' },
  { to: '/events', ic: PartyPopper, label: '活动' }
];

const today = () => new Date().toISOString().slice(0, 10);

export default function AppHome() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [resume, setResume] = useState(null);
  const [hero, setHero] = useState(null);
  const [tasks, setTasks] = useState([]);
  // Derived from the real account state (same source Wallet.jsx uses), not guessed
  // from a catch block — so a page revisit same-day correctly shows "已签到" up front.
  const [checked, setChecked] = useState(() => user?.last_checkin === today());
  const [streak, setStreak] = useState(() => user?.checkin_streak || 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setChecked(user?.last_checkin === today()); setStreak(user?.checkin_streak || 0); }, [user?.last_checkin, user?.checkin_streak]);

  useEffect(() => {
    api('/chat/conversations').then(d => setResume((d.conversations || []).slice(0, 10))).catch(() => setResume([]));
    // 今日 is the personal hub; broad "browse" lives entirely in the 发现 feed now.
    // Here we keep just ONE editorial highlight (今日精选 hero) — a single daily
    // pick, not a browse grid — so the surface still feels alive without
    // duplicating 发现's job.
    api('/characters/public?sort=hot').then(d => {
      const hot = d.characters || [];
      setHero(hot.find(c => c.featured) || hot[0] || false);
    }).catch(() => setHero(false));
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTasks = () => api('/engage/tasks').then(d => setTasks((d.tasks || []).filter(t => !t.claimed).slice(0, 3))).catch(() => {});

  const claimTask = async (t) => {
    if (!t.done || t.claimed) return;
    try {
      await api(`/engage/tasks/${t.id}/claim`, { method: 'POST' });
      toast(`领取成功！+${t.reward} 金币`);
      await refreshUser();
      loadTasks();
    } catch (e) { toast(e?.message || '领取失败'); }
  };

  const checkin = async () => {
    if (busy || checked) return;
    setBusy(true);
    try {
      const d = await api('/economy/checkin', { method: 'POST' });
      // Refresh the shared auth/user object (not just local state) so the gold
      // figure updates everywhere it's shown — header pill, wallet page, etc. —
      // without waiting for a full reload.
      await refreshUser();
      setChecked(true); setStreak(d.streak || 0);
      toast(`签到成功 · +${d.reward} 金币 · 连续 ${d.streak} 天`);
    } catch (e) {
      // Genuinely already checked in today → settle into the done state.
      // Anything else (network blip, server error) must NOT be silently
      // treated as success, or the user loses the reward with no error shown.
      if (/已经?签到/.test(e?.message || '')) setChecked(true);
      else toast(e?.message || '签到失败，请重试');
    } finally { setBusy(false); }
  };

  const openChat = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch { nav('/character/' + c.id); }
  };

  return (
    <div className="apphome">
      {/* greeting band */}
      <header className="ah-hero">
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
          <button className="ah-coin" onClick={() => nav('/wallet')}><CoinIcon size={15} /> {user?.gold ?? 0}</button>
          <button className="ah-coin di" onClick={() => nav('/wallet')}><DiamondIcon size={15} /> {user?.diamond ?? 0}</button>
          <button className={'ah-checkin' + (checked ? ' done' : '')} onClick={checkin} disabled={busy}>
            {checked
              ? <><Check size={15} /> {streak ? `连签 ${streak} 天` : '已签到'}</>
              : <><Gift size={15} /> 签到领币</>}
          </button>
        </div>
      </header>

      {/* quick create shortcuts */}
      <div className="ah-shortcuts">
        {CREATE_SHORTCUTS.map(s => (
          <button key={s.to} className="ah-sc" onClick={() => nav(s.to)}>
            <span className="ah-sc-ic"><s.ic size={20} /></span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* daily featured hero */}
      {hero === null && <div className="ah-hero-skel" />}
      {hero && (
        <button className="ah-hero-card" onClick={() => openChat(hero)}>
          {hero.avatar ? <img className="ah-hc-bg" src={hero.avatar} alt="" /> : <div className="ah-hc-bg ph" />}
          <div className="ah-hc-scrim" />
          <div className="ah-hc-body">
            <span className="ah-hc-tag"><Star size={11} fill="currentColor" /> 今日精选</span>
            <b>{hero.name}</b>
            <p>{hero.tagline || hero.intro || '一个等待被开启的故事'}</p>
            <span className="ah-hc-cta"><MessagesSquare size={14} /> 开始对话</span>
          </div>
        </button>
      )}

      {/* continue your story */}
      {resume === null ? (
        <div className="ah-rail-skel" />
      ) : resume.length > 0 ? (
        <section className="ah-sec">
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

      {/* daily tasks */}
      {tasks.length > 0 && (
        <section className="ah-sec">
          <div className="ah-sec-head"><h2><Flame size={16} /> 今日任务</h2></div>
          <div className="ah-tasks">
            {tasks.map(t => (
              <button key={t.id} className={'ah-task' + (t.done ? ' done' : '')} onClick={() => claimTask(t)} disabled={!t.done}>
                <div className="ah-task-tx">
                  <b>{t.name}</b>
                  <span>{t.done ? <><Check size={12} /> 领 {t.reward}</> : `${t.progress}/${t.target}`}</span>
                </div>
                <div className="ah-task-bar"><i style={{ width: Math.min(100, Math.round((t.progress || 0) / (t.target || 1) * 100)) + '%' }} /></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 浏览发现入口 —— 不在今日页重复角色网格，引导到沉浸式发现页 */}
      <button className="ah-discover-cta" onClick={() => nav('/')}>
        <Compass size={20} />
        <div><b>去发现更多角色</b><span>沉浸式信息流，上滑挑你心动的那一个</span></div>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
