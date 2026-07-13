import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Avatar, CoinIcon } from '../ui.jsx';
import { pid, parsePid } from '../assets.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { Search as SearchIcon, Drama, ScrollText, Play, User, X, History } from 'lucide-react';

const TABS = [
  { k: 'user', label: '用户', ph: '用户 ID（如 U3）或用户名 / 昵称' },
  { k: 'character', label: '角色卡', ph: '角色 ID（如 C4）或名称 / 标签' },
  { k: 'script', label: '剧本卡', ph: '剧本 ID（如 S2）或标题 / 标签' }
];

// 最近搜索（本地，最多 8 条）
const RECENT_KEY = 'huanyu_recent_search';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const saveRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* */ } };

export default function Search() {
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const initialTab = params.get('tab') || 'user';
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState(initialQ);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const nav = useNavigate();
  const toast = useToast();
  const inputRef = useRef(null);
  const seqRef = useRef(0); // 防抖竞态：只采纳最后一次请求的结果

  const remember = (query) => {
    setRecent(prev => { const next = [query, ...prev.filter(x => x !== query)].slice(0, 8); saveRecent(next); return next; });
  };

  const run = async (query = q.trim(), { manual = false } = {}) => {
    if (!query) { if (manual) toast('请输入搜索内容', 'err'); return; }
    const parsed = parsePid(query);
    const useTab = parsed?.type || tab;     // prefixed id (U/C/S) auto-selects the tab
    const eff = parsed?.type ? parsed.n : query;
    const numeric = /^\d+$/.test(eff);
    if (parsed?.type && parsed.type !== tab) setTab(parsed.type);
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      let out;
      if (useTab === 'user') {
        const d = await api('/users/search?q=' + encodeURIComponent(eff));
        out = { tab: 'user', users: d.users };
      } else if (useTab === 'character') {
        if (numeric) {
          try { const d = await api('/characters/' + eff); out = { tab: 'character', characters: [d.character] }; }
          catch { out = { tab: 'character', characters: [] }; }
        } else {
          const d = await api('/characters/public?q=' + encodeURIComponent(eff));
          out = { tab: 'character', characters: d.characters };
        }
      } else {
        if (numeric) {
          try { const d = await api('/scripts/' + eff); out = { tab: 'script', scripts: [d.script] }; }
          catch { out = { tab: 'script', scripts: [] }; }
        } else {
          const d = await api('/scripts?q=' + encodeURIComponent(eff));
          out = { tab: 'script', scripts: d.scripts };
        }
      }
      if (seq !== seqRef.current) return; // 已有更新的输入在途，丢弃过期结果
      setRes(out);
      remember(query);
    } catch (e) { if (seq === seqRef.current) toast(e.message, 'err'); }
    finally { if (seq === seqRef.current) setLoading(false); }
  };

  const current = TABS.find(t => t.k === tab);

  // 即输即搜（300ms 防抖）：单字符噪音大不搜（ID 前缀如 U3 是 2 字符起）。
  // 手动回车 / 点按钮仍即时执行。
  useEffect(() => {
    const query = q.trim();
    if (!query) { setRes(null); setLoading(false); return undefined; }
    if (query.length < 2) return undefined;
    const t = setTimeout(() => run(query), 300);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [q, tab]);

  // 从标签广场等外部链接带 q 参数跳入时，自动执行一次搜索
  useEffect(() => { if (initialQ) run(initialQ); /* eslint-disable-next-line */ }, []);

  const clearInput = () => { setQ(''); setRes(null); inputRef.current?.focus(); };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>搜索</h1><div className="sub">按 ID 或关键词查找用户、角色卡与剧本卡</div></div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="seg" style={{ marginBottom: 16 }}>
          {TABS.map(t => <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => { setTab(t.k); setRes(null); }}>{t.label}</button>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 180, position: 'relative', display: 'flex' }}>
            <input ref={inputRef} className="input" style={{ flex: 1, paddingRight: 36 }} placeholder={current.ph} value={q}
              onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run(q.trim(), { manual: true })}
              enterKeyHint="search" autoFocus />
            {q && (
              <button className="pressable" onClick={clearInput} aria-label="清空"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: 'var(--faint)', display: 'grid', placeItems: 'center', padding: 6, cursor: 'pointer' }}>
                <X size={15} />
              </button>
            )}
          </div>
          <button className="btn primary pressable" onClick={() => run(q.trim(), { manual: true })}><SearchIcon size={16} /> 搜索</button>
        </div>

        {/* 最近搜索 chips：无结果面板时展示，点即重搜 */}
        {!res && !loading && recent.length > 0 && (
          <div className="stagger-in" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><History size={13} /> 最近</span>
            {recent.map(r => (
              <button key={r} className="tag-chip pressable" onClick={() => { setQ(r); run(r, { manual: true }); }}
                style={{ cursor: 'pointer' }}>{r}</button>
            ))}
            <button className="pressable" onClick={() => { setRecent([]); saveRecent([]); }} aria-label="清空最近搜索"
              style={{ border: 0, background: 'transparent', color: 'var(--faint)', cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}><X size={13} /></button>
          </div>
        )}

        {loading ? (
          <div aria-hidden="true">
            {[72, 72, 72].map((h, i) => <div key={i} className="skel" style={{ height: h, marginBottom: 10 }} />)}
          </div>
        ) : !res ? (
          <div className="empty"><EmptyArt kind="search" />输入上方关键词或 ID 开始搜索</div>
        ) : res.tab === 'user' ? (
          res.users.length === 0 ? <div className="empty"><div className="big"><User size={44} /></div>没有找到匹配的用户</div> : (
            <div className="stagger-in">
              {res.users.map(u => (
                <div key={u.id} className="room-row pressable" onClick={() => nav('/user/' + u.id)}>
                  <Avatar src={u.avatar} name={u.display_name} size={50} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 15 }}>{u.display_name}</b>
                    <div className="muted" style={{ fontSize: 13 }}>@{u.username} · {pid('user', u.id)}</div>
                    {u.bio && <div className="muted" style={{ fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.bio}</div>}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : res.tab === 'character' ? (
          res.characters.length === 0 ? <div className="empty"><div className="big"><Drama size={44} /></div>没有找到该角色（可能非公开）</div> : (
            <div className="grid stagger-in">
              {res.characters.map(c => (
                <div key={c.id} className="char-card pressable" onClick={() => nav('/character/' + c.id)}>
                  <div className="cover">{c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                    <div className="pill-pub">{pid('character', c.id)}</div></div>
                  <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro || '暂无简介'}</p></div>
                </div>
              ))}
            </div>
          )
        ) : (
          res.scripts.length === 0 ? <div className="empty"><div className="big"><ScrollText size={44} /></div>没有找到该剧本</div> : (
            <div className="grid stagger-in">
              {res.scripts.map(s => (
                <div key={s.id} className="char-card pressable" onClick={() => nav('/script/' + s.id)}>
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
