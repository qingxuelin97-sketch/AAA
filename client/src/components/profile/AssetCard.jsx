// 资产卡（金币 / 钻石 + 唯一钱包入口）—— 从 pages/AppProfile.jsx 原样抽取。
// 双端形态：
//   · app / 旧 Web 回落形态（web=false）：逐字节复刻 AppProfile 原 JSX。
//   · web=true：Web Lumen Glass 新形态 —— 调用方挂 .lgw-entity 石墨实体面，
//     暖金光点由 web-lumen-profile.css 的 ::before 承担（唯一一处，零 DOM）。
import React from 'react';
import { ChevronRight, Gift } from 'lucide-react';
import { CoinIcon, DiamondIcon } from '../../ui.jsx';
import { fmtNum } from '../../util.js';
import { AppButton } from '../AppControls.jsx';

export default function AssetCard({ user, onWallet, app = false, web = false }) {
  if (web) {
    return (
      <div className="pfw-assets lgw-entity">
        <div className="pfw-asset-bals">
          <span className="pfw-asset-bal"><CoinIcon size={19} /> <b>{fmtNum(user?.gold)}</b> 金币</span>
          <span className="pfw-asset-bal gem"><DiamondIcon size={19} /> <b>{fmtNum(user?.diamond)}</b> 钻石</span>
        </div>
        <button type="button" className="pfw-asset-go" onClick={onWallet}>
          <Gift size={15} /> 钱包 · 签到 / 兑换 / 流水 <ChevronRight size={15} />
        </button>
      </div>
    );
  }
  // ── App / 旧形态：与 AppProfile.jsx 改前渲染逐字节一致 ──
  return (
    <div className={app ? 'pf-assets qa-profile__assets' : 'pf-assets'}>
      <div className="pf-asset-head">
        <span className="pf-asset-bal"><CoinIcon size={19} /> <b>{fmtNum(user?.gold)}</b> 金币</span>
        <span className="pf-asset-bal"><DiamondIcon size={19} /> <b>{fmtNum(user?.diamond)}</b> 钻石</span>
      </div>
      <div className="pf-asset-acts">
        {/* 两个按钮此前都跳 /wallet（重复）；合并为一个明确的钱包入口 */}
        <AppButton variant="tertiary" onClick={onWallet}><Gift size={14} /> 钱包 · 签到 / 兑换 / 流水 <ChevronRight size={14} /></AppButton>
      </div>
    </div>
  );
}
