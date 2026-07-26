// 内容载入失败态（提示 + 重新载入）—— 从 pages/AppProfile.jsx 原样抽取。
// 双端形态：
//   · 旧形态（web=false）：逐字节复刻 AppProfile 原错误分支（.pf-empty +
//     AppButton），tabpanel a11y 属性由调用方经 panelProps 原样传入。
//   · web=true：Web Lumen Glass 新形态（.pfw-load-error，原生按钮走
//     web-lumen-profile.css 的 .pfw-retry，≥44px 触控目标）。
import React from 'react';
import { RotateCcw } from 'lucide-react';
import { AppButton } from '../AppControls.jsx';

export default function ProfileLoadError({ message, onRetry, web = false, panelProps = {} }) {
  if (web) {
    return (
      <div className="pfw-load-error" role="alert">
        <p>{message || '内容暂时无法载入'}</p>
        <button type="button" className="pfw-retry" onClick={onRetry}><RotateCcw size={15} /> 重新载入</button>
      </div>
    );
  }
  // ── App / 旧形态：与 AppProfile.jsx 改前渲染逐字节一致 ──
  return (
    <div className="pf-empty" role="alert" {...panelProps}>
      <p>{message}</p>
      <AppButton variant="secondary" size="sm" onClick={onRetry}>重新载入</AppButton>
    </div>
  );
}
