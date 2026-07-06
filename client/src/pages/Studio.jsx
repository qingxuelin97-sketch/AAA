import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Avatar, CountUp, CoinIcon } from '../ui.jsx';
import { BarChart, LineChart } from '../components/Charts.jsx';
import { Eye, Heart, Star, Play, Users, Drama, ScrollText, TrendingUp, Sparkles, BarChart3, LineChart as LineIcon, Gift, Crown, Check, ChevronRight, Coins, TrendingDown, Calendar } from 'lucide-react';

const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n ?? 0));

export default function Studio() {
  const toast = useToast();
  const nav = useNavigate();
  const { refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('analytics');
  const [claiming, setClaiming] = useState(false);

  const load = () => api('/me/studio').then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  if (!data) return <><div className="topbar"><div style={{ flex: 1 }}><h1>创作中心</h1><div className="sub">作品数据、收益分析与创作者分成计划</div></div></div><div className="page"><div className="empty">载入中…</div></div></>;
  const t = data.totals;
  const plan = data.revenue_plan;

  const cards = [
    { ic: Eye, label: '角色总浏览', val: t.char_uses, accent: '#3f8195' },
    { ic: Heart, label: '角色总点赞', val: t.char_likes, accent: '#d4677a' },
    { ic: Star, label: '被收藏', val: t.char_favs, accent: '#c9962f' },
    { ic: Play, label: '剧本游玩', val: t.script_plays, accent: '#6a8a52' },
    { ic: CoinIcon, label: '剧本收入', val: t.gold_earned, accent: '#c8853f', gold: true },
    { ic: Users, label: '粉丝', val: t.followers, accent: '#7a6bd0' },
  ];

  const topChars = data.characters.slice(0, 8).map(c => ({ label: c.name.slice(0, 4), value: c.uses }));
  const topLikes = data.characters.slice(0, 8).map(c => ({ label: c.name.slice(0, 4), value: c.likes }));
  const incomeLine = (data.series || []).map(d => ({ x: d.date, y: d.gold }));

  const claim = async () => {
    setClaiming(true);
    try { const d = await api('/me/revenue-plan/claim', { method: 'POST' }); toast(`已领取分成 ${d.reward} 金币`); await refreshUser(); load(); }
    catch (e) { toast(e.message, 'err'); } finally { setClaiming(false); }
  };

  const TABS = [['analytics', '数据分析', BarChart3], ['revenue', '收益分成', Gift], ['characters', `角色 ${data.characters.length}`, Drama], ['scripts', `剧本 ${data.scripts.length}`, ScrollText]];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1><TrendingUp size={20} style={{ verticalAlign: -3, marginRight: 6 }} />创作中心</h1>
          <div className="sub">作品数据、收益分析与创作者分成计划</div></div>
        <button className="btn primary" onClick={() => nav('/publish')}><Sparkles size={15} /> 发布新作品</button>
      </div>

      <div className="page">
        <div className="studio-cards">
          {cards.map((c, i) => (
            <div key={i} className="studio-card">
              <span className="sc-ic" style={{ background: c.accent + '22', color: c.accent }}><c.ic size={18} /></span>
              <div><b className={c.gold ? 'gold-num' : ''}><CountUp value={c.val} /></b><span>{c.label}</span></div>
            </div>
          ))}
        </div>

        <div className="tabs-bar" style={{ marginTop: 22 }}>
          {TABS.map(([k, l, Ic]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Ic size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{l}</button>)}
        </div>

        {tab === 'analytics' && (
          <div className="studio-analytics">
            {/* 金币收入概览——汇总卡片 */}
            {(() => {
              const total = (data.series || []).reduce((s, d) => s + (d.gold || 0), 0);
              const sellT = (data.series || []).reduce((s, d) => s + (d.sell_script || 0), 0);
              const shareT = (data.series || []).reduce((s, d) => s + (d.revenue_share || 0), 0);
              const otherT = (data.series || []).reduce((s, d) => s + (d.other || 0), 0);
              const peak = (data.series || []).reduce((m, d) => (d.gold > m.gold ? d : m), { gold: 0, date: '—' });
              const avg = total / Math.max(1, (data.series || []).filter(d => d.gold > 0).length || 1);
              return (
                <div className="inc-summary">
                  <div className="card inc-hero">
                    <div className="inc-hero-l">
                      <div className="inc-hero-label"><Coins size={14} /> 近 14 天总收入</div>
                      <b className="gold-num inc-hero-num"><CountUp value={total} /></b>
                      <div className="inc-hero-sub">
                        <span><TrendingUp size={12} /> 日均 {Math.round(avg)}</span>
                        <span>峰值 {peak.gold}（{peak.date}）</span>
                      </div>
                    </div>
                    {/* 收入构成——堆叠条 */}
                    <div className="inc-breakdown">
                      <div className="inc-bd-title">收入构成</div>
                      <div className="inc-stack">
                        {total > 0 ? <>
                          {sellT > 0 && <div className="inc-seg sell" style={{ width: (sellT / total * 100) + '%' }} title={`剧本销售 ${sellT}`} />}
                          {shareT > 0 && <div className="inc-seg share" style={{ width: (shareT / total * 100) + '%' }} title={`分成领取 ${shareT}`} />}
                          {otherT > 0 && <div className="inc-seg other" style={{ width: (otherT / total * 100) + '%' }} title={`其他 ${otherT}`} />}
                        </> : <div className="inc-seg empty" style={{ width: '100%' }} />}
                      </div>
                      <div className="inc-legend">
                        <span className="il sell"><i /> 剧本销售 <b>{sellT}</b></span>
                        <span className="il share"><i /> 分成领取 <b>{shareT}</b></span>
                        <span className="il other"><i /> 其他 <b>{otherT}</b></span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 趋势折线图 */}
            <div className="card chart-card">
              <div className="section-title"><h2><LineIcon size={16} style={{ verticalAlign: -3, marginRight: 6 }} />近 14 天金币收入趋势</h2></div>
              <LineChart data={incomeLine} color="var(--gold)" unit=" 金" />
            </div>

            {/* 每日明细列表——显示「每段情况」 */}
            <div className="card inc-detail-card">
              <div className="section-title"><h2><Calendar size={15} style={{ verticalAlign: -3, marginRight: 6 }} />每日收入明细</h2></div>
              <div className="inc-detail-head">
                <span>日期</span>
                <span>剧本销售</span>
                <span>分成领取</span>
                <span>其他</span>
                <span>合计</span>
              </div>
              <div className="inc-detail-body">
                {[...(data.series || [])].reverse().map((d, i) => (
                  <div key={i} className={'inc-detail-row' + (d.gold > 0 ? '' : ' zero')}>
                    <span className="idr-date">{d.date}</span>
                    <span className="gold-num">{d.sell_script || 0}</span>
                    <span className="gold-num">{d.revenue_share || 0}</span>
                    <span className="gold-num">{d.other || 0}</span>
                    <span className="idr-total gold-num">{d.gold || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-grid">
              <div className="card chart-card">
                <div className="section-title"><h2><Eye size={15} style={{ verticalAlign: -3, marginRight: 6 }} />角色浏览 TOP</h2></div>
                <BarChart data={topChars} color="var(--diamond)" />
              </div>
              <div className="card chart-card">
                <div className="section-title"><h2><Heart size={15} style={{ verticalAlign: -3, marginRight: 6 }} />角色点赞 TOP</h2></div>
                <BarChart data={topLikes} color="var(--accent)" />
              </div>
            </div>
          </div>
        )}

        {tab === 'revenue' && plan && (
          <div className="rev-plan">
            <div className="card rev-hero">
              <div className="rev-hero-top">
                <div>
                  <div className="rev-tier"><Crown size={15} /> {plan.tier_name} · 分成 {Math.round(plan.rate * 100)}%</div>
                  <div className="rev-est">可领取 <b className="gold-num">{plan.claimable_amount}</b> 金币</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>用户累计为你的作品投入 <b className="gold-num">{plan.pool_total}</b> 金币 · 你应得 {plan.entitled} · 已领 {plan.claimed}</div>
                </div>
                <button className="btn primary rev-claim" onClick={claim} disabled={!plan.claimable || claiming}>
                  {claiming ? '领取中…' : plan.claimable ? <><Gift size={16} /> 领取分成</> : <><Check size={16} /> 暂无可领</>}
                </button>
              </div>
              <div className="rev-bar"><div style={{ width: `${plan.entitled ? Math.min(100, (plan.claimed / plan.entitled) * 100) : 0}%` }} /></div>
              <div className="rev-mini">
                <div><b className="gold-num">{plan.pool_total}</b><span>累计被投入</span></div>
                <div><b className="gold-num">{plan.pool_month}</b><span>本月被投入</span></div>
                <div><b>{plan.works}</b><span>作品数</span></div>
              </div>
            </div>

            <div className="card">
              <div className="section-title"><h2>分成等级阶梯</h2></div>
              <div className="rev-tiers">
                {plan.tiers.map(tr => (
                  <div key={tr.id} className={'rev-tier-row' + (tr.id === plan.tier ? ' on' : '')}>
                    <b>{tr.name}</b>
                    <span className="muted">累计被投入 ≥ {tr.min} 金币</span>
                    <span className="rev-rate">分成 {Math.round(tr.rate * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12.8, lineHeight: 1.7, marginBottom: 0 }}>
                <b>规则：</b>当其他用户在你的角色上使用平台对话 / 语音（消耗金币）时，这些金币计入你的「被投入池」。
                你可按当前等级**分成比例**从池中提取收益，随时领取尚未领取的部分。被投入越多，等级与分成比例越高。
                {plan.next && <> 距「{plan.next.name}」还差用户再投入 <b>{plan.next.min - plan.pool_total}</b> 金币。</>}
              </p>
            </div>
          </div>
        )}

        {tab === 'characters' && (data.characters.length === 0
          ? <div className="empty" style={{ padding: 40 }}>还没有创建角色，<a onClick={() => nav('/character/new')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>去创建一个</a></div>
          : (
            <div className="studio-list">
              {data.characters.map(c => (
                <div key={c.id} className="studio-row" onClick={() => nav('/character/' + c.id)}>
                  <Avatar src={c.avatar} name={c.name} size={44} />
                  <div className="sr-name"><b>{c.name}</b><span className={'tag ' + (c.is_public ? 'tag-pub' : 'tag-draft')}>{c.is_public ? '已公开' : '私有'}</span></div>
                  <div className="sr-stats">
                    <span title="浏览"><Eye size={13} /> {fmt(c.uses)}</span>
                    <span title="点赞"><Heart size={13} /> {fmt(c.likes)}</span>
                    <span title="收藏"><Star size={13} /> {fmt(c.favs)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'scripts' && (data.scripts.length === 0
          ? <div className="empty" style={{ padding: 40 }}>还没有发布剧本，<a onClick={() => nav('/script/new')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>去创作一个</a></div>
          : (
            <div className="studio-list">
              {data.scripts.map(s => (
                <div key={s.id} className="studio-row" onClick={() => nav('/script/' + s.id)}>
                  <div className="sr-cover">{s.cover ? <img src={assetUrl(s.cover)} alt="" loading="lazy" /> : <ScrollText size={20} />}</div>
                  <div className="sr-name"><b>{s.title}</b><span className="tag">{s.price_gold > 0 ? `${s.price_gold} 金币` : '免费'}</span></div>
                  <div className="sr-stats">
                    <span title="游玩"><Play size={13} /> {fmt(s.plays)}</span>
                    <span title="销量"><Drama size={13} /> {fmt(s.sales)}</span>
                    <span title="收入" className="gold-num"><CoinIcon size={13} /> {fmt(s.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </>
  );
}
