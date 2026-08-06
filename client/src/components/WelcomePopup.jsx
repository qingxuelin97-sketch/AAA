import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNav as useNavigate } from '../nav.js';
import { CoinIcon, DiamondIcon } from '../ui.jsx';
import { Sparkles, Bug, Crown, MessageSquare, X } from 'lucide-react';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';

const SEEN_KEY = 'huanyu_welcome_seen';

// Auto entry popup — shown once per day. Welcomes the user and surfaces the
// official Bug 赏金 program (submit a bug → 100+ 金币).
export default function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const popupRef = useRef(null);
  const appPortal = isAppMode();
  const nav = useNavigate();

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(SEEN_KEY) !== today) {
      const t = setTimeout(() => setOpen(true), 650);
      return () => clearTimeout(t);
    }
  }, []);

  const close = () => {
    localStorage.setItem(SEEN_KEY, new Date().toISOString().slice(0, 10));
    setOpen(false);
  };
  useAppOverlay(open, close, { rootRef: popupRef, isolate: appPortal });

  if (!open) return null;
  const popup = (
    <div className="modal-backdrop" onClick={close}>
      <div ref={popupRef} className="card welcome-pop" role="dialog" aria-modal="true" tabIndex={-1} onClick={e => e.stopPropagation()}>
        <button className="wp-x" onClick={close} aria-label="关闭"><X size={18} /></button>
        <div className="wp-hero">
          <span className="wp-badge"><Sparkles size={14} /> 欢迎来到幻域</span>
          <h2>把你脑海里的故事，写成会呼吸的角色</h2>
          <p>创建角色、共写剧本，在剧场与多位 AI 同台联机演出。未配置自己 API 也能畅聊——平台已为你备好内置语言服务。</p>
        </div>

        <div className="wp-bounty">
          <span className="wp-bug"><Bug size={20} /></span>
          <div className="wp-bounty-tx">
            <b>Bug 赏金计划 · 你来找茬，我来发奖</b>
            <p>发现任何 bug、卡顿或体验瑕疵，联系管理员提交反馈，一经采纳 <b>奖励 100 金币起</b>；重大问题再加码钻石与 VIP。让幻域因你而更好。</p>
            <div className="wp-rewards">
              <span><CoinIcon size={13} /> 100 金币起</span>
              <span><DiamondIcon size={13} /> 重大问题加码</span>
              <span><Crown size={13} /> VIP 加成</span>
            </div>
            <div className="wp-qq">
              <MessageSquare size={15} />
              <span>反馈渠道：<b>联系管理员</b></span>
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn block" onClick={close}>开始探索</button>
          <button className="btn primary block" onClick={() => { if (nav('/events') !== false) close(); }}><PartyIcon /> 查看全部活动</button>
        </div>
      </div>
    </div>
  );
  return appPortal && typeof document !== 'undefined' ? createPortal(popup, document.body) : popup;
}

function PartyIcon() {
  return <Sparkles size={15} />;
}
