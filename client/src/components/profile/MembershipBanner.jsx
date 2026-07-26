// 会员横幅（VIP / SVIP / 未开通三态促销卡）—— 从 pages/AppProfile.jsx 原样抽取。
// 双端形态：
//   · app / 旧 Web 回落形态（web=false）：逐字节复刻 AppProfile 原 JSX ——
//     类名、条件类、aria 与子结构一字不改（app 布尔即原 appMode）。
//   · web=true：Web Lumen Glass 新形态，.pfw-* 类名（web-lumen-profile.css，
//     violet 调促销卡 / SVIP 金语义 / 一次性入场光线）。
import React from 'react';
import { ChevronRight, Crown } from 'lucide-react';

export default function MembershipBanner({ user, onOpen, app = false, web = false }) {
  if (web) {
    const member = !!(user?.vip || user?.svip);
    return (
      <button
        type="button"
        className={'pfw-vip' + (user?.svip ? ' svip' : user?.vip ? ' on' : '')}
        onClick={onOpen}
        aria-label={member ? '查看会员权益' : '开通幻域会员'}
      >
        <span className="pfw-vip-glow" aria-hidden="true" />
        <span className="pfw-vip-mark" aria-hidden="true"><Crown size={22} /></span>
        <span className="pfw-vip-tx">
          <b>{user?.svip ? 'SVIP 尊享会员' : user?.vip ? 'VIP 会员' : '开通幻域会员'}</b>
          {member
            ? <span className="pfw-vip-exp">{user?.svip ? '平台 AI 5 折 · 至高权益' : `有效期至 ${String(user?.vip_until || '').slice(0, 10)}`}</span>
            : <span className="pfw-vip-perks"><i>无限沉浸</i><i>记忆增强</i><i>语音朗读</i><i>免打扰</i></span>}
        </span>
        <span className="pfw-vip-go">{member ? '查看' : '立即开通'} <ChevronRight size={14} /></span>
      </button>
    );
  }
  // ── App / 旧形态：与 AppProfile.jsx 改前渲染逐字节一致 ──
  return (
    <button
      className={'pf-vip' + (user?.svip ? ' svip' : user?.vip ? ' on' : '') + (app ? ' qa-profile__membership' : '')}
      onClick={onOpen}
      {...(app ? { 'aria-label': user?.vip || user?.svip ? '查看会员权益' : '开通幻域会员' } : {})}
    >
      <span className="pf-vip-glow" aria-hidden="true" />
      {app && <span className="pf-vip-mark" aria-hidden="true"><Crown size={24} /></span>}
      <div className="pf-vip-l">
        <b>{user?.svip ? 'SVIP 尊享会员' : user?.vip ? 'VIP 会员' : '开通幻域会员'}</b>
        {user?.vip || user?.svip
          ? <span className="pf-vip-exp">{user?.svip ? '平台 AI 5 折 · 至高权益' : `有效期至 ${String(user?.vip_until || '').slice(0, 10)}`}</span>
          : <div className="pf-vip-perks"><span>无限沉浸</span><span>记忆增强</span><span>语音朗读</span><span>免打扰</span></div>}
      </div>
      <span className="pf-vip-go">{user?.vip || user?.svip ? '查看' : '立即开通'}</span>
    </button>
  );
}
