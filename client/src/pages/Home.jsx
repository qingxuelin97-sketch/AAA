import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';

const TABS = [{ k: 'all', l: '全部' }, { k: 'card', l: '🎭 角色卡' }, { k: 'script', l: '📜 剧本' }];

export default function Home() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    api(`/community/feed?type=${tab}&q=${encodeURIComponent(q)}`)
      .then(d => setPosts(d.posts)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const like = async (e, p) => {
    e.stopPropagation();
    try {
      const d = await api(`/community/posts/${p.id}/like`, { method: 'POST' });
      setPosts(posts.map(x => x.id === p.id ? { ...x, liked: d.liked, likes: d.likes } : x));
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>发现广场</h1>
          <div className="sub">玩家上传的角色卡与剧本，挑一个开始你的故事</div>
        </div>
        <button className="btn primary" onClick={() => nav('/publish')}>✨ 发布作品</button>
      </div>

      <div className="page">
        <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
          <div className="tabs-bar" style={{ border: 'none', margin: 0 }}>
            {TABS.map(t => (
              <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => setTab(t.k)}>{t.l}</button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <input className="input" style={{ width: 240 }} placeholder="搜索作品 / 标签…" value={q}
              onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
            <button className="btn" onClick={load}>搜索</button>
          </div>
        </div>

        {loading ? <div className="empty">载入中…</div> :
          posts.length === 0 ? (
            <div className="empty"><div className="big">🪶</div>广场还很安静，成为第一个发布作品的人吧</div>
          ) : (
            <div className="grid">
              {posts.map(p => (
                <div key={p.id} className="char-card" onClick={() => nav('/post/' + p.id)}>
                  <div className="cover">
                    {p.cover ? <img src={p.cover} alt="" /> : <div className="ph">{p.type === 'script' ? '📜' : '🎭'}</div>}
                    <div className="pill-pub">{p.type === 'script' ? '剧本' : '角色卡'}</div>
                  </div>
                  <div className="meta">
                    <h3>{p.title}</h3>
                    <p>{p.body || '暂无简介'}</p>
                    <div className="foot">
                      <Avatar src={p.author_avatar} name={p.author_name} size={20} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.author_name}</span>
                      <button className="speak" onClick={e => like(e, p)} style={{ color: p.liked ? 'var(--accent)' : 'var(--faint)' }}>
                        {p.liked ? '♥' : '♡'} {p.likes}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </>
  );
}
