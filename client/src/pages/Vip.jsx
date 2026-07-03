// 会员中心（App 专属）—— 与网页钱包完全分开的一套亮金视觉。
// 信息层级参考主流会员页（会员卡 hero → 权益宫格 → 套餐 → 吸底 CTA + 协议），
// 但视觉全为「幻域」自有：暖金渐变卡 + 原创「墨域酷猫」吉祥物（内联 SVG，离线可用、
// 不搬运第三方素材）。功能不变，全部走既有端点 /economy/wallet · /economy/vip · /redeem。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, CoinIcon } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { fmtNum } from '../util.js';
import {
  ArrowLeft, BadgePercent, Check, Crown, Drama, Gift, Sparkles, Ticket,
  Wallet as WalletIcon, AudioLines, BrainCircuit, ChevronRight, ShieldCheck
} from 'lucide-react';

// —— 原创吉祥物：墨域酷猫（墨黑猫 + 金色墨镜 + 星芒），纯矢量、分辨率无关、离线可用 ——
function VipMascot({ size = 128 }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const body = `mB${uid}`, lens = `mL${uid}`, sheen = `mS${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={body} cx="42%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a3a46" />
          <stop offset="60%" stopColor="#22222b" />
          <stop offset="100%" stopColor="#141419" />
        </radialGradient>
        <linearGradient id={lens} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#2a2118" />
          <stop offset="100%" stopColor="#0f0c08" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe9b0" />
          <stop offset="55%" stopColor="#f5c451" />
          <stop offset="100%" stopColor="#d99a2b" />
        </linearGradient>
      </defs>
      {/* 尾巴 */}
      <path d="M182 176c30 6 40-20 30-40-7-14-28-12-30 4" stroke="url(#body)" strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* 身体 */}
      <path d="M70 232c-14-30-16-64 4-84 24-24 60-24 84 0 20 20 18 54 4 84Z" fill={`url(#${body})`} />
      {/* 抬起的爪（比耶手势） */}
      <ellipse cx="171" cy="150" rx="16" ry="20" fill={`url(#${body})`} transform="rotate(18 171 150)" />
      {/* 头 */}
      <ellipse cx="120" cy="104" rx="70" ry="63" fill={`url(#${body})`} />
      {/* 耳朵 */}
      <path d="M60 66 66 20 106 58Z" fill={`url(#${body})`} />
      <path d="M180 66 174 20 134 58Z" fill={`url(#${body})`} />
      <path d="M70 58 73 34 92 55Z" fill="#e0973a" opacity="0.8" />
      <path d="M170 58 167 34 148 55Z" fill="#e0973a" opacity="0.8" />
      {/* 墨镜 —— 金框 + 深镜片 + 一抹弯月反光（呼应「幻域」） */}
      <rect x="52" y="92" width="60" height="40" rx="18" fill={`url(#${lens})`} stroke="url(#sheen)" strokeWidth="4" />
      <rect x="128" y="92" width="60" height="40" rx="18" fill={`url(#${lens})`} stroke="url(#sheen)" strokeWidth="4" />
      <path d="M112 108h16" stroke="url(#sheen)" strokeWidth="5" strokeLinecap="round" />
      <path d="M40 100c6-3 12-3 14 0" stroke="url(#sheen)" strokeWidth="4" strokeLinecap="round" />
      <path d="M186 100c6-3 12-3 14 0" stroke="url(#sheen)" strokeWidth="4" strokeLinecap="round" />
      {/* 镜片弯月反光 */}
      <path d="M64 100a10 10 0 1 0 10 16 8 8 0 1 1-10-16Z" fill="#ffe9b0" opacity="0.85" />
      <path d="M150 100a10 10 0 1 0 10 16 8 8 0 1 1-10-16Z" fill="#ffe9b0" opacity="0.6" />
      {/* 鼻 + 得意的嘴 */}
      <path d="M114 140h12l-6 6Z" fill="#e0973a" />
      <path d="M120 146c-6 8-16 6-18-2M120 146c6 8 16 6 18-2" stroke="#0c0a12" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      {/* 胡须 */}
      <g stroke="#c9c9d2" strokeWidth="2.4" strokeLinecap="round" opacity="0.7">
        <path d="M40 132 78 138M44 148 80 148" />
        <path d="M200 132 162 138M196 148 160 148" />
      </g>
      {/* 星芒点缀 */}
      <path d="M206 44c1.6 7 3.4 8.8 10.4 10.4-7 1.6-8.8 3.4-10.4 10.4-1.6-7-3.4-8.8-10.4-10.4 7-1.6 8.8-3.4 10.4-10.4Z" fill="url(#sheen)" />
      <circle cx="30" cy="72" r="3" fill="url(#sheen)" opacity="0.8" />
      <circle cx="214" cy="150" r="2.4" fill="url(#sheen)" opacity="0.7" />
    </svg>
  );
}

