import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api.jsx';
import { useToast, Avatar, CoinIcon } from '../ui.jsx';
import { pid, parsePid } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { Search as SearchIcon, Drama, ScrollText, Play, User } from 'lucide-react';

const TABS = [
  { k: 'user', label: '用户', ph: '用户 ID（如 U3）或用户名 / 昵称' },
  { k: 'character', label: '角色卡', ph: '角色 ID（如 C4）或名称 / 标签' },
  { k: 'script', label: '剧本卡', ph: '剧本 ID（如 S2）或标题 / 标签' }
];

export default function Search() {
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const initialTab = params.get('tab') || 'user';
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState(initialQ);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const run = async () => {
    const query = q.trim();
    if (!query) { toast('请输入搜索内容', 'err'); return; }
    const parsed = parsePid(query);
    const useTab = parsed?.type || tab;     // prefixed id (U/C/S) auto-selects the tab
    const eff = parsed?.type ? parsed.n : query;
    const numeric = /^\d+$/.test(eff);
    if (parsed?.type && parsed.type !== tab) setTab(parsed.type);
    setLoading(true); setRes(null);
    try {
      if (useTab === 'user') {
        const d = await api('/users/search?q=' + encodeURIComponent(eff));
        setRes({ tab: 'user', users: d.users });
      } else if (useTab === 'character') {
        if (numeric) {
          try { const d = await api('/characters/' + eff); setRes({ tab: 'character', characters: [d.character] }); }
          catch { setRes({ tab: 'character', characters: [] }); }
        } else {
          const d = await api('/characters/public?q=' + encodeURIComponent(eff));
          setRes({ tab: 'character', characters: d.characters });
        }
      } else {
        if (numeric) {
          try { const d = await api('/scripts/' + eff); setRes({ tab: 'script', scripts: [d.script] }); }
          catch { setRes({ tab: 'script', scripts: [] }); }
        } else {
          const d = await api('/scripts?q=' + encodeURIComponent(eff));
          setRes({ tab: 'script', scripts: d.scripts });
        }
      }
    } catch (e) { toast(e.message, 'err'); } finally { setLoading(false); }
  };

  const current = TABS.find(t => t.k === tab);

  // 从标签广场等外部链接带 q 参数跳入时，自动执行一次搜索
  useEffect(() => { if (initialQ) run(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>搜索</h1><div className="sub">按 ID 或关键词查找用户、角色卡与剧本卡</div></div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="seg" style={{ marginBottom: 16 }}>
          {TABS.map(t => <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => { setTab(t.k); setRes(null); }}>{t.label}</button>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={current.ph} value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} autoFocus />
          <button className="btn primary" onClick={run}><SearchIcon size={16} /> 搜索</button>
        </div>

        {loading ? <div className="empty">搜索中…</div> : !res ? (
          <div className="empty"><EmptyArt kind="search" />输入上方关键词或 ID 开始搜索</div>
        ) : res.tab === 'user' ? (
          res.users.length === 0 ? <div className="empty"><div className="big"><User size={44} /></div>没有找到匹配的用户</div> : (
            res.users.map(u => (
              <div key={u.id} className="room-row" onClick={() => nav('/user/' + u.id)}>
                <Avatar src={u.avatar} name={u.display_name} size={50} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{u.display_name}</b>
                  <div className="muted" style={{ fontSize: 13 }}>@{u.username} · {pid('user', u.id)}</div>
                  {u.bio && <div className="muted" style={{ fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.bio}</div>}
                </div>
              </div>
            ))
          )
        ) : res.tab === 'character' ? (
          res.characters.length === 0 ? <div className="empty"><div className="big"><Drama size={44} /></div>没有找到该角色（可能非公开）</div> : (
            <div className="grid">
              {res.characters.map(c => (
                <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id)}>
                  <div className="cover">{c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                    <div className="pill-pub">{pid('character', c.id)}</div></div>
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
                  <div className="cover">{s.cover ? <img src={assetUrl(s.cover)} alt="" loading="lazy" /> : <div className="ph"><ScrollText size={34} /></div>}
                    <div className="pill-pub">{pid('script', s.id)}</div></div>
                  <div className="meta"><h3>{s.title}</h3><p>{s.summary}</p>
                    <div className="foot">
                      <span className="price-tag">{s.price_gold > 0 ? <><CoinIcon size={12} /> {s.price_gold}</> : <span className="free-tag">免费</span>}</span>
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
