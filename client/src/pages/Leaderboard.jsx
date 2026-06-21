import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { Heart, Play, Flame, ScrollText, Trophy } from 'lucide-react';

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

  const rankClass = (i) => 'lb-rank ' + (i < 3 ? 'r' + (i + 1) : '');

  const characters = data?.characters || [];
  const scripts = data?.scripts || [];
  const authors = data?.authors || [];

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>排行榜</h1><div className="sub">最受欢迎的角色 · 剧本 · 作者</div></div>
      </div>
      <div className="page">
        <div className="seg seg-3" style={{ marginBottom: 18 }}>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>角色榜</button>
          <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>剧本榜</button>
          <button className={tab === 'authors' ? 'active' : ''} onClick={() => setTab('authors')}>创作者榜</button>
        </div>

        {loading ? <div className="empty">载入中…</div> : (
          <>
            {tab === 'characters' && (characters.length === 0 ? (
              <div className="empty"><div className="big"><Trophy size={42} /></div>暂无上榜角色</div>
            ) : characters.map((c, i) => (
              <div key={c.id} className="lb-row" onClick={() => nav('/character/' + c.id)}>
                <div className={rankClass(i)}>{i + 1}</div>
                <Avatar src={c.avatar} name={c.name} size={44} />
                <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <b>{c.name}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{c.owner_name}</div>
                </div>
                <span className="lb-num"><Heart size={14} fill="currentColor" /> {c.likes}</span>
              </div>
            )))}

            {tab === 'scripts' && (scripts.length === 0 ? (
              <div className="empty"><div className="big"><Trophy size={42} /></div>暂无上榜剧本</div>
            ) : scripts.map((s, i) => (
              <div key={s.id} className="lb-row" onClick={() => nav('/script/' + s.id)}>
                <div className={rankClass(i)}>{i + 1}</div>
                {s.cover
                  ? <img src={s.cover} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--bg-2)', flexShrink: 0 }}><ScrollText size={20} /></div>}
                <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <b>{s.title}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{s.author_name}</div>
                </div>
                <span className="lb-num"><Play size={14} fill="currentColor" /> {s.plays}</span>
              </div>
            )))}

            {tab === 'authors' && (authors.length === 0 ? (
              <div className="empty"><div className="big"><Trophy size={42} /></div>暂无上榜作者</div>
            ) : authors.map((a, i) => (
              <div key={a.id} className="lb-row" onClick={() => nav('/user/' + a.id)}>
                <div className={rankClass(i)}>{i + 1}</div>
                <Avatar src={a.avatar} name={a.display_name} size={44} />
                <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{a.display_name}<CreatorV tier={a.creator_tier} size={13} /></b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{a.chars} 角色 · {a.scripts} 剧本</div>
                </div>
                <span className="lb-num"><Flame size={14} /> {a.score} 人气</span>
              </div>
            )))}
          </>
        )}
      </div>
    </>
  );
}
