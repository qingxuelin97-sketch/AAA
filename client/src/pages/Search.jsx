import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Search as SearchIcon, Drama, ScrollText, Coins, Play, User } from 'lucide-react';

const TABS = [
  { k: 'user', label: '用户', ph: '输入用户 ID 或用户名 / 昵称' },
  { k: 'character', label: '角色卡', ph: '输入角色 ID 或名称 / 标签' },
  { k: 'script', label: '剧本卡', ph: '输入剧本 ID 或标题 / 标签' }
];

export default function Search() {
  const [tab, setTab] = useState('user');
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const run = async () => {
    const query = q.trim();
    if (!query) { toast('请输入搜索内容', 'err'); return; }
    setLoading(true); setRes(null);
    const numeric = /^\d+$/.test(query);
    try {
      if (tab === 'user') {
        const d = await api('/users/search?q=' + encodeURIComponent(query));
        setRes({ users: d.users });
      } else if (tab === 'character') {
        if (numeric) {
          try { const d = await api('/characters/' + query); setRes({ characters: [d.character] }); }
          catch { setRes({ characters: [] }); }
        } else {
          const d = await api('/characters/public?q=' + encodeURIComponent(query));
          setRes({ characters: d.characters });
        }
      } else {
        if (numeric) {
          try { const d = await api('/scripts/' + query); setRes({ scripts: [d.script] }); }
          catch { setRes({ scripts: [] }); }
        } else {
          const d = await api('/scripts?q=' + encodeURIComponent(query));
          setRes({ scripts: d.scripts });
        }
      }
    } catch (e) { toast(e.message, 'err'); } finally { setLoading(false); }
  };

  const current = TABS.find(t => t.k === tab);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>搜索</h1><div className="sub">按 ID 或关键词查找用户、角色卡与剧本卡</div></div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="seg" style={{ marginBottom: 16 }}>
          {TABS.map(t => <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => { setTab(t.k); setRes(null); }}>{t.label}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          <input className="input" placeholder={current.ph} value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} autoFocus />
          <button className="btn primary" onClick={run}><SearchIcon size={16} /> 搜索</button>
        </div>

        {loading ? <div className="empty">搜索中…</div> : !res ? (
          <div className="empty"><div className="big"><SearchIcon size={44} /></div>输入上方关键词或 ID 开始搜索</div>
        ) : tab === 'user' ? (
          res.users.length === 0 ? <div className="empty"><div className="big"><User size={44} /></div>没有找到匹配的用户</div> : (
            res.users.map(u => (
              <div key={u.id} className="room-row" onClick={() => nav('/user/' + u.id)}>
                <Avatar src={u.avatar} name={u.display_name} size={50} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{u.display_name}</b>
                  <div className="muted" style={{ fontSize: 13 }}>@{u.username} · ID {u.id}</div>
                  {u.bio && <div className="muted" style={{ fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.bio}</div>}
                </div>
              </div>
            ))
          )
        ) : tab === 'character' ? (
          res.characters.length === 0 ? <div className="empty"><div className="big"><Drama size={44} /></div>没有找到该角色（可能非公开）</div> : (
            <div className="grid">
              {res.characters.map(c => (
                <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id)}>
                  <div className="cover">{c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={40} /></div>}
                    <div className="pill-pub">ID {c.id}</div></div>
                  <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro || '暂无简介'}</p></div>
                </div>
              ))}
            </div>
          )
        ) : (
          res.scripts.length === 0 ? <div className="empty"><div className="big"><ScrollText size={44} /></div>没有找到该剧本</div> : (
            <div className="grid">
              {res.scripts.map(s => (
                <div key={s.id} className="char-card" onClick={() => nav('/script/' + s.id)}>
                  <div className="cover">{s.cover ? <img src={s.cover} alt="" /> : <div className="ph"><ScrollText size={34} /></div>}
                    <div className="pill-pub">ID {s.id}</div></div>
                  <div className="meta"><h3>{s.title}</h3><p>{s.summary}</p>
                    <div className="foot">
                      <span className="price-tag">{s.price_gold > 0 ? <><Coins size={12} /> {s.price_gold}</> : <span className="free-tag">免费</span>}</span>
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} className="muted"><Play size={11} /> {s.plays}</span>
                    </div></div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
