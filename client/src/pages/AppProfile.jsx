// 「我的」—— app 壳第五个 tab 的个人主页。
// 结构采用个人主页通用范式（资料头 → 统计 → 会员横幅 → 资产卡 → 快捷功能条 →
// 内容 Tab → 全部功能），全部为幻域自有品牌/文案/lucide 图标的原创实现。
// 「全部功能」宫格保底承接原 launcher 的每一个入口，确保功能不丢。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Avatar, CoinIcon, DiamondIcon, IdentityBadges } from '../ui.jsx';
import { fmtNum } from '../util.js';
import { CoverArt, EmptyArt } from '../art.jsx';
import {
  Bell, BookOpen, Copy, ChevronRight, Dices, Download, Drama,
  Feather, Heart, Landmark, LifeBuoy, LogOut, Medal, Megaphone,
  Orbit, PartyPopper, Pencil, ScrollText, Search, Settings,
  Shield, Tags, TrendingUp, Trophy, UserRound, Users, Wand2, Gift
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

// 快捷功能条（横向滚动，取最常用）。
// 去重原则：签到/钱包入口由上方资产卡承担；会员由 VIP 横幅承担 —— 快捷条只放
// 资产卡覆盖不到的高频功能，不再与同屏区块重复。
const QUICK = [
  { to: '/achievements', ic: Medal, label: '成就', tag: '' },
  { to: '/insights', ic: Orbit, label: '星轨', tag: 'New' },
  { to: '/events', ic: PartyPopper, label: '活动', tag: '' },
  { to: '/gacha', ic: Dices, label: '扭蛋机', tag: '' },
  { to: '/favorites', ic: Heart, label: '收藏', tag: '' }
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
  ] },
  { title: '我的', items: [
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ] }
];

