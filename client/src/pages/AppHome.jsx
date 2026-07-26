// 「今日」— the app-only launcher home. A game-home style dashboard that exists
// ONLY in the native/app shell (see AppLayout). It deliberately does NOT reuse
// the web discover page: instead it greets the user, surfaces the daily check-in,
// a "continue your story" rail, daily tasks and a personalised pick — the things
// you reach for when you open the app, not a browse-everything grid.
import React, { useCallback, useEffect, useState } from 'react';
import { useNav } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon } from '../ui.jsx';
import { fmtNum } from '../util.js';
import { CoverArt, QuietAquaCharacterArt, resolveCharacterMedia } from '../art.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { useAppTabActive } from '../appTabActivity.js';
// 数据层（问候/天光、签到闭环、续读轨/任务/精选加载）抽到 home/shared.js，
// 与 Web 端合体首页（WebHome.jsx）共用；本文件只保留 App 壳的渲染与交互。
import { greeting, skyClass, useCheckin, loadResumeRail, loadHeroAndPicks, loadTodayTasks } from './home/shared.js';
import {
  Check, Flame, MessagesSquare, ChevronRight, ThumbsUp,
  Drama, PartyPopper, Dices, Gift, Crown, Star, Compass, Search, Bell,
  ScrollText, Users, Trophy
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

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
  // 签到闭环在 home/shared.js 的 useCheckin 里（与 Web 首页共用）。契约不变：
  // 仅服务端幂等裁决 e?.code === 'ALREADY_CHECKED_IN' 会把 CTA 落定为已签；
  // 离线/超时/5xx 仍 toast「签到失败，请稍后重试」并保持可重试。
  const { checked, streak, busy, checkin } = useCheckin();
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

  const loadHome = useCallback(() => {
    loadResumeRail(setResume);
    loadHeroAndPicks(setHero, setPick);
    loadTodayTasks(setTasks);
  }, []);
  useEffect(() => { loadHome(); }, [loadHome]);
  useAppTabActive('/today', () => {
    loadHome();
    loadUnread();
    refreshUser?.();
  });

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
              <button key={t.id} type="button" className="ah-task" onClick={() => nav('/events')}>
                <div className="ah-task-tx"><b>{t.name}</b><span>{t.done ? '可领取 · ' : ''}+{t.reward} 金币</span></div>
                <div className="ah-task-bar"><i style={{ width: Math.min(100, Math.round((t.progress || 0) / (t.target || 1) * 100)) + '%' }} /></div>
              </button>
            ))}
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
    </div>
  );
}
