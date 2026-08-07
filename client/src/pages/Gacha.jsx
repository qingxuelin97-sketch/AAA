import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, Modal, CoinIcon, DiamondIcon } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import coinArtUrl from '../assets/wallet-products/coin-currency.png';
import diamondArtUrl from '../assets/wallet-products/diamond-currency.png';
// 转盘美术素材（用户提供，matte 管线抠底）：底盘 8 格已含外圈灯珠、顶部 12 点
// 是分界线（与服务端 index*45° 落点模型严格对齐）；按钮面留白由代码叠「GO」。
import wheelBaseUrl from '../assets/app/wheel-base.png?url';
import wheelPointerUrl from '../assets/app/wheel-pointer.png?url';
import wheelHubUrl from '../assets/app/wheel-hub.png?url';
import creditTicketUrl from '../assets/app/credit-ticket.png?url';
import wheelBannerUrl from '../assets/app/wheel-banner.png?url';
import { Sparkles, ArrowLeft, X, ShieldCheck, RotateCw } from 'lucide-react';

// 幸运转盘（产品定案，替代旧扭蛋机）：奖品只有数字资产（金币/钻石）与
// 聊天次数卡（1 卡抵 1 次平台 AI 对话费）。摇号、权重、保底、发奖全部在
// 服务端 /gacha/spin；客户端只拿 index 播落点动画——转盘是「回放器」，
// 不是「决定器」。动画只动 transform（合成层，不卡纪律）。
const CONFETTI_COLORS = ['#ffd24a', '#ff8a3c', '#38DAD2', '#2E9FF7', '#b07cff', '#5ad2ff', '#ff6fa8'];

function PrizeIcon({ prize, size = 22 }) {
  const src = prize.kind === 'gold' ? coinArtUrl : prize.kind === 'diamond' ? diamondArtUrl : creditTicketUrl;
  return <img src={src} width={size} height={size} alt="" draggable="false" style={{ objectFit: 'contain' }} />;
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
    <>
    <img className="lw-hero" src={wheelBannerUrl} alt="" draggable="false" />
    <div className="lw-stage">
      {confetti && (
        <div className="gx-confetti" aria-hidden="true">
          {Array.from({ length: 38 }).map((_, i) => (
            <span key={i} style={{ left: Math.random() * 100 + '%', background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], animationDelay: (Math.random() * 0.35).toFixed(2) + 's', animationDuration: (1.4 + Math.random() * 0.9).toFixed(2) + 's' }} />
          ))}
        </div>
      )}
      <div className="lw-wrap" role="img" aria-label="幸运转盘">
        <img className="lw-pointer" src={wheelPointerUrl} alt="" aria-hidden="true" draggable="false" />
        <div className={'lw-wheel' + (spinning ? ' spinning' : '')} style={{ transform: `rotate(${rot}deg)` }}>
          <img className="lw-wheel-art" src={wheelBaseUrl} alt="" draggable="false" />
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
          <img className="lw-hub-art" src={wheelHubUrl} alt="" draggable="false" />
          {spinning ? <RotateCw size={22} className="lw-hub-spin" /> : <b>GO</b>}
        </button>
      </div>
    </div>
    </>
  );

  const facts = (
    <>
      <div className="lw-meta">
        <span className="lw-chip"><img src={creditTicketUrl} width={16} height={16} alt="" draggable="false" /> 聊天次数卡 <b>{credits}</b> 张</span>
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
          <button className="btn block" onClick={() => setResult(null)}>收下奖励</button>
          <button className="btn primary block" onClick={() => { setResult(null); spin(); }}>
            {freeAvailable ? '免费再转一次' : `手气再来 · ${price} 金币`}
          </button>
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
