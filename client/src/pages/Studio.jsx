import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Eye, Heart, Star, Play, Coins, Users, Drama, ScrollText, TrendingUp, Sparkles } from 'lucide-react';

const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n ?? 0));

export default function Studio() {
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('characters');

  useEffect(() => { api('/me/studio').then(setData).catch(e => toast(e.message, 'err')); /* eslint-disable-next-line */ }, []);
  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const t = data.totals;

  const cards = [
    { ic: Eye, label: '角色总浏览', val: t.char_uses, accent: '#3f8195' },
    { ic: Heart, label: '角色总点赞', val: t.char_likes, accent: '#d4677a' },
    { ic: Star, label: '被收藏', val: t.char_favs, accent: '#c9962f' },
    { ic: Play, label: '剧本游玩', val: t.script_plays, accent: '#6a8a52' },
    { ic: Coins, label: '剧本收入', val: t.gold_earned, accent: '#c8853f', gold: true },
    { ic: Users, label: '粉丝', val: t.followers, accent: '#7a6bd0' }
  ];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1><TrendingUp size={20} style={{ verticalAlign: -3, marginRight: 6 }} />创作中心</h1>
          <div className="sub">你的角色与剧本的数据总览</div></div>
        <button className="btn primary" onClick={() => nav('/publish')}><Sparkles size={15} /> 发布新作品</button>
      </div>

      <div className="page">
        <div className="studio-cards">
          {cards.map((c, i) => (
            <div key={i} className="studio-card">
              <span className="sc-ic" style={{ background: c.accent + '22', color: c.accent }}><c.ic size={18} /></span>
              <div><b className={c.gold ? 'gold-num' : ''}>{fmt(c.val)}</b><span>{c.label}</span></div>
            </div>
          ))}
        </div>

        <div className="tabs-bar" style={{ marginTop: 22 }}>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>角色 ({data.characters.length})</button>
          <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>剧本 ({data.scripts.length})</button>
        </div>

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
                  <div className="sr-cover">{s.cover ? <img src={s.cover} alt="" /> : <ScrollText size={20} />}</div>
                  <div className="sr-name"><b>{s.title}</b><span className="tag">{s.price_gold > 0 ? `${s.price_gold} 金币` : '免费'}</span></div>
                  <div className="sr-stats">
                    <span title="游玩"><Play size={13} /> {fmt(s.plays)}</span>
                    <span title="销量"><Drama size={13} /> {fmt(s.sales)}</span>
                    <span title="收入" className="gold-num"><Coins size={13} /> {fmt(s.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </>
  );
}
