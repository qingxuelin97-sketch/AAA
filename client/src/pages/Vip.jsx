// 会员中心（App 专属）—— 明亮暖金主题的会员页，与网页钱包完全两套视觉。
// 采用会员页通用范式（会员卡 → 权益宫格 → 套餐档位 → 开通 CTA + 协议），
// 但品牌 / 文案 / 图标 / 配色均为「幻域」自有，纯 CSS+lucide 绘制，无第三方素材。
// 功能不变：/economy/wallet · /economy/vip（支持 plan 档位）· /economy/redeem。
import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, CoinIcon } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { fmtNum } from '../util.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import {
  ArrowLeft, BadgePercent, Gift, AudioLines, Crown, Drama, BrainCircuit,
  Check, Ticket, ChevronRight, Sparkles, HelpCircle
} from 'lucide-react';

const PERKS = [
  { ic: BadgePercent, title: 'AI 对话', desc: '平台模型全线折扣', discounted: true },
  { ic: Gift, title: '签到金币双倍', desc: '每日签到收益 ×2' },
  { ic: AudioLines, title: '语音朗读', desc: '平台语音合成同享折扣', discounted: true },
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const purchaseLockRef = useRef(false);
  const [agree, setAgree] = useState(true);
  const [plan, setPlan] = useState('month');

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await api('/economy/wallet');
      setData(next);
      return next;
    } catch (error) {
      setLoadError(error?.message || '会员信息加载失败，请稍后重试');
      return null;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);
  const after = async () => {
    const refreshed = await load();
    await refreshUser();
    if (!refreshed) toast('会员已开通，但最新状态加载失败，请重试', 'err');
  };

  const openVip = async () => {
    if (purchaseLockRef.current || busy || !data || loadError) return;
    if (data.wallet?.svip) { toast('当前已是 SVIP，无需重复购买 VIP', 'info'); return; }
    if (!agree) { toast('请先阅读并同意《会员服务协议》', 'err'); return; }
    purchaseLockRef.current = true;
    setBusy('vip');
    try { await api('/economy/vip', { method: 'POST', body: { plan } }); toast('🎉 会员已开通，尊享权益即刻生效'); await after(); }
    catch (e) { toast(e.message, 'err'); }
    finally { purchaseLockRef.current = false; setBusy(''); }
  };

  const app = isAppMode();
  const rootClassName = 'vm' + (app ? ' immersive qa-vip' : '');
  const Head = () => (
    <div className="vm-top">
      <AppIconButton className="vm-back" label="返回" aria-label="返回" onClick={() => nav(-1)}><ArrowLeft size={20} /></AppIconButton>
      <h1>会员中心</h1>
      <AppIconButton className="vm-help" label="帮助" aria-label="帮助" onClick={() => nav('/help')}><HelpCircle size={18} /></AppIconButton>
    </div>
  );
  if (loading && !data) return (
    <div className={rootClassName}>
      <Head />
      <div className="vm-scroll" role="status" aria-label="正在加载会员信息">
        <div className="skel" style={{ height: 180, margin: '18px 16px' }} aria-hidden="true" />
      </div>
    </div>
  );
  if (loadError || !data) return (
    <div className={rootClassName}>
      <Head />
      <div className="vm-scroll">
        <section className="empty" role="alert" aria-live="assertive" style={{ padding: '72px 20px' }}>
          <div className="big"><Crown size={42} /></div>
          <h2 style={{ margin: '10px 0 6px' }}>会员信息暂时无法加载</h2>
          <p className="muted" style={{ margin: '0 0 18px' }}>{loadError || '请稍后重试'}</p>
          <AppButton variant="primary" className="btn primary" loading={loading} disabled={loading} onClick={() => void load()}>
            重新加载
          </AppButton>
        </section>
      </div>
    </div>
  );
  const w = data?.wallet;
  const plans = data?.rates?.vip_plans?.length ? data.rates.vip_plans : FALLBACK_PLANS;
  const cur = plans.find(p => p.id === plan) || plans[1] || plans[0];
  const isSvip = !!w?.svip;
  const isVip = !!w?.vip;
  const discountLabel = isSvip ? '5 折' : '7.5 折';

  return (
    <div className={rootClassName}>
      <Head />

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
              <div className="vm-perk-tx">
                <b>{p.discounted ? `${p.title} ${discountLabel}` : p.title}</b>
                <small>{p.discounted ? `${p.desc} · ${discountLabel}` : p.desc}</small>
              </div>
            </div>
          ))}
        </div>

        {/* —— 套餐 + 开通（白色承载卡）—— */}
        <div className="vm-sheet">
          <div className="vm-sheet-head">
            <span className="vm-tag">特惠推荐</span>
            {/* 兑换码入口统一收口到钱包页（此前两页各带一套兑换 UI，重复） */}
            <AppButton className="vm-redeem-link" variant="tertiary" onClick={() => nav('/wallet')}>
              <Ticket size={13} /> 兑换码
            </AppButton>
          </div>

          <div className="vm-plans">
            {plans.map(p => {
              const per = Math.round(p.gold / p.days);
              const on = p.id === plan;
              const rec = p.id === 'month';
              return (
                <AppButton
                  key={p.id}
                  className={'vm-plan' + (on ? ' on' : '')}
                  variant="tertiary"
                  selected={on}
                  pressed={on}
                  aria-label={`${p.label}，${fmtNum(p.gold)} 金币，约 ${fmtNum(per)} 金币每天`}
                  disabled={isSvip || !!busy}
                  onClick={() => setPlan(p.id)}
                >
                  {rec && <span className="vm-plan-rec">超值</span>}
                  <b className="vm-plan-name">{p.label}</b>
                  <span className="vm-plan-price"><CoinIcon size={15} /> {fmtNum(p.gold)}</span>
                  <small className="vm-plan-per">约 {fmtNum(per)}/天</small>
                </AppButton>
              );
            })}
          </div>

          <p className="vm-renew">
            {isSvip ? 'SVIP 已生效 · 无需重复购买 VIP' : '金币开通 · 到期不自动扣费 · 随时安心'}
          </p>

          <AppButton className="vm-go" variant="primary" size="lg" loading={busy === 'vip'} onClick={openVip} disabled={isSvip || !!busy}>
            {isSvip
              ? 'SVIP 权益已生效'
              : busy === 'vip'
              ? '开通中…'
              : <>{isVip ? '续费 VIP' : '开通 VIP'} {cur?.label} · <CoinIcon size={16} /> {fmtNum(cur?.gold)}</>}
          </AppButton>

          {!isSvip && <label className="vm-agree">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span className="vm-check" aria-hidden="true">{agree && <Check size={11} strokeWidth={3.5} />}</span>
            <span>已阅读并同意<em>《幻域会员服务协议与续费条款》</em></span>
          </label>}
        </div>

        <AppButton className="vm-ledger" variant="tertiary" onClick={() => nav('/wallet')}>
          <Sparkles size={14} /> 查看钱包流水与每日签到 <ChevronRight size={14} />
        </AppButton>
        <div className="vm-bottom-space" />
      </div>
    </div>
  );
}
