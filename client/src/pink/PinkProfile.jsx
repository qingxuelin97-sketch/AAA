import React from 'react';
import { useNav } from '../nav.js';
import { setThemeMode } from '../theme.js';
import BakedScreen, { PinkHit } from './BakedScreen.jsx';

export default function PinkProfile({ unread = 0, onCopyUid }) {
  const nav = useNav();
  const quick = ['/achievements', '/insights', '/events', '/gacha', '/favorites'];
  return (
    <BakedScreen screen="profile">
      <PinkHit className="pink-profile-bell" label={unread ? `通知，${unread} 条未读` : '通知'} onClick={() => nav('/notifications', { state: { appBackTo: '/me' } })} />
      <PinkHit className="pink-profile-settings" label="设置" onClick={() => nav('/settings')} />
      <PinkHit className="pink-profile-avatar" label="编辑个人资料" onClick={() => nav('/profile')} />
      <PinkHit className="pink-profile-uid" label="复制 UID U1024" onClick={onCopyUid} />
      <PinkHit className="pink-profile-vip" label="查看幻域会员权益" onClick={() => nav('/vip')} />
      <PinkHit className="pink-profile-wallet" label="打开钱包" onClick={() => nav('/wallet')} />
      <div className="pink-profile-quick" role="group" aria-label="快捷功能">
        {quick.map((to) => <PinkHit key={to} label={to} onClick={() => nav(to)} />)}
      </div>
      <PinkHit className="pink-profile-manage" label="管理全部角色" onClick={() => nav('/library')} />
      <div className="pink-profile-character-cards" role="group" aria-label="我的角色">
        {[0, 1, 2].map((index) => <PinkHit key={index} label={`查看角色 ${index + 1}`} onClick={() => nav('/library')} />)}
      </div>
      <PinkHit className="pink-profile-security" label="账号与安全" onClick={() => nav('/settings')} />
      <PinkHit className="pink-profile-night" label="开启夜间模式" onClick={() => setThemeMode('dark')} />
    </BakedScreen>
  );
}
