// S7 · App 统一错误态（ORACLE §7.2：首载失败必须给出重试出口，绝不伪装成空态）。
// 仅在 App 壳分支渲染（调用方以 isAppMode() 包裹或位于 App 专属页）；
// Web 分支保持各页原状，零视觉差。
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { AppEmptyArt } from '../art.jsx';
import { AppButton } from './AppControls.jsx';
import { useNav } from '../nav.js';

export default function AppErrorState({
  kind = 'generic',
  title = '加载失败',
  message = '网络似乎开小差了，稍后再试一次',
  onRetry,
  retryLabel = '重试',
  secondaryTo,
  secondaryLabel,
  busy = false,
}) {
  const nav = useNav();
  return (
    <div className="qa-error-state" role="alert" aria-busy={busy || undefined}>
      <AppEmptyArt kind={kind} size={124} />
      <b className="qa-error-state__title">{title}</b>
      <p className="qa-error-state__copy">{message}</p>
      <div className="qa-error-state__acts">
        {onRetry && (
          <AppButton variant="primary" loading={busy} disabled={busy} onClick={onRetry}>
            <RefreshCw size={16} /> {retryLabel}
          </AppButton>
        )}
        {secondaryTo && (
          <AppButton variant="tertiary" onClick={() => nav(secondaryTo)}>
            {secondaryLabel || '返回'}
          </AppButton>
        )}
      </div>
    </div>
  );
}
