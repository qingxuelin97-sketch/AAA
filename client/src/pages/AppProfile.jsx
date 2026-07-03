// 「我的」—— app 壳第五个 tab 的原生个人页。
// 取代旧的全屏 launcher 抽屉：个人卡（banner/头像/徽章/统计）→ 资产行 → 会员横幅
// → 全功能宫格（探索/互动/创作，原 launcher 的全部入口一个不少）→ 通用行。
// 数据：/users/:id（统计）+ useAuth（余额/身份）。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { Avatar, CoinIcon, DiamondIcon, IdentityBadges } from '../ui.jsx';
import { fmtNum } from '../util.js';
import {
  Bell, BookOpen, ChevronRight, Compass, Crown, Dices, Download, Drama, Feather,
  Heart, Landmark, LifeBuoy, Library, LogOut, Medal, Megaphone, MessageCircle,
  Orbit, PartyPopper, Pencil, ScrollText, Settings, Shield, Sparkles, Tags,
  TrendingUp, Trophy, UserRound, Users, Wallet, Wand2
} from 'lucide-react';

const GRID = [
  { title: '探索', items: [
    { to: '/', ic: Compass, label: '发现' },
    { to: '/events', ic: PartyPopper, label: '活动' },
    { to: '/gacha', ic: Dices, label: '扭蛋机' },
    { to: '/scripts', ic: ScrollText, label: '剧本' },
    { to: '/community', ic: Users, label: '社区' },
    { to: '/leaderboard', ic: Trophy, label: '排行榜' },
    { to: '/parliament', ic: Landmark, label: '议会' },
    { to: '/announcements', ic: Megaphone, label: '公告' },
    { to: '/tags', ic: Tags, label: '标签' }
  ] },
  { title: '互动', items: [
    { to: '/messages', ic: MessageCircle, label: '消息' },
    { to: '/atelier', ic: Feather, label: '小说' },
    { to: '/draw', ic: Wand2, label: 'AI 绘图' },
    { to: '/friends', ic: UserRound, label: '好友' },
    { to: '/groups', ic: Users, label: '群聊' },
    { to: '/theater', ic: Drama, label: '剧场' }
  ] },
  { title: '创作与收藏', items: [
    { to: '/library', ic: Library, label: '我的角色' },
    { to: '/worldbooks', ic: BookOpen, label: '世界书' },
    { to: '/studio', ic: TrendingUp, label: '创作中心' },
    { to: '/insights', ic: Orbit, label: '星轨' },
    { to: '/achievements', ic: Medal, label: '成就' },
    { to: '/favorites', ic: Heart, label: '收藏' },
    { to: '/wallet', ic: Wallet, label: '钱包' },
    { to: '/notifications', ic: Bell, label: '通知', badge: 'noti' },
    { to: '/settings', ic: Settings, label: '设置' }
  ] }
];

export default function AppProfile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [unread, setUnread] = useState(0);
  const [installReady, setInstallReady] = useState(() => !!window.__hyInstallEvt);

  useEffect(() => {
    if (!user?.id) return;
    api('/users/' + user.id).then(d => setStats(d.stats || null)).catch(() => {});
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
  }, [user?.id]);
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

  const ST = [
    { n: stats?.characters, label: '角色', to: '/library' },
    { n: stats?.scripts, label: '剧本', to: '/scripts' },
    { n: stats?.followers, label: '粉丝', to: '/profile' },
    { n: stats?.following, label: '关注', to: '/profile' }
  ];

  return (
    <div className="mep">
      {/* —— 个人卡 —— */}
      <header className="mep-hero">
        {user?.banner
          ? <img className="mep-banner" src={user.banner} alt="" decoding="async" />
          : <div className="mep-banner mep-banner-ph" />}
        <div className="mep-hero-scrim" />
        <button className="mep-id" onClick={() => nav('/profile')}>
          <Avatar src={user?.avatar} name={user?.display_name} size={64} eager />
          <div className="mep-id-tx">
            <b>{user?.display_name || user?.username}</b>
            <span>@{user?.username}</span>
          </div>
          <span className="mep-edit"><Pencil size={13} /> 主页</span>
        </button>
        <IdentityBadges u={user} className="mep-badges" />
        <div className="mep-stats">
          {ST.map(s => (
            <button key={s.label} onClick={() => nav(s.to)}>
              <b>{s.n == null ? '—' : fmtNum(s.n)}</b><span>{s.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* —— 资产行 —— */}
      <div className="mep-wallet">
        <button onClick={() => nav('/wallet')}><CoinIcon size={17} /> <b>{fmtNum(user?.gold)}</b> <span>金币</span></button>
        <button onClick={() => nav('/wallet')}><DiamondIcon size={17} /> <b>{fmtNum(user?.diamond)}</b> <span>钻石</span></button>
      </div>

      {/* —— 会员横幅 —— */}
      <button className={'mep-vip' + (user?.svip ? ' svip' : user?.vip ? ' on' : '')} onClick={() => nav('/vip')}>
        <span className="mep-vip-ic"><Crown size={19} /></span>
        <span className="mep-vip-tx">
          <b>{user?.svip ? 'SVIP 尊享会员' : user?.vip ? 'VIP 会员生效中' : '开通会员'}</b>
          <small>{user?.svip ? '平台 AI 全线 5 折 · 至高权益' : user?.vip ? `有效期至 ${String(user?.vip_until || '').slice(0, 10)}` : 'AI 对话 75 折 · 签到双倍 · 专属标识'}</small>
        </span>
        <ChevronRight size={17} className="mep-vip-chev" />
      </button>

      {/* —— 全功能宫格 —— */}
      {GRID.map(g => (
        <section key={g.title} className="mep-group">
          <h4>{g.title}</h4>
          <div className="mep-grid">
            {g.items.map((n, i) => (
              <button key={n.to} className="mep-cell" style={{ '--i': i }} onClick={() => nav(n.to)}>
                <span className="mep-cell-ic">
                  <n.ic size={21} />
                  {n.badge === 'noti' && unread > 0 && <i className="app-dot" />}
                </span>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* —— 通用行 —— */}
      <div className="mep-rows">
        {user?.is_gm && (
          <button className="mep-row" onClick={() => nav('/admin')}><Shield size={16} /> 管理后台 <ChevronRight size={15} /></button>
        )}
        <button className="mep-row" onClick={() => nav('/help')}><LifeBuoy size={16} /> 帮助中心 <ChevronRight size={15} /></button>
        <button className="mep-row" onClick={() => nav('/features')}><Sparkles size={16} /> 产品功能 <ChevronRight size={15} /></button>
        {installReady && (
          <button className="mep-row" onClick={install}><Download size={16} /> 安装到桌面 <ChevronRight size={15} /></button>
        )}
        <button className="mep-row danger" onClick={logout}><LogOut size={16} /> 退出登录</button>
      </div>
    </div>
  );
}