const PERKS = [
  { ic: BadgePercent, title: 'AI 对话 75 折', desc: '平台模型全线折扣' },
  { ic: Gift, title: '签到金币双倍', desc: '每日收益 ×2' },
  { ic: AudioLines, title: '语音朗读同折', desc: '平台语音 75 折' },
  { ic: Crown, title: '专属会员标识', desc: '主页评论区尊贵展示' },
  { ic: Drama, title: '剧场群聊畅玩', desc: '多人多 AI 无限开场' },
  { ic: BrainCircuit, title: '记忆与创作加成', desc: '灵感全速释放' }
];

export default function Vip() {
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(true);

  const load = () => api('/economy/wallet').then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const after = async () => { await load(); await refreshUser(); };

  const openVip = async () => {
    if (busy) return;
    if (!agree) { toast('请先阅读并同意《会员服务协议》', 'err'); return; }
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
  const perDay = Math.round(vipCost / vipDays);

  return (
    <div className={'vx2' + (app ? ' immersive' : '')}>
      <div className="vx2-top">
        <button className="vx2-back" onClick={() => nav(-1)} aria-label="返回"><ArrowLeft size={20} /></button>
        <h1>会员中心</h1>
        <button className="vx2-wallet" onClick={() => nav('/wallet')} aria-label="钱包">
          <WalletIcon size={14} /> {w ? fmtNum(w.gold) : '…'}
        </button>
      </div>

      <div className="vx2-scroll">
        {/* —— 会员卡 hero —— */}
        <div className={'vx2-card' + (isSvip ? ' svip' : isVip ? ' vip' : '')}>
          <span className="vx2-shine" aria-hidden="true" />
          <div className="vx2-card-l">
            <span className="vx2-eyebrow"><Crown size={12} /> {isSvip ? '至尊会员' : '尊享会员'}</span>
            <b className="vx2-word">{isSvip ? 'SVIP' : 'VIP'}</b>
            <p className="vx2-slogan">
              {isSvip ? '平台 AI 全线 5 折 · 至高权益'
                : isVip ? `会员有效期至 ${String(w?.vip_until || '').slice(0, 10)}`
                : '解锁幻域全部沉浸体验'}
            </p>
          </div>
          <VipMascot size={132} />
        </div>

        {/* —— 权益宫格 —— */}
        <h4 className="vx2-h">会员专享权益</h4>
        <div className="vx2-perks">
          {PERKS.map(p => (
            <div key={p.title} className="vx2-perk">
              <span className="vx2-perk-ic"><p.ic size={20} /></span>
              <div className="vx2-perk-tx"><b>{p.title}</b><small>{p.desc}</small></div>
            </div>
          ))}
        </div>

        {/* —— 套餐 —— */}
        <div className="vx2-plans">
          <div className="vx2-plan on">
            <span className="vx2-ribbon">特惠推荐</span>
            <b className="vx2-plan-name">月卡</b>
            <div className="vx2-plan-price"><CoinIcon size={20} /> {fmtNum(vipCost)}</div>
            <small className="vx2-plan-sub">{vipDays} 天 · 约 {fmtNum(perDay)} 金币/天</small>
          </div>
          <div className="vx2-plan alt" role="button" tabIndex={0}
            onClick={() => nav('/events')} onKeyDown={e => e.key === 'Enter' && nav('/events')}>
            <span className="vx2-ribbon gold">限定</span>
            <b className="vx2-plan-name">SVIP</b>
            <div className="vx2-plan-price gold"><Sparkles size={17} /> 5 折</div>
            <small className="vx2-plan-sub">活动 / 兑换码获取</small>
          </div>
        </div>

        {/* —— 兑换码 —— */}
        <div className="vx2-redeem">
          <Ticket size={17} className="vx2-redeem-ic" />
          <input value={code} placeholder="输入兑换码 · 可得会员天数 / 礼包" enterKeyHint="done"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && redeem()} />
          <button onClick={redeem} disabled={busy === 'redeem'}>兑换</button>
        </div>

        <button className="vx2-ledger" onClick={() => nav('/wallet')}>
          <WalletIcon size={15} /> 查看钱包流水与签到 <ChevronRight size={15} />
        </button>
        <div className="vx2-bottom-space" />
      </div>

      {/* —— 吸底 CTA —— */}
      <div className="vx2-cta">
        <label className="vx2-agree">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span className="vx2-check" aria-hidden="true">{agree && <Check size={12} strokeWidth={3.5} />}</span>
          <span>已阅读并同意<em>《会员服务协议与续费条款》</em></span>
        </label>
        <button className="vx2-go" onClick={openVip} disabled={busy === 'vip'}>
          {busy === 'vip'
            ? '开通中…'
            : isVip
            ? <><ShieldCheck size={17} /> 续费月卡 · {fmtNum(vipCost)} 金币</>
            : <><Crown size={17} /> 立即开通 · {fmtNum(vipCost)} 金币</>}
        </button>
        <p className="vx2-renew">金币开通 · 到期不自动扣费 · 随时安心</p>
      </div>
    </div>
  );
}
