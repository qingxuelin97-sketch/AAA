// 「我的」—— app 壳四个主导航目的地之一。
// 结构采用个人主页通用范式（资料头 → 统计 → 会员横幅 → 资产卡 → 快捷功能条 →
// 内容 Tab → 全部功能），全部为幻域自有品牌/文案/lucide 图标的原创实现。
// 「全部功能」宫格保底承接原 launcher 的每一个入口，确保功能不丢。
import React, { useEffect, useState } from 'react';
import { useNav } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon, IdentityBadges, CountUp } from '../ui.jsx';
import { fmtNum } from '../util.js';
import { CoverArt, EmptyArt, QuietAquaCharacterArt, isLegacyMonogramCover } from '../art.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { useRealtimeEvent } from '../realtime.jsx';
import { useAppTabActive } from '../appTabActivity.js';
import {
  Bell, BookOpen, Copy, ChevronRight, Dices, Download, Drama,
  Feather, Heart, Landmark, LifeBuoy, LogOut, Medal, Megaphone,
  Orbit, PartyPopper, Pencil, ScrollText, Search, Settings,
  Shield, Tags, TrendingUp, Trophy, UserRound, Users, Wand2, Gift, Crown
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

function ProfileCharacterCover({ character, app, eager = false }) {
  const [failed, setFailed] = useState(false);
  const source = character?.avatar;
  const useFallback = !source || failed || (app && isLegacyMonogramCover(source));
  if (useFallback) {
    return app
      ? <QuietAquaCharacterArt className="pf-cc-oracle-art" alt="" loading={eager ? 'eager' : 'lazy'} />
      : <div className="cover-art-box"><CoverArt name={character?.name} /></div>;
  }
  return (
    <img
      src={assetUrl(source)}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// 快捷功能条（横向滚动，取最常用）。
// 去重原则：签到/钱包入口由上方资产卡承担；会员由 VIP 横幅承担 —— 快捷条只放
// 资产卡覆盖不到的高频功能，不再与同屏区块重复。
const QUICK = [
  { to: '/achievements', ic: Medal, label: '成就', tag: '', tone: 'reward' },
  { to: '/insights', ic: Orbit, label: '星轨', tag: 'New', tone: 'indigo' },
  { to: '/events', ic: PartyPopper, label: '活动', tag: '', tone: 'coral' },
  { to: '/gacha', ic: Dices, label: '扭蛋机', tag: '', tone: 'reward' },
  { to: '/favorites', ic: Heart, label: '收藏', tag: '', tone: 'rose' }
];

// 「全部功能」宫格 —— 只收录页面其他区块（底部 Tab / VIP 横幅 / 资产卡 / 快捷条）
// 没有覆盖的入口；每个功能全页仅出现一次，告别四重重复。
const GRID = [
  { title: '探索', items: [
    { to: '/scripts', ic: ScrollText, label: '剧本' },
    { to: '/community', ic: Users, label: '社区' },
    { to: '/leaderboard', ic: Trophy, label: '排行榜' },
    { to: '/parliament', ic: Landmark, label: '议会' },
    { to: '/announcements', ic: Megaphone, label: '公告' },
    { to: '/tags', ic: Tags, label: '标签' }
  ] },
  { title: '互动创作', items: [
    // 「我的角色」不再入宫格：页面中部已有「我的角色」内容 Tab（实机反馈重复）
    { to: '/atelier', ic: Feather, label: '小说' },
    { to: '/draw', ic: Wand2, label: 'AI 绘图' },
    { to: '/theater', ic: Drama, label: '剧场' },
    { to: '/friends', ic: UserRound, label: '好友' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/worldbooks', ic: BookOpen, label: '世界书' },
    { to: '/studio', ic: TrendingUp, label: '创作中心' }
  ] }
];

const WEB_PROFILE_GRID = {
  title: '我的',
  items: [
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ]
};

export default function AppProfile() {
  const { user, logout } = useAuth();
  const nav = useNav();
  const toast = useToast();
  const appMode = isAppMode();
  const [stats, setStats] = useState(null);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState('chars'); // chars | favs
  const [chars, setChars] = useState(null);
  const [favs, setFavs] = useState(null);
  const [charsError, setCharsError] = useState('');
  const [favsError, setFavsError] = useState('');
  const [installReady, setInstallReady] = useState(() => !!window.__hyInstallEvt);

  useEffect(() => {
    if (!user?.id) return;
    api('/users/' + user.id).then(d => setStats(d.stats || null)).catch(() => {});
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    setCharsError('');
    api('/characters/mine').then(d => setChars(d.characters || [])).catch((error) => { setChars([]); setCharsError(error.message || '暂时无法载入角色'); });
  }, [user?.id]);
  useEffect(() => {
    if (tab === 'favs' && favs === null) {
      setFavsError('');
      api('/characters/favorites/list').then(d => setFavs(d.characters || [])).catch((error) => { setFavs([]); setFavsError(error.message || '暂时无法载入收藏'); });
    }
  }, [tab, favs]);
  useEffect(() => {
    const h = () => setInstallReady(true);
    window.addEventListener('huanyu-install-ready', h);
    return () => window.removeEventListener('huanyu-install-ready', h);
  }, []);

  useRealtimeEvent('notification', () => {
    if (appMode) setUnread(value => value + 1);
  });
  useEffect(() => {
    if (!appMode) return undefined;
    const clear = () => setUnread(0);
    window.addEventListener('huanyu-noti-read', clear);
    return () => window.removeEventListener('huanyu-noti-read', clear);
  }, [appMode]);
  useAppTabActive('/me', () => {
    if (!appMode) return;
    if (!user?.id) return;
    api('/users/' + user.id).then(d => setStats(d.stats || null)).catch(() => {});
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    setCharsError('');
    api('/characters/mine').then(d => setChars(d.characters || [])).catch((error) => { setCharsError(error.message || '暂时无法载入角色'); });
    if (tab === 'favs') {
      setFavsError('');
      api('/characters/favorites/list').then(d => setFavs(d.characters || [])).catch((error) => { setFavsError(error.message || '暂时无法载入收藏'); });
    }
  });

  const install = async () => {
    const evt = window.__hyInstallEvt;
    if (!evt) return;
    if (!appMode) {
      evt.prompt();
      evt.userChoice?.finally(() => { window.__hyInstallEvt = null; setInstallReady(false); });
      return;
    }
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      toast('暂时无法安装，请稍后重试', 'err');
    } finally {
      window.__hyInstallEvt = null;
      setInstallReady(false);
    }
  };
  const copyId = async () => {
    if (appMode && !user?.id) { toast('资料仍在载入，请稍后再试', 'err'); return; }
    try { await navigator.clipboard.writeText('U' + user.id); toast('已复制 UID'); } catch { toast('UID：U' + user.id); }
  };

  const ST = [
    { n: stats?.characters, label: '角色', to: '/library' },
    { n: stats?.scripts, label: '剧本', to: '/scripts' },
    { n: stats?.followers, label: '粉丝', to: '/profile' },
    { n: stats?.following, label: '关注', to: '/profile' }
  ];
  const content = tab === 'chars' ? chars : favs;
  const contentError = tab === 'chars' ? charsError : favsError;
  const bioKeyboard = appMode ? {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      nav('/profile');
    }
  } : {};
  const tabListA11y = appMode ? { role: 'tablist', 'aria-label': '个人内容' } : {};
  const tabA11y = (name) => appMode ? {
    role: 'tab',
    id: `pf-tab-${name}`,
    'aria-selected': tab === name,
    'aria-controls': 'pf-content-panel'
  } : {};
  const panelA11y = appMode ? {
    role: 'tabpanel',
    id: 'pf-content-panel',
    'aria-labelledby': `pf-tab-${tab}`
  } : {};
  const gridGroups = appMode ? GRID : [...GRID, WEB_PROFILE_GRID];

  // The App shell groups identity, bio, badges and stats into one semantic
  // profile surface. Web receives the same legacy sibling DOM via Fragment.
  const identityContent = (
    <>
      <div className="pf-id">
        <AppIconButton
          className="pf-av"
          label="查看个人资料"
          onClick={() => nav('/profile')}
          style={appMode ? { viewTransitionName: 'qa-profile-avatar' } : undefined}
        >
          <Avatar src={user?.avatar} name={user?.display_name} size={68} eager />
        </AppIconButton>
        <div className="pf-id-tx">
          <b>{user?.display_name || user?.username}</b>
          <AppButton className="pf-uid" variant="tertiary" size="sm" onClick={copyId}>UID: U{user?.id} <Copy size={12} /></AppButton>
        </div>
        <AppIconButton className="pf-edit" label="编辑资料" onClick={() => nav('/profile')} aria-label="编辑资料"><Pencil size={16} /></AppIconButton>
      </div>
      <div className="pf-bio" onClick={() => nav('/profile')} {...bioKeyboard}>{user?.bio || '点击填写你的简介吧'}</div>
      <IdentityBadges u={user} className="pf-badges" />
      <div className="pf-stats">
        {ST.map(s => (
          <button key={s.label} onClick={() => nav(s.to)}>
            <b>{s.n == null ? '—' : <CountUp value={s.n} />}</b><span>{s.label}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className={appMode ? 'pf qa-profile qa3-profile' : 'pf'}>
      {/* 顶部图标行 */}
      <div className="pf-top" {...(appMode ? { role: 'toolbar', 'aria-label': '个人中心工具' } : {})}>
        {!appMode && <AppIconButton label="搜索" onClick={openCmdk} aria-label="搜索"><Search size={21} /></AppIconButton>}
        <AppIconButton
          className="pf-bell"
          label="通知"
          onClick={() => appMode
            ? nav('/notifications', { state: { appBackTo: '/me' } })
            : nav('/notifications')}
          aria-label={appMode && unread > 0 ? `通知，${unread} 条未读` : '通知'}
        >
          <Bell size={21} />{unread > 0 && <i className="pf-dot" />}
        </AppIconButton>
        <AppIconButton label="设置" onClick={() => nav('/settings')} aria-label="设置"><Settings size={21} /></AppIconButton>
      </div>

      {appMode
        ? <section className="pf-identity-card qa-profile__identity" aria-label="个人资料">{identityContent}</section>
        : identityContent}

      {/* 会员横幅（紫调促销卡 + 权益词条）*/}
      <button
        className={'pf-vip' + (user?.svip ? ' svip' : user?.vip ? ' on' : '') + (appMode ? ' qa-profile__membership' : '')}
        onClick={() => nav('/vip')}
        {...(appMode ? { 'aria-label': user?.vip || user?.svip ? '查看会员权益' : '开通幻域会员' } : {})}
      >
        <span className="pf-vip-glow" aria-hidden="true" />
        {appMode && <span className="pf-vip-mark" aria-hidden="true"><Crown size={24} /></span>}
        <div className="pf-vip-l">
          <b>{user?.svip ? 'SVIP 尊享会员' : user?.vip ? 'VIP 会员' : '开通幻域会员'}</b>
          {user?.vip || user?.svip
            ? <span className="pf-vip-exp">{user?.svip ? '平台 AI 5 折 · 至高权益' : `有效期至 ${String(user?.vip_until || '').slice(0, 10)}`}</span>
            : <div className="pf-vip-perks"><span>无限沉浸</span><span>记忆增强</span><span>语音朗读</span><span>免打扰</span></div>}
        </div>
        <span className="pf-vip-go">{user?.vip || user?.svip ? '查看' : '立即开通'}</span>
      </button>

      {/* 资产卡 */}
      <div className={appMode ? 'pf-assets qa-profile__assets' : 'pf-assets'}>
        <div className="pf-asset-head">
          <span className="pf-asset-bal"><CoinIcon size={19} /> <b>{fmtNum(user?.gold)}</b> 金币</span>
          <span className="pf-asset-bal"><DiamondIcon size={19} /> <b>{fmtNum(user?.diamond)}</b> 钻石</span>
        </div>
        <div className="pf-asset-acts">
          {/* 两个按钮此前都跳 /wallet（重复）；合并为一个明确的钱包入口 */}
          <AppButton variant="tertiary" onClick={() => nav('/wallet')}><Gift size={14} /> 钱包 · 签到 / 兑换 / 流水 <ChevronRight size={14} /></AppButton>
        </div>
      </div>

      {/* 快捷功能条 */}
      <div className="pf-quick">
        {QUICK.map(q => (
          <button key={q.label + q.to} data-tone={q.tone} onClick={() => nav(q.to)}>
            <span className="pf-quick-ic"><q.ic size={20} />{q.tag && <i className="pf-quick-tag">{q.tag}</i>}</span>
            <span>{q.label}</span>
          </button>
        ))}
      </div>

      {/* 内容 Tab */}
      <div className="pf-tabs" {...tabListA11y}>
        <AppButton
          className={tab === 'chars' ? 'on' : ''}
          variant="tertiary"
          selected={tab === 'chars'}
          onClick={() => setTab('chars')}
          {...tabA11y('chars')}
        >
          我的角色 {chars ? chars.length : ''}
        </AppButton>
        <AppButton
          className={tab === 'favs' ? 'on' : ''}
          variant="tertiary"
          selected={tab === 'favs'}
          onClick={() => setTab('favs')}
          {...tabA11y('favs')}
        >
          收藏 {favs ? favs.length : ''}
        </AppButton>
      </div>
      {content === null ? (
        <div className="pf-content-grid" {...panelA11y}>{[0, 1, 2].map(i => <div key={i} className="pf-cc-skel" />)}</div>
      ) : appMode && content.length === 0 && contentError ? (
        <div className="pf-empty" role="alert" {...panelA11y}>
          <p>{contentError}</p>
          <AppButton variant="secondary" size="sm" onClick={() => {
            if (tab === 'chars') { setChars(null); setCharsError(''); api('/characters/mine').then(d => setChars(d.characters || [])).catch((error) => { setChars([]); setCharsError(error.message || '暂时无法载入角色'); }); }
            else { setFavs(null); setFavsError(''); }
          }}>重新载入</AppButton>
        </div>
      ) : content.length === 0 ? (
        <div className="pf-empty" {...panelA11y}>
          <EmptyArt kind={tab === 'chars' ? 'library' : 'chat'} size={104} />
          <p>{tab === 'chars' ? '还没有创建角色' : '还没有收藏的角色'}</p>
          <AppButton className="btn primary sm" variant="primary" size="sm" onClick={() => nav(tab === 'chars' ? '/character/new' : '/')}>
            {tab === 'chars' ? '去创建' : '去发现'}
          </AppButton>
        </div>
      ) : (
        <div className="pf-content-grid" {...panelA11y}>
          {content.map((c, i) => (
            <button key={c.id} className="pf-cc" onClick={() => nav('/character/' + c.id)}>
              <div className="pf-cc-cover">
                <ProfileCharacterCover character={c} app={appMode} eager={appMode && i < 2} />
              </div>
              <b>{c.name}</b>
              <span>{c.tagline || '——'}</span>
            </button>
          ))}
        </div>
      )}

      {/* 全部功能 —— 保底承接每一个入口 */}
      {gridGroups.map(g => (
        <section key={g.title} className="pf-group">
          <h4>{g.title}</h4>
          <div className="pf-grid">
            {g.items.map((n, i) => (
              <button key={n.to + n.label} className="pf-cell" style={{ '--i': i }} onClick={() => nav(n.to)}>
                <span className="pf-cell-ic"><n.ic size={20} />{n.badge === 'noti' && unread > 0 && <i className="pf-dot sm" />}</span>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="pf-foot">
        {user?.is_gm && <AppButton className="pf-foot-btn" variant="secondary" onClick={() => nav('/admin')}><Shield size={15} /> 管理后台</AppButton>}
        <AppButton className="pf-foot-btn" variant="secondary" onClick={() => nav('/help')}><LifeBuoy size={15} /> 帮助中心</AppButton>
        {installReady && <AppButton className="pf-foot-btn" variant="secondary" onClick={install}><Download size={15} /> 安装到桌面</AppButton>}
        <AppButton className="pf-foot-btn danger" variant="danger" tone="danger" onClick={logout}><LogOut size={15} /> 退出登录</AppButton>
      </div>
    </div>
  );
}
