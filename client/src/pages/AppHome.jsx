// 「今日」— the app-only launcher home. A game-home style dashboard that exists
// ONLY in the native/app shell (see AppLayout). It deliberately does NOT reuse
// the web discover page: instead it greets the user, surfaces the daily check-in,
// a "continue your story" rail, daily tasks and a personalised pick — the things
// you reach for when you open the app, not a browse-everything grid.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNav } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import { cnToday, fmtNum } from '../util.js';
import { CoverArt, QuietAquaCharacterArt, resolveCharacterMedia } from '../art.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import CheckinCalendarSheet from '../components/CheckinCalendarSheet.jsx';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import { isAppMode } from '../appmode.js';
import { useAppTabActive } from '../appTabActivity.js';
import { burst } from '../fx.js';
import { tick } from '../appgestures.js';
import {
  Check, Flame, MessagesSquare, ChevronRight, ThumbsUp,
  Drama, PartyPopper, Dices, Gift, Crown, Star, Compass, Search, Bell,
  ScrollText, Users, Trophy, CalendarCheck, Sparkles
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

// Keep the existing time-of-day hook as a subtle surface variant. The final
// Quiet Aqua treatment is owned by the App-only CSS rather than baked artwork.
function skyClass() {
  const h = new Date().getHours();
  if (h < 5 || h >= 20) return 'sky-night';
  if (h < 11) return 'sky-morning';
  if (h < 17) return '';        // 白昼用默认暖阳渐变
  return 'sky-dusk';
}

// 快捷入口 —— 去重：创建类（建角色/写小说/AI绘图/开剧场）已由底栏中央 +AI 按钮
// 全量承载，这里不再重复；改放启动页顺手要去、且别处没有一键入口的目的地。
const CREATE_SHORTCUTS = [
  { to: '/gacha', ic: Dices, label: '扭蛋', tone: 'reward' },
  { to: '/events', ic: PartyPopper, label: '活动', tone: 'coral' },
  { to: '/scripts', ic: ScrollText, label: '剧本', tone: 'graphite' },
  { to: '/theater', ic: Drama, label: '剧场', tone: 'indigo' },
  { to: '/community', ic: Users, label: '社区', tone: 'blue' },
  { to: '/leaderboard', ic: Trophy, label: '排行榜', tone: 'reward' }
];

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
  const [calOpen, setCalOpen] = useState(false);
  const [milestone, setMilestone] = useState(0);
  const [streakShare, setStreakShare] = useState(false);
  const [claiming, setClaiming] = useState('');
  const [weekly, setWeekly] = useState(null);
  const streakRef = useRef(null);
  const checkinBtnRef = useRef(null);
  // 顶栏已随 app 壳移除，通知铃移到页面自己的顶部行；SSE 秒级刷角标。
  const [unread, setUnread] = useState(0);
  const displayName = user?.display_name || user?.username || '旅人';
  const notificationLabel = unread > 0 ? `通知，${unread} 条未读` : '通知';
  const loadUnread = useCallback(() => api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {}), []);
  useEffect(() => { loadUnread(); }, [loadUnread]);
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener('huanyu-noti-read', clear);
    return () => window.removeEventListener('huanyu-noti-read', clear);
  }, []);
  useRealtimeEvent('notification', () => setUnread(u => u + 1));

  useEffect(() => {
    setChecked(Boolean(user?.last_checkin && user.last_checkin === cnToday()));
    setStreak(user?.checkin_streak || 0);
  }, [user?.last_checkin, user?.checkin_streak]);

  const loadHome = useCallback(() => {
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
    // 本周回顾（周报卡）：静默失败即隐藏，不给首页添失败态。
    api('/me/weekly').then(d => setWeekly(d && Array.isArray(d.days) ? d : null)).catch(() => setWeekly(null));
  }, []);
  useEffect(() => { loadHome(); }, [loadHome]);
  useAppTabActive('/today', () => {
    loadHome();
    loadUnread();
    refreshUser?.();
  });

  const checkin = async () => {
    if (busy || checked) return;
    setBusy(true);
    try {
      const d = await api('/economy/checkin', { method: 'POST' });
      setChecked(true); setStreak(d.streak || 0);
      toast(`签到成功 · +${d.reward} 金币 · 连续 ${d.streak} 天`);
      // 仪式感：一次性粒子 + 触感（burst 自带 reduced-motion 降级为无）
      tick(12);
      const rect = checkinBtnRef.current?.getBoundingClientRect?.();
      if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2);
      refreshUser?.(); // 顶部金币余额立即更新，不留旧值
      // 「完成每日签到」任务随签到即时转可领，行内领取钮同步出现
      api('/engage/tasks').then(x => setTasks((x.tasks || []).filter(k => !k.claimed).slice(0, 3))).catch(() => {});
      // 连签里程碑（7 的倍数或 30/100）：亮一次性纪念卡横幅
      const s2 = d.streak || 0;
      if (s2 >= 7 && (s2 % 7 === 0 || s2 === 30 || s2 === 100)) setMilestone(s2);
    } catch (e) {
      // Only the server's explicit idempotent verdict may settle the CTA as
      // complete. Offline, timeout and 5xx failures keep it retryable.
      if (e?.code === 'ALREADY_CHECKED_IN') {
        setChecked(true);
        toast('今天已签到');
      } else {
        toast(e?.message || '签到失败，请稍后重试', 'err');
      }
    } finally { setBusy(false); }
  };

  const claimTask = async (t) => {
    if (claiming) return;
    setClaiming(t.id);
    try {
      const d = await api(`/engage/tasks/${t.id}/claim`, { method: 'POST' });
      tick(10);
      toast(`任务完成 · +${d.reward} 金币`);
      refreshUser?.();
      api('/engage/tasks').then(x => setTasks((x.tasks || []).filter(k => !k.claimed).slice(0, 3))).catch(() => {});
    } catch (e) { toast(e?.message || '领取失败，请稍后重试', 'err'); }
    finally { setClaiming(''); }
  };

  const openChat = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (error) { toast(error?.message || '暂时无法开始对话，请稍后重试', 'err'); }
  };

  return (
    <div
      className="apphome qa3-today"
      aria-busy={hero === null || resume === null || pick === null}
    >
      {/* Large-title App toolbar. It collapses optically as content scrolls;
          search and notifications stay on the control plane. */}
      <header className="aht" role="toolbar" aria-label="今日页工具">
        <div className="aht-copy">
          <span className="aht-eyebrow">{greeting()}，{displayName}</span>
          <h1 className="aht-brand" aria-label="幻域首页">幻域</h1>
        </div>
        <div className="aht-acts">
          <AppIconButton label="搜索" onClick={openCmdk}><Search size={20} /></AppIconButton>
          <AppIconButton label={notificationLabel} onClick={() => nav('/notifications', { state: { appBackTo: '/today' } })} className="aht-bell">
            <Bell size={20} />
            {unread > 0 && <span className="aht-nb">{unread > 99 ? '99+' : unread}</span>}
          </AppIconButton>
        </div>
      </header>

      {/* Identity is a compact continuous row, not another dashboard card. */}
      <section className={'ah-hero ' + skyClass()} aria-labelledby="today-member-title">
        <div className="ah-hero-row ah-member-row">
          <AppIconButton className="ah-avatar" label="我的" onClick={() => nav('/me')} aria-label="我的">
            <Avatar src={user?.avatar} name={displayName} size={46} />
            {user?.svip ? <span className="ah-tier svip">SVIP</span> : user?.vip ? <span className="ah-tier vip"><Crown size={11} /></span> : null}
          </AppIconButton>
          <div className="ah-member-copy">
            <h2 className="ah-name" id="today-member-title">{displayName}</h2>
            <span className="ah-presence"><i aria-hidden="true" /> 在线</span>
          </div>
          <div className="ah-wallet" aria-label="账户余额与签到">
            <AppButton
              className="ah-coin"
              variant="secondary"
              onClick={() => nav('/wallet')}
              aria-label={`金币 ${fmtNum(user?.gold)}`}
            >
              <CoinIcon size={15} /> <span className="ah-balance-value">{fmtNum(user?.gold)}</span>
            </AppButton>
            <AppButton
              className="ah-coin di"
              variant="secondary"
              onClick={() => nav('/wallet')}
              aria-label={`钻石 ${fmtNum(user?.diamond)}`}
            >
              <DiamondIcon size={15} /> <span className="ah-balance-value">{fmtNum(user?.diamond)}</span>
            </AppButton>
            <AppButton
              ref={checkinBtnRef}
              className={'ah-checkin' + (checked ? ' done' : '')}
              variant="primary"
              onClick={checkin}
              disabled={busy || checked}
              loading={busy}
              aria-label={checked ? (streak ? `已连续签到 ${streak} 天` : '今天已签到') : '签到领金币'}
            >
              {checked
                ? <><Check size={15} /> {streak ? `连签 ${streak} 天` : '已签到'}</>
                : <><Gift size={15} /> 签到</>}
            </AppButton>
          </div>
        </div>
        {/* S7 连签周视图：七粒周点 + 日历入口（点亮数 = (streak-1)%7+1） */}
        <button
          type="button"
          ref={streakRef}
          className="qa-streak"
          onClick={() => setCalOpen(true)}
          aria-label={`连续签到 ${streak} 天，查看签到日历`}
        >
          <span className="qa-streak-dots" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} className={'qa-streak-dot' + (streak > 0 && i < ((streak - 1) % 7) + 1 ? ' on' : '')} />
            ))}
          </span>
          <span className="qa-streak-copy">
            {streak > 0 ? `连签 ${streak} 天` : '开始你的连签'}
          </span>
          <span className="qa-streak-cal"><CalendarCheck size={14} aria-hidden="true" /> 日历</span>
        </button>
        {milestone > 0 && (
          <div className="qa-milestone" role="status">
            <span className="qa-milestone-copy">连签 {milestone} 天达成！</span>
            <AppButton variant="secondary" size="sm" onClick={() => setStreakShare(true)}>生成纪念卡</AppButton>
            <AppIconButton label="收起" onClick={() => setMilestone(0)}><Check size={14} /></AppIconButton>
          </div>
        )}
      </section>

      {/* Six stable destinations; creation remains the Dock accessory. */}
      <nav className="ah-shortcuts" aria-label="快捷入口">
        {CREATE_SHORTCUTS.map(s => (
          <AppButton key={s.to} className="ah-sc" data-tone={s.tone} variant="secondary" onClick={() => nav(s.to)}>
            <span className="ah-sc-ic"><s.ic size={20} /></span>
            <span>{s.label}</span>
          </AppButton>
        ))}
      </nav>

      {/* Editorial recommendation: the artwork stays dynamic business content. */}
      {hero === null && <div className="ah-hero-skel" role="status" aria-label="正在加载今日精选" />}
      {hero && (
        <article
          className="ah-hero-card"
        >
          <button type="button" className="ah-hero-open" onClick={() => nav('/character/' + hero.id)}
            aria-label={`查看今日精选角色：${hero.name}`}>
            <div className="ah-hc-media" aria-hidden="true" style={{ viewTransitionName: 'qa-character-art' }}>
              {resolveCharacterMedia(hero).src
                ? <img className="ah-hc-bg" src={assetUrl(resolveCharacterMedia(hero).src)} alt="" loading="eager" fetchPriority="high" />
                : <QuietAquaCharacterArt className="ah-hc-bg qa-oracle-character" />}
              <span className="ah-hc-scrim" />
            </div>
            <span className="ah-hc-body">
              <span className="ah-hc-tag"><Star size={11} fill="currentColor" /> 今日精选</span>
              <b className="ah-hc-name">{hero.name}</b>
              <span className="ah-hc-copy">{hero.tagline || hero.intro || '一个等待被开启的故事'}</span>
            </span>
          </button>
          <AppButton className="ah-hc-cta" variant="primary" onClick={() => openChat(hero)} aria-label={`与${hero.name}开始对话`}>
            <MessagesSquare size={14} /> 开始对话
          </AppButton>
        </article>
      )}

      {/* continue your story */}
      {resume === null ? (
        <div className="ah-rail-skel" role="status" aria-label="正在加载故事" />
      ) : resume.length > 0 ? (
        <section className="ah-sec ah-resume-section" aria-labelledby="today-resume-title">
          <div className="ah-sec-head"><h2 id="today-resume-title">继续你的故事</h2>
            <AppButton
              className="ah-more"
              variant="tertiary"
              size="sm"
              onClick={() => nav(isAppMode() ? '/messages' : '/chats')}
            >
              全部 <ChevronRight size={14} />
            </AppButton>
          </div>
          <div className="ah-rail" aria-label="最近对话">
            {resume.map(cv => (
              <button
                key={cv.id}
                type="button"
                className="ah-resume"
                onClick={() => nav('/chats/' + cv.id)}
                aria-label={`继续与${cv.character_name || '角色'}的故事${cv.affinity ? `，好感度 ${cv.affinity}` : ''}`}
              >
                <Avatar src={cv.character_avatar} name={cv.character_name} size={56} />
                <b>{cv.character_name}</b>
                {cv.affinity
                  ? <span className="ah-aff"><Flame size={11} aria-hidden="true" /> {cv.affinity}</span>
                  : <span className="ah-aff dim">未开始</span>}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <button type="button" className="ah-empty" onClick={() => nav('/')}>
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
              <div key={t.id} className={'ah-task' + (t.done && !t.claimed ? ' qa-task-claimable' : '')}>
                <button type="button" className="qa-task-main" onClick={() => nav('/events')} aria-label={`${t.name}，前往活动页`}>
                  <div className="ah-task-tx"><b>{t.name}</b><span>{t.done ? '可领取 · ' : ''}+{t.reward} 金币</span></div>
                  <div className="ah-task-bar"><i style={{ width: Math.min(100, Math.round((t.progress || 0) / (t.target || 1) * 100)) + '%' }} /></div>
                </button>
                {t.done && !t.claimed && (
                  <AppButton
                    className="qa-task-claim"
                    variant="primary"
                    size="sm"
                    loading={claiming === t.id}
                    disabled={Boolean(claiming)}
                    onClick={() => claimTask(t)}
                  >
                    领取
                  </AppButton>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* weekly recap —— 本周与你相伴（有故事才出现，静默失败即隐藏） */}
      {weekly && weekly.messages > 0 && (
        <section className="ah-sec qa-weekly" aria-labelledby="today-weekly-title">
          <div className="ah-sec-head">
            <h2 id="today-weekly-title"><Sparkles size={16} /> 本周与你相伴</h2>
            <AppButton className="ah-more" variant="tertiary" size="sm" onClick={() => nav('/insights')}>
              星轨 <ChevronRight size={14} />
            </AppButton>
          </div>
          <div className="qa-weekly-card">
            <div
              className="qa-weekly-bars"
              role="img"
              aria-label={`本周逐日消息：${weekly.days.map(d => `${d.date} ${d.n} 条`).join('，')}`}
            >
              {weekly.days.map((d, i) => {
                const max = Math.max(...weekly.days.map(x => x.n), 1);
                return (
                  <div key={d.date} className={'qa-weekly-bar' + (d.date === weekly.today.slice(5) ? ' today' : '')}>
                    <i style={{ height: (d.n ? Math.max(14, Math.round(d.n / max * 100)) : 5) + '%' }} />
                    <span aria-hidden="true">{'一二三四五六日'[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="qa-weekly-stats">
              <span><b>{fmtNum(weekly.messages)}</b> 条消息</span>
              <span><b>{weekly.active_days}</b> 天相伴</span>
              <span><b>{weekly.checkins}</b> 次签到</span>
              <span className="qa-weekly-gold"><b>+{fmtNum(weekly.gold_earned)}</b> 金币</span>
            </div>
            {weekly.companion && (
              <button
                type="button"
                className="qa-weekly-comp"
                onClick={() => nav('/character/' + weekly.companion.id)}
                aria-label={`本周最相伴：${weekly.companion.name}，${weekly.companion.n} 条消息，查看角色`}
              >
                <Avatar src={weekly.companion.avatar} name={weekly.companion.name} size={40} />
                <div className="qa-weekly-comp-tx"><span>本周最相伴</span><b>{weekly.companion.name}</b></div>
                <em>{fmtNum(weekly.companion.n)} 条</em>
              </button>
            )}
          </div>
        </section>
      )}

      {/* personalised pick */}
      {pick === null && (
        <section className="ah-sec">
          <div className="ah-sec-head"><h2><ThumbsUp size={16} /> 为你挑选</h2></div>
          <div className="ah-picks">{[0, 1].map(i => <div key={i} className="ah-pick-skel" aria-hidden="true" />)}</div>
        </section>
      )}
      {pick && pick.length > 0 && (
        <section className="ah-sec">
          <div className="ah-sec-head"><h2><ThumbsUp size={16} /> 为你挑选</h2>
            <AppButton className="ah-more" variant="tertiary" size="sm" onClick={() => nav('/')}>
              逛广场 <ChevronRight size={14} />
            </AppButton>
          </div>
          <div className="ah-picks">
            {pick.map(c => (
              <button key={c.id} type="button" className="ah-pick" onClick={() => openChat(c)} aria-label={`与${c.name}开始对话`}>
                <div className="ah-pick-av">
                  {resolveCharacterMedia(c).src ? <img src={assetUrl(resolveCharacterMedia(c).src)} alt="" loading="lazy" /> : <div className="ah-pick-ph"><QuietAquaCharacterArt alt="" loading="lazy" /></div>}
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
      {calOpen && <CheckinCalendarSheet onClose={() => setCalOpen(false)} returnFocusRef={streakRef} />}
      {streakShare && (
        <ShareCardSheet kind="streak" payload={{ streak: milestone || streak, date: cnToday(), path: '/today' }}
          onClose={() => setStreakShare(false)} />
      )}
    </div>
  );
}