export default function AppProfile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState('chars'); // chars | favs
  const [chars, setChars] = useState(null);
  const [favs, setFavs] = useState(null);
  const [installReady, setInstallReady] = useState(() => !!window.__hyInstallEvt);

  useEffect(() => {
    if (!user?.id) return;
    api('/users/' + user.id).then(d => setStats(d.stats || null)).catch(() => {});
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    api('/characters/mine').then(d => setChars(d.characters || [])).catch(() => setChars([]));
  }, [user?.id]);
  useEffect(() => {
    if (tab === 'favs' && favs === null) {
      api('/characters/favorites/list').then(d => setFavs(d.characters || [])).catch(() => setFavs([]));
    }
  }, [tab, favs]);
  useEffect(() => {
    const h = () => setInstallReady(true);
    window.addEventListener('huanyu-install-ready', h);
    return () => window.removeEventListener('huanyu-install-ready', h);
  }, []);

  const install = () => {
    const evt = window.__hyInstallEvt;
    if (!evt) return;
    evt.prompt();
    evt.userChoice?.finally(() => { window.__hyInstallEvt = null; setInstallReady(false); });
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText('U' + user.id); toast('已复制 UID'); } catch { toast('UID：U' + user.id); }
  };

  const ST = [
    { n: stats?.characters, label: '角色', to: '/library' },
    { n: stats?.scripts, label: '剧本', to: '/scripts' },
    { n: stats?.followers, label: '粉丝', to: '/profile' },
    { n: stats?.following, label: '关注', to: '/profile' }
  ];
  const content = tab === 'chars' ? chars : favs;

  return (
    <div className="pf">
      {/* 顶部图标行 */}
      <div className="pf-top">
        <button onClick={openCmdk} aria-label="搜索"><Search size={21} /></button>
        <button className="pf-bell" onClick={() => nav('/notifications')} aria-label="通知">
          <Bell size={21} />{unread > 0 && <i className="pf-dot" />}
        </button>
        <button onClick={() => nav('/settings')} aria-label="设置"><Settings size={21} /></button>
      </div>

      {/* 资料头 */}
      <div className="pf-id">
        <button className="pf-av" onClick={() => nav('/profile')}>
          <Avatar src={user?.avatar} name={user?.display_name} size={68} eager />
        </button>
        <div className="pf-id-tx">
          <b>{user?.display_name || user?.username}</b>
          <button className="pf-uid" onClick={copyId}>UID: U{user?.id} <Copy size={12} /></button>
        </div>
        <button className="pf-edit" onClick={() => nav('/profile')} aria-label="编辑资料"><Pencil size={16} /></button>
      </div>
      <div className="pf-bio" onClick={() => nav('/profile')}>{user?.bio || '点击填写你的简介吧'}</div>
      <IdentityBadges u={user} className="pf-badges" />

      {/* 统计 */}
      <div className="pf-stats">
        {ST.map(s => (
          <button key={s.label} onClick={() => nav(s.to)}>
            <b>{s.n == null ? '—' : fmtNum(s.n)}</b><span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* 会员横幅（紫调促销卡 + 权益词条）*/}
      <button className={'pf-vip' + (user?.svip ? ' svip' : user?.vip ? ' on' : '')} onClick={() => nav('/vip')}>
        <span className="pf-vip-glow" aria-hidden="true" />
        <div className="pf-vip-l">
          <b>{user?.svip ? 'SVIP 尊享会员' : user?.vip ? 'VIP 会员' : '开通幻域会员'}</b>
          {user?.vip || user?.svip
            ? <span className="pf-vip-exp">{user?.svip ? '平台 AI 5 折 · 至高权益' : `有效期至 ${String(user?.vip_until || '').slice(0, 10)}`}</span>
            : <div className="pf-vip-perks"><span>无限沉浸</span><span>记忆增强</span><span>语音朗读</span><span>免打扰</span></div>}
        </div>
        <span className="pf-vip-go">{user?.vip || user?.svip ? '查看' : '立即开通'}</span>
      </button>

      {/* 资产卡 */}
      <div className="pf-assets">
        <div className="pf-asset-head">
          <span className="pf-asset-bal"><CoinIcon size={19} /> <b>{fmtNum(user?.gold)}</b> 金币</span>
          <span className="pf-asset-bal"><DiamondIcon size={19} /> <b>{fmtNum(user?.diamond)}</b> 钻石</span>
        </div>
        <div className="pf-asset-acts">
          {/* 两个按钮此前都跳 /wallet（重复）；合并为一个明确的钱包入口 */}
          <button onClick={() => nav('/wallet')}><Gift size={14} /> 钱包 · 签到 / 兑换 / 流水 <ChevronRight size={14} /></button>
        </div>
      </div>

      {/* 快捷功能条 */}
      <div className="pf-quick">
        {QUICK.map(q => (
          <button key={q.label + q.to} onClick={() => nav(q.to)}>
            <span className="pf-quick-ic"><q.ic size={20} />{q.tag && <i className="pf-quick-tag">{q.tag}</i>}</span>
            <span>{q.label}</span>
          </button>
        ))}
      </div>

      {/* 内容 Tab */}
      <div className="pf-tabs">
        <button className={tab === 'chars' ? 'on' : ''} onClick={() => setTab('chars')}>我的角色 {chars ? chars.length : ''}</button>
        <button className={tab === 'favs' ? 'on' : ''} onClick={() => setTab('favs')}>收藏 {favs ? favs.length : ''}</button>
      </div>
      {content === null ? (
        <div className="pf-content-grid">{[0, 1, 2].map(i => <div key={i} className="pf-cc-skel" />)}</div>
      ) : content.length === 0 ? (
        <div className="pf-empty">
          <EmptyArt kind={tab === 'chars' ? 'library' : 'chat'} size={104} />
          <p>{tab === 'chars' ? '还没有创建角色' : '还没有收藏的角色'}</p>
          <button className="btn primary sm" onClick={() => nav(tab === 'chars' ? '/character/new' : '/')}>
            {tab === 'chars' ? '去创建' : '去发现'}
          </button>
        </div>
      ) : (
        <div className="pf-content-grid">
          {content.map(c => (
            <button key={c.id} className="pf-cc" onClick={() => nav('/character/' + c.id)}>
              <div className="pf-cc-cover">
                {c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" decoding="async" /> : <div className="cover-art-box"><CoverArt name={c.name} /></div>}
              </div>
              <b>{c.name}</b>
              <span>{c.tagline || '——'}</span>
            </button>
          ))}
        </div>
      )}

      {/* 全部功能 —— 保底承接每一个入口 */}
      {GRID.map(g => (
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
        {user?.is_gm && <button className="pf-foot-btn" onClick={() => nav('/admin')}><Shield size={15} /> 管理后台</button>}
        <button className="pf-foot-btn" onClick={() => nav('/help')}><LifeBuoy size={15} /> 帮助中心</button>
        {installReady && <button className="pf-foot-btn" onClick={install}><Download size={15} /> 安装到桌面</button>}
        <button className="pf-foot-btn danger" onClick={logout}><LogOut size={15} /> 退出登录</button>
      </div>
    </div>
  );
}
