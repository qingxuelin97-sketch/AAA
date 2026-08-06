import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, Modal, CoinIcon, DiamondIcon } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import coinArtUrl from '../assets/wallet-products/coin-currency.png';
import diamondArtUrl from '../assets/wallet-products/diamond-currency.png';
import { Sparkles, ArrowLeft, X, ShieldCheck, Ticket, RotateCw } from 'lucide-react';

// 幸运转盘（产品定案，替代旧扭蛋机）：奖品只有数字资产（金币/钻石）与
// 聊天次数卡（1 卡抵 1 次平台 AI 对话费）。摇号、权重、保底、发奖全部在
// 服务端 /gacha/spin；客户端只拿 index 播落点动画——转盘是「回放器」，
// 不是「决定器」。动画只动 transform（合成层，不卡纪律）。
const CONFETTI_COLORS = ['#ffd24a', '#ff8a3c', '#38DAD2', '#2E9FF7', '#b07cff', '#5ad2ff', '#ff6fa8'];
const SEG_COLORS = {
  gold: ['#FFF3D6', '#FFE6AE'],      // 金币档：暖金
  diamond: ['#D9F6FF', '#B7E9FF'],   // 钻石档：冰蓝
  credit: ['#EFE4FF', '#DFD0FF'],    // 聊天卡档：淡紫
};
const segColor = (p, i) => (SEG_COLORS[p.kind] || SEG_COLORS.gold)[i % 2];

function PrizeIcon({ prize, size = 22 }) {
  if (prize.kind === 'gold') return <img src={coinArtUrl} width={size} height={size} alt="" draggable="false" />;
  if (prize.kind === 'diamond') return <img src={diamondArtUrl} width={size} height={size} alt="" draggable="false" />;
  return <Ticket size={size} aria-hidden="true" />;   // 聊天次数卡（待专属 PNG 素材）
}

