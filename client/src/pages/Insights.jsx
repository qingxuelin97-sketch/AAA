import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, CountUp } from '../ui.jsx';
import { fmtNum } from '../util.js';
import {
  Orbit, MessageCircle, MessagesSquare, CalendarDays, Flame, Sparkles,
  BookOpen, ScrollText, Feather, Wand2, Heart, Users, UserRound, TrendingUp, TrendingDown
} from 'lucide-react';

// 星轨 — 个人幻域旅程数据页。全部只读聚合；单系列条形图用 CSS 画，
// 深浅色的图表用色已按对比度校验（--chart-fill）。
export default function Insights() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    api('/me/insights').then(setD).catch(e => { setErr(e.message); toast(e.message, 'err'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <div className="empty" style={{ paddingTop: 120 }}>星轨暂时无法点亮：{err}</div>;
  if (!d) return <div className="empty" style={{ paddingTop: 120 }}>正在点亮你的星轨…</div>;

  const maxDay = Math.max(1, ...d.days.map(x => x.n));
  const peakIdx = d.days.reduce((bi, x, i) => (x.n > d.days[bi].n ? i : bi), 0);
  const maxComp = Math.max(1, ...(d.companions.map(c => c.n)));
  const MADES = [
    { k: 'characters', label: '角色', ic: Sparkles, to: '/library' },
    { k: 'worldbooks', label: '世界书', ic: BookOpen, to: '/worldbooks' },
    { k: 'scripts', label: '剧本', ic: ScrollText, to: '/scripts' },
    { k: 'novels', label: '小说', ic: Feather, to: '/atelier' },
    { k: 'images', label: 'AI 绘图', ic: Wand2, to: '/draw' },
    { k: 'favorites', label: '收藏', ic: Heart, to: '/favorites' },
  ];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>星轨</h1>
          <div className="sub">你在幻域留下的每一道轨迹</div>
        </div>
      </div>
      <div className="page" style={{ maxWidth: 980 }}>
        <div className="ins-hero">
          <span className="ins-star" style={{ top: '22%', left: '58%' }} />
          <span className="ins-star s2" style={{ top: '60%', left: '78%' }} />
          <span className="ins-star s3" style={{ top: '34%', left: '88%' }} />
          <h2><Orbit size={24} style={{ verticalAlign: -4, color: 'var(--accent)', marginRight: 8 }} />我的幻域旅程</h2>
          <div className="ins-sub">
            {d.since ? <>自 {d.since} 启程 · </> : null}
            与 {d.chat.conversations} 段对话、{d.creations.characters} 个角色一同生长
          </div>
          {d.streak > 0 && <span className="ins-streak"><Flame size={14} /> 连续签到 {d.streak} 天</span>}
        </div>

        <div className="ins-kpis">
          <div className="ins-kpi">
            <div className="k-label"><MessagesSquare size={14} /> 对话总数</div>
            <div className="k-value"><CountUp value={d.chat.conversations} dur={800} /></div>
          </div>
          <div className="ins-kpi">
            <div className="k-label"><MessageCircle size={14} /> 消息往来</div>
            <div className="k-value"><CountUp value={d.chat.messages} dur={800} /></div>
            <div className="k-hint">发出 {d.chat.sent} · 收到 {d.chat.received}</div>
          </div>
          <div className="ins-kpi">
            <div className="k-label"><CalendarDays size={14} /> 活跃天数</div>
            <div className="k-value"><CountUp value={d.chat.active_days} dur={800} /></div>
          </div>
          <div className="ins-kpi">
            <div className="k-label"><Users size={14} /> 关注者</div>
            <div className="k-value"><CountUp value={d.social.followers} dur={800} /></div>
            <div className="k-hint">关注 {d.social.following} · 好友 {d.social.friends}</div>
          </div>
        </div>

        <div className="ins-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ins-card">
              <h3>近 14 天的星光</h3>
              <div className="c-sub">每天的消息往来量</div>
              <div className="ins-chart">
                {d.days.map((x, i) => (
                  <div key={x.date} className={'ins-bar' + (x.n === 0 ? ' zero' : '')} tabIndex={0}>
                    <span className="tip">{x.date} · {x.n} 条</span>
                    {i === peakIdx && x.n > 0 && <b>{x.n}</b>}
                    <i style={{ height: Math.max(2, Math.round((x.n / maxDay) * 100)) + '%' }} />
                    <small>{x.date}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="ins-card">
              <h3>创作全景</h3>
              <div className="c-sub">你亲手带到这个世界的东西</div>
              <div className="ins-mades">
                {MADES.map(m => (
                  <button key={m.k} className="ins-made" onClick={() => nav(m.to)}>
                    <m.ic size={19} />
                    <b>{d.creations[m.k] ?? 0}</b>
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ins-card">
              <h3>羁绊最深</h3>
              <div className="c-sub">按消息往来排序的角色 Top {Math.max(d.companions.length, 1)}</div>
              {d.companions.length === 0
                ? <div className="empty" style={{ padding: '18px 0' }}><UserRound size={28} style={{ opacity: 0.4 }} /><br />还没有羁绊，去发现广场邂逅一个角色吧</div>
                : (
                  <div className="ins-comp">
                    {d.companions.map(c => (
                      <div key={c.id} className="ins-comp-row" onClick={() => nav('/character/' + c.id)}>
                        <Avatar src={c.avatar} name={c.name} size={40} />
                        <div style={{ minWidth: 0 }}>
                          <div className="n">{c.name}</div>
                          <div className="bar"><i style={{ width: Math.max(6, Math.round((c.n / maxComp) * 100)) + '%' }} /></div>
                        </div>
                        <span className="v">{c.n} 条</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div className="ins-card">
              <h3>经济脉络</h3>
              <div className="c-sub">金币的来与去</div>
              <div className="ins-eco">
                <div className="pill">
                  <b style={{ color: 'var(--ok)' }}><TrendingUp size={15} style={{ verticalAlign: -2, marginRight: 4 }} />{fmtNum(d.economy.earned)}</b>
                  <span>累计获得金币</span>
                </div>
                <div className="pill">
                  <b style={{ color: 'var(--danger)' }}><TrendingDown size={15} style={{ verticalAlign: -2, marginRight: 4 }} />{fmtNum(d.economy.spent)}</b>
                  <span>累计消耗金币</span>
                </div>
                <div className="pill">
                  <b>{fmtNum(d.economy.gold)}</b>
                  <span>当前余额 · 钻石 {fmtNum(d.economy.diamond)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
