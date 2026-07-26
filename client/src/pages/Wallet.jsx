import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, CountUp, CoinIcon, DiamondIcon } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { cnToday } from '../util.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import CheckinCalendarSheet from '../components/CheckinCalendarSheet.jsx';
import { isAppMode } from '../appmode.js';
import pack60ArtUrl from '../assets/wallet-products/60.png';
import pack300ArtUrl from '../assets/wallet-products/300.png';
import pack680ArtUrl from '../assets/wallet-products/680.png';
import pack1280ArtUrl from '../assets/wallet-products/1280.png';
import pack3280ArtUrl from '../assets/wallet-products/3280.png';
import pack6480ArtUrl from '../assets/wallet-products/6480.png';
import coinCurrencyArtUrl from '../assets/wallet-products/coin-currency.png';
import diamondCurrencyArtUrl from '../assets/wallet-products/diamond-currency.png';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  BadgeInfo,
  CalendarCheck,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Crown,
  Gift,
  Headphones,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trophy,
  Wallet as WalletIcon,
} from 'lucide-react';

const APP_PACKAGE_ART = {
  60: pack60ArtUrl,
  300: pack300ArtUrl,
  680: pack680ArtUrl,
  1280: pack1280ArtUrl,
  3280: pack3280ArtUrl,
  6480: pack6480ArtUrl,
};

