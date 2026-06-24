import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { Heart, Play, Flame, ScrollText, Trophy, Crown } from 'lucide-react';

export default function Leaderboard() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('characters');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/engage/leaderboard')
      .then(setData)
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
    /* eslint-disable-next-line */
  }, []);

  const characters = data?.characters || [];
  const scripts = data?.scripts || [];
  const authors = data?.authors || [];

  // Normalise each tab to a common shape so the podium + list can be rendered once.
  const rows = (() => {
    if (tab === 'characters') return characters.map(c => ({
      id: c.id, to: '/character/' + c.id, name: c.name, sub: c.owner_name,
      avatar: c.avatar, metric: <><Heart size={14} fill="currentColor" /> {c.likes}</>,
    }));
    if (tab === 'scripts') return scripts.map(s => ({
      id: s.id, to: '/script/' + s.id, name: s.title, sub: s.author_name,
      cover: s.cover, fallback: <ScrollText size={20} />, metric: <><Play size={14} fill="currentColor" /> {s.plays}</>,
    }));
    return authors.map(a => ({
      id: a.id, to: '/user/' + a.id, name: a.display_name, sub: `${a.chars} 角色 · ${a.scripts} 剧本`,
      avatar: a.avatar, vTier: a.creator_tier, metric: <><Flame size={14} /> {a.score} 人气</>,
    }));
  })();

  const emptyText = tab === 'characters' ? '暂无上榜角色' : tab === 'scripts' ? '暂无上榜剧本' : '暂无上榜作者';
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Podium display order: 2nd · 1st · 3rd (champion centred and tallest).
  const podiumOrder = [top3[1], top3[0], top3[2]].map((r, i) => ({ r, place: [2, 1, 3][i] })).filter(x => x.r);

  const Thumb = ({ row, size }) => row.cover !== undefined
    ? (row.cover
        ? <img src={row.cover} alt="" style={{ width: size, height: size, borderRadius: size * 0.23, objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: size, height: size, borderRadius: size * 0.23, display: 'grid', placeItems: 'center', background: 'var(--bg-2)', flexShrink: 0 }}>{row.fallback}</div>)
    : <Avatar src={row.avatar} name={row.name} size={size} />;

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1 className="title-glow"><Trophy size={20} style={{ verticalAlign: -3, marginRight: 8 }} />排行榜</h1><div className="sub">最受欢迎的角色 · 剧本 · 作者，每日实时更新</div></div>
      </div>
      <div className="page">
        <div className="seg seg-3" style={{ marginBottom: 18 }}>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>角色榜</button>
          <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>剧本榜</button>
          <button className={tab === 'authors' ? 'active' : ''} onClick={() => setTab('authors')}>创作者榜</button>
        </div>

        {loading ? <div className="empty">载入中…</div> : rows.length === 0 ? (
          <div className="empty"><div className="big"><Trophy size={42} /></div>{emptyText}</div>
        ) : (
          <>
            {podiumOrder.length > 0 && (
              <div className="lb-podium">
                {podiumOrder.map(({ r, place }) => (
                  <div key={r.id} className={'lb-pod p' + place} onClick={() => nav(r.to)}>
                    {place === 1 && <Crown className="lb-crown" size={26} />}
                    <div className="lb-pod-av"><Thumb row={r} size={place === 1 ? 86 : 66} /><span className="lb-pod-rank">{place}</span></div>
                    <b className="lb-pod-name" title={r.name}>
                      {r.name}{r.vTier != null && <CreatorV tier={r.vTier} size={13} />}
                    </b>
                    <span className="lb-pod-sub">{r.sub}</span>
                    <span className="lb-pod-metric">{r.metric}</span>
                    <div className="lb-pod-base" />
                  </div>
                ))}
              </div>
            )}

            <div className="lb-list">
              {rest.map((r, i) => (
                <div key={r.id} className="lb-row" onClick={() => nav(r.to)}>
                  <div className="lb-rank">{i + 4}</div>
                  <Thumb row={r} size={44} />
                  <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{r.name}{r.vTier != null && <CreatorV tier={r.vTier} size={13} />}</b>
                    <div className="muted" style={{ fontSize: 12.5 }}>{r.sub}</div>
                  </div>
                  <span className="lb-num">{r.metric}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
