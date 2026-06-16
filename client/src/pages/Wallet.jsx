import React, { useEffect, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Coins, Gem, Crown, Calendar, Gift } from 'lucide-react';

export default function Wallet() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exDiamond, setExDiamond] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const { refreshUser } = useAuth();

  const load = () =>
    api('/economy/wallet')
      .then(d => setData(d))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const after = async () => { await load(); await refreshUser(); };

  const checkin = async () => {
    setBusy('checkin');
    try {
      const d = await api('/economy/checkin', { method: 'POST' });
      toast(`签到成功 +${d.reward}，连续 ${d.streak} 天`);
      await after();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(''); }
  };

  const recharge = async (pkg) => {
    setBusy('pkg' + pkg.id);
    try {
      await api('/economy/recharge', { method: 'POST', body: { package_id: pkg.id } });
      toast('充值成功(演示)');
      await after();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(''); }
  };

  const exchange = async () => {
    const n = parseInt(exDiamond, 10);
    if (!n || n <= 0) { toast('请输入要兑换的钻石数量', 'err'); return; }
    setBusy('exchange');
    try {
      await api('/economy/exchange', { method: 'POST', body: { diamond: n } });
      toast('兑换成功');
      setExDiamond('');
      await after();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(''); }
  };

  const openVip = async () => {
    setBusy('vip');
    try {
      await api('/economy/vip', { method: 'POST' });
      toast('VIP 开通成功');
      await after();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(''); }
  };

  const redeem = async () => {
    if (!code.trim()) { toast('请输入兑换码', 'err'); return; }
    setBusy('redeem');
    try {
      await api('/economy/redeem', { method: 'POST', body: { code: code.trim() } });
      toast('兑换码使用成功');
      setCode('');
      await after();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(''); }
  };

  if (loading) {
    return (
      <>
        <div className="topbar"><div style={{ flex: 1 }}><h1>我的钱包</h1><div className="sub">金币 · 钻石 · 充值与会员</div></div></div>
        <div className="page"><div className="empty">载入中…</div></div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <div className="topbar"><div style={{ flex: 1 }}><h1>我的钱包</h1><div className="sub">金币 · 钻石 · 充值与会员</div></div></div>
        <div className="page"><div className="empty"><div className="big">💸</div>无法加载钱包</div></div>
      </>
    );
  }

  const { wallet, transactions = [], packages = [], rates = {} } = data;
  const goldPer = rates.gold_per_diamond || 100;
  const exN = parseInt(exDiamond, 10) || 0;
  const fmtDate = (s) => (s ? String(s).slice(0, 10) : '');

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的钱包</h1>
          <div className="sub">金币 · 钻石 · 充值与会员</div>
        </div>
        <button className="btn" disabled={busy === 'checkin'} onClick={checkin}>
          <Calendar size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          每日签到{wallet.checkin_streak ? `（连续 ${wallet.checkin_streak} 天）` : ''}
        </button>
      </div>

      <div className="page">
        <div className="grid" style={{ marginBottom: 22 }}>
          <div className="card">
            <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={18} className="coin gold" /> 金币
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, marginTop: 8 }}>{wallet.gold}</div>
          </div>
          <div className="card">
            <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gem size={18} className="coin diamond" /> 钻石
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, marginTop: 8 }}>{wallet.diamond}</div>
          </div>
          <div className="card">
            <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Crown size={18} /> 会员
            </div>
            <div style={{ marginTop: 8 }}>
              {wallet.vip ? (
                <div>
                  <span className="vip-badge"><Crown size={13} style={{ verticalAlign: '-2px' }} /> VIP</span>
                  <div className="muted" style={{ marginTop: 8 }}>有效期至 {fmtDate(wallet.vip_until)}</div>
                </div>
              ) : (
                <div className="muted">未开通 VIP</div>
              )}
            </div>
          </div>
        </div>

        <div className="section-title"><h2>钻石充值</h2></div>
        <div className="pkg-grid" style={{ marginBottom: 26 }}>
          {packages.map(p => (
            <div key={p.id} className="pkg" onClick={() => busy !== 'pkg' + p.id && recharge(p)} style={{ cursor: 'pointer' }}>
              <div className="d"><Gem size={16} className="coin diamond" style={{ verticalAlign: '-2px', marginRight: 4 }} />{p.diamond}</div>
              {p.bonus ? <div className="b">+赠{p.bonus}</div> : null}
              <div className="cny">¥{p.cny}</div>
            </div>
          ))}
        </div>

        <div className="grid" style={{ marginBottom: 26 }}>
          <div className="card">
            <div className="section-title"><h2>钻石兑换金币</h2></div>
            <div className="field">
              <label>兑换钻石数量</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="输入钻石数量"
                value={exDiamond}
                onChange={e => setExDiamond(e.target.value)}
              />
            </div>
            <div className="muted" style={{ margin: '6px 0 12px' }}>= {exN * goldPer} 金币</div>
            <button className="btn primary block" disabled={busy === 'exchange'} onClick={exchange}>兑换金币</button>
          </div>

          <div className="vip-card">
            <div className="section-title"><h2><Crown size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />开通 VIP</h2></div>
            <p className="muted">{rates.vip_cost || 30000} 金币 / {rates.vip_days || 30} 天</p>
            <ul className="muted" style={{ margin: '10px 0', paddingLeft: 18, lineHeight: 1.9 }}>
              <li>签到双倍奖励</li>
              <li>专属 VIP 标识</li>
              <li>无限剧场畅玩</li>
            </ul>
            <button className="btn primary block" disabled={busy === 'vip'} onClick={openVip}>
              {wallet.vip ? '续费 VIP' : '立即开通'}
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 26 }}>
          <div className="section-title"><h2><Gift size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />兑换码</h2></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="输入兑换码"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && redeem()}
            />
            <button className="btn primary" disabled={busy === 'redeem'} onClick={redeem}>兑换</button>
          </div>
        </div>

        <div className="section-title"><h2>交易流水</h2></div>
        {transactions.length === 0 ? (
          <div className="empty"><div className="big">🧾</div>暂无交易记录</div>
        ) : (
          <div className="card">
            {transactions.map(t => {
              const gold = t.gold || 0;
              const diamond = t.diamond || 0;
              return (
                <div key={t.id} className="tx-row">
                  <div>
                    <div>{t.memo || t.kind}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmtDate(t.created_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {gold !== 0 && (
                      <div className={'amt ' + (gold > 0 ? 'pos' : 'neg')}>
                        {gold > 0 ? '+' : ''}{gold} <Coins size={13} className="coin gold" style={{ verticalAlign: '-2px' }} />
                      </div>
                    )}
                    {diamond !== 0 && (
                      <div className={'amt ' + (diamond > 0 ? 'pos' : 'neg')}>
                        {diamond > 0 ? '+' : ''}{diamond} <Gem size={13} className="coin diamond" style={{ verticalAlign: '-2px' }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