export default function Wallet() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exDiamond, setExDiamond] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [appSection, setAppSection] = useState('wallet');
  const [appPanel, setAppPanel] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [txFilter, setTxFilter] = useState('all'); // App 流水筛选：all | in | out | checkin
  const walletStreakRef = useRef(null);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const actionLockRef = useRef('');
  const [achPending, setAchPending] = useState(0);
  const [achGold, setAchGold] = useState(0);
  const toast = useToast();
  const nav = useNavigate();
  const { refreshUser } = useAuth();
  const appMode = isAppMode();

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await api('/economy/wallet');
      setData(next);
      return next;
    } catch (error) {
      setLoadError(error?.message || '钱包加载失败，请稍后重试');
      return null;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { api('/achievements').then(d => { setAchPending(d.summary?.claimable || 0); setAchGold(d.summary?.gold_pending || 0); }).catch(() => {}); }, []);
  const after = async () => {
    const refreshed = await load();
    await refreshUser();
    if (!refreshed) toast('操作已完成，但钱包数据刷新失败，请重试加载', 'err');
  };

  // React state is intentionally not the lock: two rapid events can arrive before
  // `busy` is committed. This ref closes that window and serializes every wallet
  // mutation (check-in, exchange and redeem) behind one synchronous guard.
  const run = (key, fn) => async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = key;
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      toast(error?.message || '操作失败，请稍后重试', 'err');
    } finally {
      actionLockRef.current = '';
      setBusy('');
    }
  };
  const checkin = run('checkin', async () => { const d = await api('/economy/checkin', { method: 'POST' }); toast(`签到成功，+${d.reward} 金币 · 连续 ${d.streak} 天`); await after(); });
  const exchange = run('exchange', async () => { const n = parseInt(exDiamond, 10); if (!n || n <= 0) throw new Error('请输入要兑换的钻石数量'); await api('/economy/exchange', { method: 'POST', body: { diamond: n } }); toast('兑换成功'); setExDiamond(''); await after(); });
  const redeem = run('redeem', async () => { if (!code.trim()) throw new Error('请输入兑换码'); await api('/economy/redeem', { method: 'POST', body: { code: code.trim() } }); toast('兑换成功'); setCode(''); await after(); });

  const Head = () => appMode ? (
    <header className="qa-wallet-head">
      <AppIconButton label="返回" onClick={() => appSection === 'recharge' ? setAppSection('wallet') : nav(-1)}><ArrowLeft size={21} /></AppIconButton>
      <div><h1>{appSection === 'recharge' ? '钻石充值' : '我的钱包'}</h1><span>{appSection === 'recharge' ? '安全支付 · 到账后可查' : '资产与权益'}</span></div>
      <AppIconButton label="钱包帮助" onClick={() => nav('/help')}><CircleHelp size={20} /></AppIconButton>
    </header>
  ) : (
    <div className="topbar">
      <div style={{ flex: 1 }}><h1>我的钱包</h1><div className="sub">金币 · 钻石 · 充值与会员权益</div></div>
    </div>
  );
  const Root = appMode ? 'main' : React.Fragment;
  const rootProps = appMode ? { className: 'qa-wallet' } : {};
  if (loading && !data) return (
    <Root {...rootProps}><Head /><div className="page" aria-hidden="true">
      <div className="skel" style={{ height: 132, marginBottom: 26 }} />
      <div className="skel" style={{ height: 120, marginBottom: 26 }} />
      <div className="skel" style={{ height: 180 }} />
    </div></Root>
  );
  if (loadError && !data) return (
    <Root {...rootProps}>
      <Head />
      <div className="page">
        {appMode ? (
          <section className="empty" role="alert" aria-live="assertive" style={{ paddingTop: 72 }}>
            <div className="big"><WalletIcon size={42} /></div>
            <h2 style={{ margin: '10px 0 6px' }}>钱包暂时无法加载</h2>
            <p className="muted" style={{ margin: '0 0 18px' }}>{loadError}</p>
            <AppButton variant="primary" className="btn primary" loading={loading} disabled={loading} onClick={() => void load()}>
              重新加载
            </AppButton>
          </section>
        ) : (
          <section className="empty lgw-error" role="alert" aria-live="assertive">
            <span className="lgw-error-ic"><WalletIcon size={22} /></span>
            <h2 className="lgw-error-title">钱包暂时无法加载</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" disabled={loading} onClick={() => void load()}>重新加载</button>
          </section>
        )}
      </div>
    </Root>
  );

  const { wallet, transactions = [], packages = [], rates = {} } = data;
  const goldPer = rates.gold_per_diamond || 100;
  const vipCost = rates.vip_cost || 30000, vipDays = rates.vip_days || 30;
  const exN = parseInt(exDiamond, 10) || 0;
  const signed = wallet.last_checkin === cnToday(); // 北京时间口径，与服务端一致
  const fmt = (n) => (n || 0).toLocaleString('en-US');
  const selectedPackage = packages.find(item => String(item.id) === String(selectedPackageId)) || packages[0] || null;

  const openWalletPanel = (panel) => {
    setAppSection('wallet');
    setAppPanel(current => current === panel ? '' : panel);
  };

  if (appMode) return (
    <main className="qa-wallet qa-wallet-v4" data-wallet-view={appSection}>
      <Head />
      <div className="page">
        {loadError && (
          <section className="wallet-load-error" role="alert" aria-live="polite">
            <span>{loadError}</span>
            <AppButton variant="tertiary" loading={loading} disabled={loading} onClick={() => void load()}>重试</AppButton>
          </section>
        )}

        {appSection === 'wallet' ? (
          <div className="qa-wallet-v4__view qa-wallet-v4__view--wallet" role="tabpanel">
            <section className="qa-wallet-v4__balance" aria-label="可用资产">
              <div className="qa-wallet-v4__balance-head">
                <div><span>可用资产</span><small>所有变动均记录在交易明细</small></div>
                <AppButton variant="secondary" className="qa-wallet-v4__recharge" onClick={() => setAppSection('recharge')}>充值</AppButton>
              </div>
              <div className="qa-wallet-v4__asset-grid">
                <div className="qa-wallet-v4__asset">
                  <span className="qa-wallet-v4__asset-icon gold"><img src={coinCurrencyArtUrl} alt="" aria-hidden="true" /></span>
                  <div><small>金币</small><strong><CountUp value={wallet.gold} /></strong></div>
                </div>
                <div className="qa-wallet-v4__asset">
                  <span className="qa-wallet-v4__asset-icon diamond"><img src={diamondCurrencyArtUrl} alt="" aria-hidden="true" /></span>
                  <div><small>钻石</small><strong><CountUp value={wallet.diamond} /></strong></div>
                </div>
              </div>
              <div className="qa-wallet-v4__membership">
                <Crown size={18} />
                <div>
                  <b>{wallet.svip ? 'SVIP 尊享会员' : wallet.vip ? 'VIP 会员' : '普通会员'}</b>
                  <span>{wallet.svip ? '平台 AI 5 折 · 至高权益' : wallet.vip ? `有效期至 ${String(wallet.vip_until || '').slice(0, 10)}` : '升级会员可享专属权益'}</span>
                </div>
                <button type="button" onClick={() => nav('/vip')} aria-label="查看会员权益"><ChevronRight size={18} /></button>
              </div>
            </section>

            <section className="qa-wallet-v4__quick" aria-label="钱包快捷操作">
              <AppButton variant="tertiary" onClick={() => document.getElementById('wallet-ledger')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span className="qa-wallet-v4__quick-icon blue"><ReceiptText size={21} /></span><span>交易记录</span></AppButton>
              <AppButton variant="tertiary" onClick={() => nav('/vip')}><span className="qa-wallet-v4__quick-icon warm"><Crown size={21} /></span><span>会员中心</span></AppButton>
              <AppButton variant="tertiary" selected={appPanel === 'exchange'} onClick={() => openWalletPanel('exchange')}><span className="qa-wallet-v4__quick-icon indigo"><ArrowDownUp size={21} /></span><span>兑换金币</span></AppButton>
              <AppButton variant="tertiary" selected={appPanel === 'redeem'} onClick={() => openWalletPanel('redeem')}><span className="qa-wallet-v4__quick-icon coral"><Gift size={21} /></span><span>兑换码</span></AppButton>
            </section>

            {achPending > 0 && (
              <AppButton variant="tertiary" className="wallet-ach qa-wallet-v4__notice" onClick={() => nav('/achievements')}>
                <span className="qa-wallet-v4__notice-icon"><Trophy size={19} /></span>
                <span className="qa-wallet-v4__notice-copy"><b>{achPending} 项成就奖励待领取</b><small>累计可领 {achGold} 金币</small></span>
                <ChevronRight size={18} />
              </AppButton>
            )}

            <AppButton variant="tertiary" className="qa-wallet-v4__checkin" disabled={signed || !!busy} loading={busy === 'checkin'} onClick={checkin}>
              <span className="qa-wallet-v4__checkin-icon"><CalendarCheck size={20} /></span>
              <span className="qa-wallet-v4__checkin-copy"><b>{signed ? '今日已签到' : '每日签到'}</b><small>{wallet.checkin_streak ? `已连续 ${wallet.checkin_streak} 天` : '签到领取金币'}</small></span>
              <span className="qa-wallet-v4__checkin-state">{signed ? <><Check size={15} /> 已完成</> : '去签到'}</span>
            </AppButton>

            {/* S7 连签周视图 + 日历入口（与今日页同款；数据即时来自钱包态） */}
            <button type="button" ref={walletStreakRef} className="qa-streak qa-streak--wallet" onClick={() => setCalOpen(true)}
              aria-label={`连续签到 ${wallet.checkin_streak || 0} 天，查看签到日历`}>
              <span className="qa-streak-dots" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <i key={i} className={'qa-streak-dot' + ((wallet.checkin_streak || 0) > 0 && i < (((wallet.checkin_streak || 0) - 1) % 7) + 1 ? ' on' : '')} />
                ))}
              </span>
              <span className="qa-streak-copy">{(wallet.checkin_streak || 0) > 0 ? `连签 ${wallet.checkin_streak} 天` : '开始你的连签'}</span>
              <span className="qa-streak-cal"><CalendarCheck size={14} aria-hidden="true" /> 日历</span>
            </button>
            {calOpen && <CheckinCalendarSheet onClose={() => setCalOpen(false)} returnFocusRef={walletStreakRef} />}

            {appPanel === 'exchange' && (
              <section className="qa-wallet-v4__panel" aria-labelledby="wallet-exchange-title">
                <div className="qa-wallet-v4__section-head"><div><h2 id="wallet-exchange-title">钻石兑换金币</h2><p>1 钻石可兑换 {goldPer} 金币</p></div><ArrowDownUp size={20} /></div>
                <label className="qa-wallet-v4__field"><span>钻石数量</span><input className="input" inputMode="numeric" type="number" min="1" placeholder="请输入数量" value={exDiamond} disabled={!!busy} onChange={event => setExDiamond(event.target.value)} /></label>
                <div className="qa-wallet-v4__exchange-result"><span>预计获得</span><strong>{fmt(exN * goldPer)} 金币</strong></div>
                <AppButton variant="primary" size="lg" loading={busy === 'exchange'} disabled={!!busy || !exN} onClick={exchange}>确认兑换</AppButton>
              </section>
            )}

            {appPanel === 'redeem' && (
              <section className="qa-wallet-v4__panel" aria-labelledby="wallet-redeem-title">
                <div className="qa-wallet-v4__section-head"><div><h2 id="wallet-redeem-title">兑换码</h2><p>兑换成功后，奖励会直接进入当前账户</p></div><Ticket size={20} /></div>
                <label className="qa-wallet-v4__field"><span>礼包或邀请码</span><input className="input" placeholder="输入兑换码" value={code} disabled={!!busy} onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !busy) redeem(); }} /></label>
                <AppButton variant="primary" size="lg" loading={busy === 'redeem'} disabled={!!busy || !code.trim()} onClick={redeem}>立即兑换</AppButton>
              </section>
            )}

            <section className="qa-wallet-v4__ledger" id="wallet-ledger" aria-labelledby="wallet-ledger-title">
              <div className="qa-wallet-v4__section-head"><div><h2 id="wallet-ledger-title">最近明细</h2><p>充值、兑换与奖励记录</p></div><ReceiptText size={20} /></div>
              <div className="qa-wallet-v4__tx-filter" role="group" aria-label="按类别筛选流水">
                {[['all', '全部'], ['in', '收入'], ['out', '支出'], ['checkin', '签到']].map(([key, label]) => (
                  <AppButton key={key} size="sm" variant="tertiary" selected={txFilter === key} pressed={txFilter === key}
                    onClick={() => setTxFilter(key)}>
                    {label}
                  </AppButton>
                ))}
              </div>
              {(() => {
                const shown = transactions.filter(t => txFilter === 'all' ? true
                  : txFilter === 'checkin' ? t.kind === 'checkin'
                    : txFilter === 'in' ? ((t.gold || 0) > 0 || (t.diamond || 0) > 0)
                      : ((t.gold || 0) < 0 || (t.diamond || 0) < 0));
                if (shown.length === 0) {
                  return <div className="qa-wallet-v4__empty"><WalletIcon size={28} /><span>{txFilter === 'all' ? '暂无交易记录' : '该类别暂无记录'}</span></div>;
                }
                return shown.map(t => (
                <article key={t.id} className="qa-wallet-v4__tx">
                  <span className={'qa-wallet-v4__tx-icon ' + (t.diamond ? 'diamond' : 'gold')}>
                    <img src={t.diamond ? diamondCurrencyArtUrl : coinCurrencyArtUrl} alt="" aria-hidden="true" />
                  </span>
                  <div className="qa-wallet-v4__tx-copy"><b>{t.memo || t.kind}</b><time>{String(t.created_at || '').slice(0, 16)}</time></div>
                  <div className="qa-wallet-v4__tx-amount">
                    {!!t.gold && <strong className={t.gold > 0 ? 'positive' : 'negative'}>{t.gold > 0 ? '+' : ''}{fmt(t.gold)}<small>金币</small></strong>}
                    {!!t.diamond && <strong className={t.diamond > 0 ? 'positive' : 'negative'}>{t.diamond > 0 ? '+' : ''}{fmt(t.diamond)}<small>钻石</small></strong>}
                  </div>
                </article>
                ));
              })()}
            </section>
          </div>
        ) : (
          <div className="qa-wallet-v4__view qa-wallet-v4__view--recharge" role="tabpanel">
            <section className="qa-wallet-v4__recharge-balance">
              <div><span>当前钻石</span><strong><img src={diamondCurrencyArtUrl} alt="" aria-hidden="true" /><CountUp value={wallet.diamond} /></strong></div>
              <ShieldCheck size={25} />
            </section>

            <section className="qa-wallet-v4__recharge-section" aria-labelledby="wallet-package-title">
              <div className="qa-wallet-v4__section-head"><div><h2 id="wallet-package-title">选择金额</h2><p>充值到账后可在交易明细中核对</p></div><BadgeInfo size={20} /></div>
              <div className="qa-wallet-v4__packages">
                {packages.length ? packages.map((item, index) => {
                  const selected = String(selectedPackage?.id) === String(item.id);
                  return (
                    <button key={item.id} type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => setSelectedPackageId(item.id)}>
                      {index === 2 && <em>推荐</em>}
                      <span className="qa-wallet-v4__gem">
                        <img src={APP_PACKAGE_ART[item.diamond] || diamondCurrencyArtUrl} alt="" aria-hidden="true" decoding="async" />
                      </span>
                      <strong>{fmt(item.diamond)}<small>钻石</small></strong>
                      {item.bonus ? <span className="reward">赠 {fmt(item.bonus)}</span> : <span className="standard">标准档</span>}
                      <b>¥ {item.cny}</b>
                    </button>
                  );
                }) : (
                  <div className="qa-wallet-v4__packages-empty"><LockKeyhole size={22} />充值套餐正在维护</div>
                )}
              </div>
            </section>

            <section className="qa-wallet-v4__recharge-section" aria-labelledby="wallet-pay-title">
              <div className="qa-wallet-v4__section-head"><div><h2 id="wallet-pay-title">支付方式</h2><p>支付通道通过安全检查后开放</p></div><CreditCard size={20} /></div>
              <div className="qa-wallet-v4__payment-list" aria-disabled="true">
                <div><span className="qa-wallet-v4__pay-icon"><CreditCard size={20} /></span><span className="qa-wallet-v4__payment-copy"><b>在线支付</b><small>服务接入中</small></span><LockKeyhole size={17} /></div>
                <div><span className="qa-wallet-v4__pay-icon support"><Headphones size={20} /></span><span className="qa-wallet-v4__payment-copy"><b>遇到问题</b><small>可在帮助中心查看说明</small></span><button type="button" onClick={() => nav('/help')} aria-label="打开帮助中心"><ChevronRight size={18} /></button></div>
              </div>
            </section>

            <section className="qa-wallet-v4__recharge-note" role="note">
              <Sparkles size={19} />
              <p><b>测试版本暂不开放充值</b><span>我们不会创建订单或请求支付。支付供应商与新健康检查全部通过后再开放。</span></p>
            </section>

            <div className="qa-wallet-v4__checkout">
              <div><span>应付金额</span><strong>{selectedPackage ? `¥ ${selectedPackage.cny}` : '—'}</strong></div>
              <AppButton variant="primary" size="lg" disabled><LockKeyhole size={18} /> 暂未开放充值</AppButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );

  return (
    <Root {...rootProps}>
      <Head />
      <div className="page">
        {loadError && (
          <section className="wallet-load-error" role="alert" aria-live="polite">
            <span>{loadError}</span>
            <AppButton variant="tertiary" loading={loading} disabled={loading} onClick={() => void load()}>重试</AppButton>
          </section>
        )}
        {achPending > 0 && (
          <AppButton as={appMode ? 'button' : 'div'} variant="tertiary" className="wallet-ach pressable" onClick={() => nav('/achievements')}>
            <span className="icon-chip gold"><Trophy size={18} /></span>
            <div style={{ flex: 1 }}><b>有 {achPending} 项成就奖励待领取</b><p>累计可领 {achGold} 金币 · 前往成就殿堂一键领取</p></div>
            <ArrowRight size={18} className="muted" />
          </AppButton>
        )}
        {/* balance hero：flow-sheen 每 6s 一道流光掠过（app-motion 层，lite 档自动关） */}
        <div className="wallet-hero flow-sheen">
          <div className="col gold">
            <span className="asset-chip gold"><CoinIcon size={46} /></span>
            <div><div className="bal-num"><CountUp value={wallet.gold} /></div><div className="bal-lbl">金币</div></div>
          </div>
          <div className="col diamond">
            <span className="asset-chip diamond"><DiamondIcon size={46} /></span>
            <div><div className="bal-num"><CountUp value={wallet.diamond} /></div><div className="bal-lbl">钻石</div></div>
          </div>
          <div className="col member">
            <span className={'icon-chip ' + (wallet.svip ? 'svip' : 'vip')}><Crown size={20} /></span>
            <div>
              {wallet.svip
                ? <><div className="bal-num" style={{ fontSize: 19 }}>SVIP 尊享</div><div className="bal-lbl">平台 AI 5 折 · 至高权益</div></>
                : wallet.vip
                ? <><div className="bal-num" style={{ fontSize: 19 }}>VIP 会员</div><div className="bal-lbl">有效期至 {String(wallet.vip_until || '').slice(0, 10)}</div></>
                : <><div className="bal-num" style={{ fontSize: 19 }}>普通会员</div><div className="bal-lbl">开通享专属权益</div></>}
            </div>
          </div>
          <AppButton variant="secondary" className="checkin-btn pressable" disabled={signed || !!busy} loading={busy === 'checkin'} onClick={checkin}>
            <CalendarCheck size={16} /> {signed ? '今日已签到' : '每日签到'}
            <span>{wallet.checkin_streak ? `连续 ${wallet.checkin_streak} 天` : '领金币'}</span>
            {/* 连签进度点：7 天一轮的视觉锚，点亮到当前 streak（含今天已签） */}
            <span className="ck-dots" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => {
                const lit = ((wallet.checkin_streak || 0) % 7 || (signed && wallet.checkin_streak ? 7 : 0)) > i;
                return <i key={i} className={lit ? 'on' : ''} />;
              })}
            </span>
          </AppButton>
        </div>

        {/* recharge (disabled in this build) */}
        <div className="section-title" style={{ marginTop: 30 }}>
          <h2>钻石充值</h2><span className="muted" style={{ fontSize: 13 }}>1 钻石 = {goldPer} 金币</span>
        </div>
        <div className="recharge-wrap">
          <div className="pkg-grid">
            {packages.map(p => (
              <div key={p.id} className="pkg" aria-disabled="true">
                <span className="icon-chip diamond sm"><DiamondIcon size={22} /></span>
                <div className="d">{p.diamond}</div>
                <div className="b">{p.bonus ? `再赠 ${p.bonus}` : '无赠送'}</div>
                <div className="pkg-pay">¥ {p.cny}</div>
              </div>
            ))}
          </div>
          <div className="recharge-mask">
            <Sparkles size={20} /><span>测试版本，暂不提供充值服务</span>
          </div>
        </div>

        {/* exchange + vip */}
        <div className="editor-grid" style={{ marginTop: 26 }}>
          <div className="card">
            <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>钻石兑换金币</h2>
            <div className="exch">
              <div className="exch-side">
                <span className="icon-chip diamond sm"><DiamondIcon size={20} /></span>
                <input className="input" type="number" min="1" placeholder="钻石数量" value={exDiamond} disabled={!!busy} onChange={e => setExDiamond(e.target.value)} />
              </div>
              <ArrowRight size={18} className="muted" style={{ flexShrink: 0 }} />
              <div className="exch-side">
                <span className="icon-chip gold sm"><CoinIcon size={20} /></span>
                <div className="exch-out">{fmt(exN * goldPer)} <span className="muted">金币</span></div>
              </div>
            </div>
            <AppButton variant="primary" className="btn primary block pressable" style={{ marginTop: 16 }} loading={busy === 'exchange'} disabled={!!busy} onClick={exchange}>确认兑换</AppButton>
          </div>

          {/* 会员开通/续费统一收口到「会员中心」（/vip）——此前钱包页内嵌一套
              独立的 VIP 购买卡，与会员中心页重复（两处渠道、两份权益文案），故删。 */}
          <AppButton variant="tertiary" className="vip-entry pressable" onClick={() => nav('/vip')}>
            <span className="icon-chip vip"><Crown size={20} /></span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <b style={{ fontSize: 15 }}>{wallet.svip ? 'SVIP 尊享会员' : wallet.vip ? 'VIP 会员' : '开通幻域会员'}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {wallet.svip ? '平台 AI 5 折 · 至高权益' : wallet.vip ? `有效期至 ${String(wallet.vip_until || '').slice(0, 10)} · 前往续费` : `低至 ${fmt(Math.round(vipCost / vipDays))} 金币/天 · 查看全部权益`}
              </div>
            </div>
            <ArrowRight size={17} className="muted" />
          </AppButton>
        </div>

        {/* redeem */}
        <div className="card" style={{ marginTop: 26, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-2)' }}><Gift size={18} /></span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <b style={{ fontSize: 15 }}>兑换码</b>
            <div className="muted" style={{ fontSize: 12.5 }}>输入礼包 / 邀请码领取金币、钻石或 VIP</div>
          </div>
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="输入兑换码" value={code} disabled={!!busy} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) redeem(); }} />
          <AppButton variant="primary" className="btn primary pressable" loading={busy === 'redeem'} disabled={!!busy} onClick={redeem}>兑换</AppButton>
        </div>

        {/* ledger */}
        <div className="section-title" style={{ marginTop: 30 }}><h2>交易流水</h2></div>
        {transactions.length === 0 ? (
          <div className="empty lgw-empty" style={{ padding: 40 }}>
            <EmptyArt kind="generic" size={116} />
            <h2 className="lgw-empty-title">暂无交易记录</h2>
            <p className="lgw-empty-sub">签到、兑换与充值的每一笔变动都会记录在这里。</p>
            <div className="lgw-empty-cta">
              {!signed && <button className="btn primary" disabled={!!busy} onClick={checkin}><CalendarCheck size={15} /> 先领一份签到金币</button>}
              {signed && <button className="btn primary" onClick={() => nav('/vip')}>看看会员权益</button>}
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: '4px 22px' }}>
            {transactions.map(t => (
              <div key={t.id} className="tx-row">
                <div><div style={{ fontWeight: 500 }}>{t.memo || t.kind}</div><div className="muted" style={{ fontSize: 12 }}>{String(t.created_at || '').slice(0, 16)}</div></div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {!!t.gold && <span className={'amt ' + (t.gold > 0 ? 'pos' : 'neg')}>{t.gold > 0 ? '+' : ''}{fmt(t.gold)} 金币</span>}
                  {!!t.diamond && <span className={'amt ' + (t.diamond > 0 ? 'pos' : 'neg')}>{t.diamond > 0 ? '+' : ''}{fmt(t.diamond)} 钻石</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Root>
  );
}
