// 会员中心 —— 独立的 VIP 权益与开通页（自钱包拆出，信息层级对标一线会员页：
// 顶部会员卡 hero → 权益宫格 → 套餐选择 → 吸底开通 CTA + 兑换码）。
// 视觉为「幻域」自有的暮紫 × 鎏金体系（原创绘制，不搬运任何第三方素材）。
// 数据与动作全部走既有端点：/economy/wallet · /economy/vip · /economy/redeem。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, CoinIcon } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { Logo } from '../assets.jsx';
import { fmtNum } from '../util.js';
import {
  ArrowLeft, BadgePercent, Bell, BookHeart, Check, Crown, Drama, Gift,
  MessagesSquare, Sparkles, Ticket, Wallet as WalletIcon, ChevronRight
} from 'lucide-react';

// 权益宫格 —— 只列真实生效的会员能力（对应服务端 memberDiscount / checkin / 标识逻辑）。
const PERKS = [
  { ic: BadgePercent, title: 'AI 对话 75 折', desc: '平台模型全线折扣' },
  { ic: Gift, title: '签到金币双倍', desc: '每日签到收益 ×2' },
  { ic: Crown, title: '专属会员标识', desc: '主页与评论区尊贵展示' },
  { ic: Drama, title: '剧场群聊畅玩', desc: '多人多 AI 无限开场' },
  { ic: MessagesSquare, title: '语音朗读同折', desc: '平台语音合成一并 75 折' },
  { ic: BookHeart, title: '创作加成', desc: '角色 / 小说灵感全速释放' }
];

export default function Vip() {
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [plan, setPlan] = useState('vip30');

  const load = () => api('/economy/wallet').then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const after = async () => { await load(); await refreshUser(); };

  const openVip = async () => {
    if (busy) return;
    setBusy('vip');
    try { await api('/economy/vip', { method: 'POST' }); toast('🎉 会员已开通，尊享权益即刻生效'); await after(); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(''); }
  };
  const redeem = async () => {
    if (busy) return;
    const v = code.trim();
    if (!v) { toast('请输入兑换码', 'err'); return; }
    setBusy('redeem');
    try { await api('/economy/redeem', { method: 'POST', body: { code: v } }); toast('兑换成功'); setCode(''); await after(); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(''); }
  };

  const app = isAppMode();
  const w = data?.wallet;
  const rates = data?.rates || {};
  const vipCost = rates.vip_cost || 30000;
  const vipDays = rates.vip_days || 30;
  const isSvip = !!w?.svip;
  const isVip = !!w?.vip;

  return (
    <div className={'vipx' + (app ? ' immersive' : '')}>
      <div className="vipx-top">
        <button className="vipx-back" onClick={() => nav(-1)} aria-label="返回"><ArrowLeft size={20} /></button>
        <h1>会员中心</h1>
        <button className="vipx-wallet" onClick={() => nav('/wallet')} aria-label="钱包">
          <WalletIcon size={15} /> {w ? fmtNum(w.gold) : '…'}
        </button>
      </div>

      <div className="vipx-scroll">
        {/* —— 会员卡 hero：暮紫鎏金，月门徽记 —— */}
        <div className={'vipx-card' + (isSvip ? ' svip' : isVip ? ' vip' : '')}>
          <span className="vipx-card-shine" aria-hidden="true" />
          <div className="vipx-card-head">
            <b className="vipx-word">{isSvip ? 'SVIP' : 'VIP'}</b>
            <span className="vipx-mascot" aria-hidden="true"><Logo size={72} /></span>
          </div>
          <div className="vipx-card-foot">
            {isSvip
              ? <><b>尊享会员 · 至高权益</b><span>平台 AI 全线 5 折 · 感谢与幻域同行</span></>
              : isVip
              ? <><b>会员生效中</b><span>有效期至 {String(w?.vip_until || '').slice(0, 10)} · 续费自动顺延</span></>
              : <><b>解锁幻域全部沉浸体验</b><span>折扣 · 双倍签到 · 专属标识，一步到位</span></>}
          </div>
        </div>

        {/* —— 权益宫格 —— */}
        <div className="vipx-perks">
          {PERKS.map(p => (
            <div key={p.title} className="vipx-perk">
              <span className="vipx-perk-ic"><p.ic size={19} /></span>
              <b>{p.title}</b>
              <small>{p.desc}</small>
            </div>
          ))}
        </div>

        {/* —— 套餐选择 —— */}
        <div className="vipx-plans">
          <button className={'vipx-plan' + (plan === 'vip30' ? ' on' : '')} onClick={() => setPlan('vip30')}>
            <em className="vipx-plan-tag">金币直购</em>
            <b>月卡</b>
            <span className="vipx-price"><CoinIcon size={16} /> {fmtNum(vipCost)}</span>
            <small>{vipDays} 天 · 可叠加顺延</small>
          </button>
          <button className={'vipx-plan' + (plan === 'svip' ? ' on' : '')} onClick={() => setPlan('svip')}>
            <em className="vipx-plan-tag hot">活动限定</em>
            <b>SVIP</b>
            <span className="vipx-price gold"><Sparkles size={15} /> 5 折</span>
            <small>限时活动 / 兑换码获取</small>
          </button>
        </div>
        <p className="vipx-note">
          月卡以金币开通、到期不自动扣费；金币可通过每日签到、任务与成就获取。
        </p>

        {/* —— 兑换码 —— */}
        <div className="vipx-redeem">
          <Ticket size={17} className="vipx-redeem-ic" />
          <input value={code} placeholder="输入兑换码（礼包 / 会员天数）" enterKeyHint="done"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && redeem()} />
          <button onClick={redeem} disabled={busy === 'redeem'}>兑换</button>
        </div>

        {/* —— 更多入口 —— */}
        <button className="vipx-more" onClick={() => nav('/wallet')}>
          <Bell size={15} /> 查看钱包流水与签到 <ChevronRight size={15} />
        </button>
        <div className="vipx-bottom-space" />
      </div>

      {/* —— 吸底开通 CTA —— */}
      <div className="vipx-cta">
        {plan === 'vip30' ? (
          <button className="vipx-go" onClick={openVip} disabled={busy === 'vip'}>
            {busy === 'vip'
              ? '开通中…'
              : isVip
              ? <><Check size={16} /> 续费 {vipDays} 天 · {fmtNum(vipCost)} 金币</>
              : <><Crown size={16} /> 立即开通 · {fmtNum(vipCost)} 金币</>}
          </button>
        ) : (
          <button className="vipx-go svip" onClick={() => nav('/events')}>
            <Sparkles size={16} /> 前往活动中心了解 SVIP
          </button>
        )}
      </div>
    </div>
  );
}
