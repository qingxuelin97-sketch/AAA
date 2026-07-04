// 会员中心（App 专属）—— 明亮暖金主题的会员页，与网页钱包完全两套视觉。
// 采用会员页通用范式（会员卡 → 权益宫格 → 套餐档位 → 开通 CTA + 协议），
// 但品牌 / 文案 / 图标 / 配色均为「幻域」自有，纯 CSS+lucide 绘制，无第三方素材。
// 功能不变：/economy/wallet · /economy/vip（支持 plan 档位）· /economy/redeem。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, CoinIcon } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { fmtNum } from '../util.js';
import {
  ArrowLeft, BadgePercent, Gift, AudioLines, Crown, Drama, BrainCircuit,
  Check, Ticket, ChevronRight, Sparkles, HelpCircle
} from 'lucide-react';

const PERKS = [
  { ic: BadgePercent, title: 'AI 对话 75 折', desc: '平台模型全线折扣' },
  { ic: Gift, title: '签到金币双倍', desc: '每日签到收益 ×2' },
  { ic: AudioLines, title: '语音朗读同折', desc: '平台语音合成 75 折' },
  { ic: Crown, title: '专属会员标识', desc: '主页评论区尊贵展示' },
  { ic: Drama, title: '剧场群聊畅玩', desc: '多人多 AI 无限开场' },
  { ic: BrainCircuit, title: '记忆与创作加成', desc: '灵感与记忆全速释放' }
];

// 兜底档位（rates.vip_plans 缺省时用）。
const FALLBACK_PLANS = [
  { id: 'week', label: '周卡', days: 7, gold: 8000 },
  { id: 'month', label: '月卡', days: 30, gold: 30000 },
  { id: 'season', label: '季卡', days: 90, gold: 78000 }
];

export default function Vip() {
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(true);
  const [plan, setPlan] = useState('month');
  const [showRedeem, setShowRedeem] = useState(false);

  const load = () => api('/economy/wallet').then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const after = async () => { await load(); await refreshUser(); };

  const openVip = async () => {
    if (busy) return;
    if (!agree) { toast('请先阅读并同意《会员服务协议》', 'err'); return; }
    setBusy('vip');
    try { await api('/economy/vip', { method: 'POST', body: { plan } }); toast('🎉 会员已开通，尊享权益即刻生效'); await after(); }
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
  const plans = data?.rates?.vip_plans?.length ? data.rates.vip_plans : FALLBACK_PLANS;
  const cur = plans.find(p => p.id === plan) || plans[1] || plans[0];
  const isSvip = !!w?.svip;
  const isVip = !!w?.vip;

  return (
    <div className={'vm' + (app ? ' immersive' : '')}>
      <div className="vm-top">
        <button className="vm-back" onClick={() => nav(-1)} aria-label="返回"><ArrowLeft size={20} /></button>
        <h1>会员中心</h1>
        <button className="vm-help" onClick={() => nav('/help')} aria-label="帮助"><HelpCircle size={18} /></button>
      </div>

      <div className="vm-scroll">
        {/* —— 会员卡 —— */}
        <div className={'vm-card' + (isSvip ? ' svip' : '')}>
          <span className="vm-card-pat" aria-hidden="true" />
          <span className="vm-card-shine" aria-hidden="true" />
          <div className="vm-card-body">
            <b className="vm-word">{isSvip ? 'SVIP' : 'VIP'}</b>
            <span className="vm-card-sub">
              {isSvip ? '至高权益 · 平台 AI 全线 5 折'
                : isVip ? `会员有效期至 ${String(w?.vip_until || '').slice(0, 10)}`
                : '解锁幻域全部沉浸体验'}
            </span>
          </div>
          <span className="vm-card-deco" aria-hidden="true">
            <Crown size={30} />
            <i className="vm-spark s1" /><i className="vm-spark s2" /><i className="vm-spark s3" />
          </span>
        </div>

        {/* —— 权益宫格 —— */}
        <div className="vm-perks">
          {PERKS.map(p => (
            <div key={p.title} className="vm-perk">
              <span className="vm-perk-ic"><p.ic size={20} /></span>
              <div className="vm-perk-tx"><b>{p.title}</b><small>{p.desc}</small></div>
            </div>
          ))}
        </div>

        {/* —— 套餐 + 开通（白色承载卡）—— */}
        <div className="vm-sheet">
          <div className="vm-sheet-head">
            <span className="vm-tag">特惠推荐</span>
            <button className="vm-redeem-link" onClick={() => setShowRedeem(s => !s)}>
              <Ticket size={13} /> 兑换码
            </button>
          </div>

          <div className="vm-plans">
            {plans.map(p => {
              const per = Math.round(p.gold / p.days);
              const on = p.id === plan;
              const rec = p.id === 'month';
              return (
                <button key={p.id} className={'vm-plan' + (on ? ' on' : '')} onClick={() => setPlan(p.id)}>
                  {rec && <span className="vm-plan-rec">超值</span>}
                  <b className="vm-plan-name">{p.label}</b>
                  <span className="vm-plan-price"><CoinIcon size={15} /> {fmtNum(p.gold)}</span>
                  <small className="vm-plan-per">约 {fmtNum(per)}/天</small>
                </button>
              );
            })}
          </div>

          {showRedeem && (
            <div className="vm-redeem">
              <Ticket size={16} className="vm-redeem-ic" />
              <input value={code} placeholder="输入兑换码 · 可得会员天数 / 礼包" enterKeyHint="done"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && redeem()} />
              <button onClick={redeem} disabled={busy === 'redeem'}>兑换</button>
            </div>
          )}

          <p className="vm-renew">金币开通 · 到期不自动扣费 · 随时安心</p>

          <button className="vm-go" onClick={openVip} disabled={busy === 'vip'}>
            {busy === 'vip'
              ? '开通中…'
              : <>{isVip ? '续费' : '立即开通'} {cur?.label} · <CoinIcon size={16} /> {fmtNum(cur?.gold)}</>}
          </button>

          <label className="vm-agree">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span className="vm-check" aria-hidden="true">{agree && <Check size={11} strokeWidth={3.5} />}</span>
            <span>已阅读并同意<em>《幻域会员服务协议与续费条款》</em></span>
          </label>
        </div>

        <button className="vm-ledger" onClick={() => nav('/wallet')}>
          <Sparkles size={14} /> 查看钱包流水与每日签到 <ChevronRight size={14} />
        </button>
        <div className="vm-bottom-space" />
      </div>
    </div>
  );
}
