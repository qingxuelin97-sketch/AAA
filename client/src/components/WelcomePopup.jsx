import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast, CoinIcon, DiamondIcon } from '../ui.jsx';
import { Sparkles, Bug, Crown, MessageSquare, Copy, X } from 'lucide-react';

const QQ = '3487923507';
const SEEN_KEY = 'huanyu_welcome_seen';

// Auto entry popup — shown once per day. Welcomes the user and surfaces the
// official Bug 赏金 program (submit a bug → 100+ 金币).
export default function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

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
  const copyQQ = async () => {
    try { await navigator.clipboard.writeText(QQ); toast('已复制官方技术 QQ：' + QQ); }
    catch { toast('复制失败，请手动记录 QQ：' + QQ, 'err'); }
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="card welcome-pop" onClick={e => e.stopPropagation()}>
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
            <p>发现任何 bug、卡顿或体验瑕疵，提交至官方技术 QQ，一经采纳 <b>奖励 100 金币起</b>；重大问题再加码钻石与 VIP。让幻域因你而更好。</p>
            <div className="wp-rewards">
              <span><CoinIcon size={13} /> 100 金币起</span>
              <span><DiamondIcon size={13} /> 重大问题加码</span>
              <span><Crown size={13} /> VIP 加成</span>
            </div>
            <div className="wp-qq">
              <MessageSquare size={15} />
              <span>官方技术 QQ：<b>{QQ}</b></span>
              <button className="btn sm" onClick={copyQQ}><Copy size={13} /> 复制</button>
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn block" onClick={close}>开始探索</button>
          <button className="btn primary block" onClick={() => { close(); nav('/events'); }}><PartyIcon /> 查看全部活动</button>
        </div>
      </div>
    </div>
  );
}

function PartyIcon() {
  return <Sparkles size={15} />;
}