export default function Gacha() {
  const toast = useToast();
  const nav = useNavigate();
  const appMode = isAppMode();
  const { refreshUser } = useAuth();
  const [gstate, setGstate] = useState(null);  // 服务端状态：奖品表/免费额度/保底/次数卡
  const [rot, setRot] = useState(0);           // 转盘累计角度（只增不减，transform 合成层动画）
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);  // 最近一次奖品（落点动画结束后揭晓）
  const [confetti, setConfetti] = useState(false);
  const [count, setCount] = useState(0);
  const settleRef = useRef(null);

  const prizes = gstate?.prizes || [];
  const freeAvailable = !!gstate?.free_available;
  const price = gstate?.paid_price ?? 100;
  const pity = gstate?.pity ?? 0;
  const guarantee = gstate?.guarantee ?? 10;
  const credits = gstate?.chat_credits ?? 0;

  useEffect(() => { api('/gacha/state').then(setGstate).catch(() => {}); }, []);

  const spin = async () => {
    if (spinning || !gstate) return;
    setSpinning(true); setResult(null);
    try {
      const d = await api('/gacha/spin', { method: 'POST', body: { use: freeAvailable ? 'free' : 'paid' } });
      if (d.used === 'paid') refreshUser?.();
      // 落点：第 index 格中心（index*45+22.5°）转到顶部指针下，外加 4 整圈悬念
      const target = d.index * 45 + 22.5;
      setRot(r => r + 4 * 360 + (((360 - target) - (r % 360)) + 360) % 360);
      const reveal = () => {
        clearTimeout(settleRef.current); settleRef.current = null;
        setSpinning(false); setCount(c => c + 1);
        setGstate(s => (s ? { ...s, pity: d.pity, free_available: d.free_available, chat_credits: d.chat_credits,
          gold: d.wallet?.gold ?? s.gold } : s));
        setResult(d.prize);
        refreshUser?.();
        if (d.prize.jackpot) { setConfetti(false); requestAnimationFrame(() => setConfetti(true)); setTimeout(() => setConfetti(false), 2400); }
      };
      // 计时揭晓（与 CSS 3.4s 过渡对齐；不用 transitionend——后台标签页不可靠）
      settleRef.current = setTimeout(reveal, 3450);
    } catch (e) { setSpinning(false); toast(e.message, 'err'); }
  };
  useEffect(() => () => clearTimeout(settleRef.current), []);

  const wheel = (
    <div className="lw-stage">
      {confetti && (
        <div className="gx-confetti" aria-hidden="true">
          {Array.from({ length: 38 }).map((_, i) => (
            <span key={i} style={{ left: Math.random() * 100 + '%', background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], animationDelay: (Math.random() * 0.35).toFixed(2) + 's', animationDuration: (1.4 + Math.random() * 0.9).toFixed(2) + 's' }} />
          ))}
        </div>
      )}
      <div className="lw-wrap" role="img" aria-label="幸运转盘">
        <span className="lw-pointer" aria-hidden="true" />
        <div className={'lw-wheel' + (spinning ? ' spinning' : '')}
          style={{ transform: `rotate(${rot}deg)`, '--lw-conic': `conic-gradient(${prizes.map((p, i) => `${segColor(p, i)} ${i * 45}deg ${(i + 1) * 45}deg`).join(', ')})` }}>
          {prizes.map((p, i) => (
            <span key={p.id} className={'lw-seg' + (p.jackpot ? ' jackpot' : '')} style={{ transform: `rotate(${i * 45 + 22.5}deg)` }}>
              <i className="lw-seg-inner">
                <PrizeIcon prize={p} size={20} />
                <b>×{p.amount}</b>
              </i>
            </span>
          ))}
        </div>
        <button className="lw-hub" onClick={spin} disabled={spinning || !gstate} aria-label={freeAvailable ? '免费转一次' : `${price} 金币转一次`}>
          {spinning ? <RotateCw size={20} className="lw-hub-spin" /> : <b>GO</b>}
        </button>
      </div>
    </div>
  );

  const facts = (
    <>
      <div className="lw-meta">
        <span className="lw-chip"><Ticket size={14} /> 聊天次数卡 <b>{credits}</b> 张</span>
        <span className="lw-chip"><ShieldCheck size={14} /> 稀有保底 <b>{pity}/{guarantee}</b></span>
      </div>
      <AppButton className="lw-spin-cta" variant="primary" size="lg" loading={spinning} disabled={!gstate} onClick={spin}>
        {freeAvailable ? <><Sparkles size={18} /> 今日免费转一次</> : <>用 <CoinIcon size={15} /> {price} 转一次</>}
      </AppButton>
      <section className="lw-rates" aria-label="奖品与概率">
        <div className="lw-rates-head"><h2>奖品与概率</h2><span>每转独立计算 · {guarantee} 次内必中稀有</span></div>
        <ul>
          {prizes.map(p => (
            <li key={p.id} data-kind={p.kind} className={p.jackpot ? 'jackpot' : ''}>
              <PrizeIcon prize={p} size={16} />
              <span>{p.label}</span>
              <b>{p.weight}%</b>
            </li>
          ))}
        </ul>
        <p className="lw-note">聊天次数卡：1 张自动抵扣 1 次平台 AI 对话费用（自带 API 的对话本就免费，不消耗卡）。</p>
      </section>
    </>
  );

  const resultModal = result && (
    <Modal onClose={() => setResult(null)} className={appMode ? 'qa-gacha-result-modal' : undefined} backdropClassName={appMode ? 'qa-gacha-result-backdrop' : undefined}>
      <div className="lw-result" data-kind={result.kind}>
        <span className="lw-result-ic"><PrizeIcon prize={result} size={54} /></span>
        <h2>{result.jackpot ? '大奖！' : '恭喜中奖'}</h2>
        <p className="lw-result-label">{result.label}</p>
        <p className="muted lw-result-sub">
          {result.kind === 'gold' ? '金币已入账，可在钱包查看明细。'
            : result.kind === 'diamond' ? '钻石已入账，可在钱包查看明细。'
            : `已存入次数卡余额（现有 ${credits} 张），平台 AI 对话时自动抵扣。`}
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn block" onClick={() => setResult(null)}>{freeAvailable ? '收下' : '再转一次'}</button>
          {!freeAvailable && <button className="btn primary block" onClick={() => { setResult(null); spin(); }}>用 {price} 金币再转</button>}
        </div>
      </div>
    </Modal>
  );

  if (appMode) {
    return (
      <main className="qa-gacha-page lw-page">
        <header className="qa-gacha-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-gacha-head-title"><h1>幸运转盘</h1><span>每日免费一转</span></div>
          <span className="qa-gacha-head-spacer" aria-hidden="true" />
        </header>
        <div className="qa-gacha-body">
          {wheel}
          {facts}
        </div>
        {resultModal}
      </main>
    );
  }

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>幸运转盘</h1><div className="sub">每日免费一转 · 金币 / 钻石 / 聊天次数卡{count > 0 ? ` · 已转 ${count} 次` : ''}</div></div>
      </div>
      <div className="page lw-page" style={{ maxWidth: 720 }}>
        {wheel}
        {facts}
        {resultModal}
      </div>
    </>
  );
}
