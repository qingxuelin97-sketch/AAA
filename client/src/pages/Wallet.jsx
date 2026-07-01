import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, CountUp, CoinIcon, DiamondIcon } from '../ui.jsx';
import { cnToday } from '../util.js';
import { Crown, CalendarCheck, Gift, ArrowRight, Check, Sparkles, Wallet as WalletIcon, Trophy } from 'lucide-react';

export default function Wallet() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exDiamond, setExDiamond] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [achPending, setAchPending] = useState(0);
  const [achGold, setAchGold] = useState(0);
  const toast = useToast();
  const nav = useNavigate();
  const { refreshUser } = useAuth();

  const load = () => api('/economy/wallet').then(setData).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { api('/achievements').then(d => { setAchPending(d.summary?.claimable || 0); setAchGold(d.summary?.gold_pending || 0); }).catch(() => {}); }, []);
  const after = async () => { await load(); await refreshUser(); };

  const run = (key, fn) => async () => { setBusy(key); try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const checkin = run('checkin', async () => { const d = await api('/economy/checkin', { method: 'POST' }); toast(`签到成功，+${d.reward} 金币 · 连续 ${d.streak} 天`); await after(); });
  const exchange = run('exchange', async () => { const n = parseInt(exDiamond, 10); if (!n || n <= 0) throw new Error('请输入要兑换的钻石数量'); await api('/economy/exchange', { method: 'POST', body: { diamond: n } }); toast('兑换成功'); setExDiamond(''); await after(); });
  const openVip = run('vip', async () => { await api('/economy/vip', { method: 'POST' }); toast('VIP 已开通'); await after(); });
  const redeem = run('redeem', async () => { if (!code.trim()) throw new Error('请输入兑换码'); await api('/economy/redeem', { method: 'POST', body: { code: code.trim() } }); toast('兑换成功'); setCode(''); await after(); });

  const Head = () => (
    <div className="topbar">
      <div style={{ flex: 1 }}><h1>我的钱包</h1><div className="sub">金币 · 钻石 · 充值与会员权益</div></div>
    </div>
  );
  if (loading || !data) return <><Head /><div className="page"><div className="empty">载入中…</div></div></>;

  const { wallet, transactions = [], packages = [], rates = {} } = data;
  const goldPer = rates.gold_per_diamond || 100;
  const vipCost = rates.vip_cost || 30000, vipDays = rates.vip_days || 30;
  const exN = parseInt(exDiamond, 10) || 0;
  const signed = wallet.last_checkin === cnToday(); // 北京时间口径，与服务端一致
  const fmt = (n) => (n || 0).toLocaleString('en-US');

  return (
    <>
      <Head />
      <div className="page">
        {achPending > 0 && (
          <div className="wallet-ach" onClick={() => nav('/achievements')}>
            <span className="icon-chip gold"><Trophy size={18} /></span>
            <div style={{ flex: 1 }}><b>有 {achPending} 项成就奖励待领取</b><p>累计可领 {achGold} 金币 · 前往成就殿堂一键领取</p></div>
            <ArrowRight size={18} className="muted" />
          </div>
        )}
        {/* balance hero */}
        <div className="wallet-hero">
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
          <button className="checkin-btn" disabled={signed || busy === 'checkin'} onClick={checkin}>
            <CalendarCheck size={16} /> {signed ? '今日已签到' : '每日签到'}
            <span>{wallet.checkin_streak ? `连续 ${wallet.checkin_streak} 天` : '领金币'}</span>
          </button>
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
                <input className="input" type="number" min="1" placeholder="钻石数量" value={exDiamond} onChange={e => setExDiamond(e.target.value)} />
              </div>
              <ArrowRight size={18} className="muted" style={{ flexShrink: 0 }} />
              <div className="exch-side">
                <span className="icon-chip gold sm"><CoinIcon size={20} /></span>
                <div className="exch-out">{fmt(exN * goldPer)} <span className="muted">金币</span></div>
              </div>
            </div>
            <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy === 'exchange'} onClick={exchange}>确认兑换</button>
          </div>

          <div className="vip-card">
            <h2 style={{ margin: '0 0 6px', fontSize: 19 }}>开通 VIP 会员</h2>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{fmt(vipCost)} 金币 / {vipDays} 天</div>
            <div className="perks">
              <div className="perk"><Check size={15} /> 平台 AI 对话 75 折（SVIP 5 折）</div>
              <div className="perk"><Check size={15} /> 每日签到金币双倍</div>
              <div className="perk"><Check size={15} /> 主页专属 VIP 标识</div>
              <div className="perk"><Check size={15} /> 剧场与群聊无限畅玩</div>
            </div>
            <button className="btn primary block" disabled={busy === 'vip'} onClick={openVip}>{wallet.vip ? '续费 VIP' : '立即开通'}</button>
          </div>
        </div>

        {/* redeem */}
        <div className="card" style={{ marginTop: 26, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-2)' }}><Gift size={18} /></span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <b style={{ fontSize: 15 }}>兑换码</b>
            <div className="muted" style={{ fontSize: 12.5 }}>输入礼包 / 邀请码领取金币、钻石或 VIP</div>
          </div>
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="输入兑换码" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && redeem()} />
          <button className="btn primary" disabled={busy === 'redeem'} onClick={redeem}>兑换</button>
        </div>

        {/* ledger */}
        <div className="section-title" style={{ marginTop: 30 }}><h2>交易流水</h2></div>
        {transactions.length === 0 ? <div className="empty" style={{ padding: 40 }}><div className="big"><WalletIcon size={42} /></div>暂无交易记录</div> : (
          <div className="card" style={{ padding: '4px 22px' }}>
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
    </>
  );
}
