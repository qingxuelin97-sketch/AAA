import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { ScrollText, Coins, Play, Plus, Inbox } from 'lucide-react';
import { CategoryIcon } from '../assets.jsx';

function ScriptCard({ s, nav, extra }) {
  return (
    <div className="char-card" onClick={() => nav('/script/' + s.id)}>
      <div className="cover">
        {s.cover ? <img src={s.cover} alt="" /> : <div className="ph"><ScrollText size={46} /></div>}
      </div>
      <div className="meta">
        <h3>{s.title}</h3>
        <p>{s.summary || '暂无简介'}</p>
        <div className="foot">
          {s.price_gold > 0
            ? <span className="price-tag"><Coins size={14} /> {s.price_gold}</span>
            : <span className="free-tag">免费</span>}
          <span><Play size={12} style={{ verticalAlign: 'middle' }} /> {s.plays || 0}</span>
          {extra ? <span style={{ marginLeft: 'auto' }}>{extra(s)}</span> : null}
        </div>
      </div>
    </div>
  );
}

export default function Scripts() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('plaza');
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('hot');
  const [scripts, setScripts] = useState([]);
  const [mine, setMine] = useState({ created: [], purchased: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/meta/categories').then(d => setCats(d.categories || [])).catch(() => {});
  }, []);

  const loadPlaza = () => {
    setLoading(true);
    const params = new URLSearchParams({ category: cat, q, sort });
    api('/scripts?' + params.toString())
      .then(d => setScripts(d.scripts || []))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  };

  const loadMine = () => {
    setLoading(true);
    api('/scripts/mine')
      .then(d => setMine({ created: d.created || [], purchased: d.purchased || [] }))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'plaza') loadPlaza();
    else loadMine();
    // eslint-disable-next-line
  }, [tab, cat, sort]);

  const onSearch = (e) => { e.preventDefault(); loadPlaza(); };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>剧本市集</h1>
          <div className="sub">探索付费与免费的沉浸式剧本，开启你的角色扮演冒险</div>
        </div>
        <button className="btn primary" onClick={() => nav('/script/new')}><Plus size={16} style={{ verticalAlign: 'middle' }} /> 创建剧本</button>
      </div>

      <div className="page">
        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={tab === 'plaza' ? 'active' : ''} onClick={() => setTab('plaza')}>广场</button>
          <button className={tab === 'created' ? 'active' : ''} onClick={() => setTab('created')}>我创建的</button>
          <button className={tab === 'purchased' ? 'active' : ''} onClick={() => setTab('purchased')}>我购买的</button>
        </div>

        {tab === 'plaza' && (
          <>
            <div className="cat-bar">
              <button className={'cat-chip' + (cat === 'all' ? ' active' : '')} onClick={() => setCat('all')}>
                <ScrollText size={14} style={{ verticalAlign: 'middle' }} /> 全部
              </button>
              {cats.map(c => (
                <button key={c.slug} className={'cat-chip' + (cat === c.slug ? ' active' : '')} onClick={() => setCat(c.slug)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CategoryIcon slug={c.slug} size={14} /> {c.name}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
              <form onSubmit={onSearch} style={{ flex: 1, minWidth: 200 }}>
                <input className="input" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="搜索剧本标题、简介…" onBlur={loadPlaza} />
              </form>
              <div className="seg">
                <button className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>热门</button>
                <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>最新</button>
              </div>
            </div>

            {loading ? <div className="empty">载入中…</div> :
              scripts.length === 0 ? (
                <div className="empty"><div className="big"><ScrollText size={46} /></div>暂无剧本</div>
              ) : (
                <div className="grid">
                  {scripts.map(s => <ScriptCard key={s.id} s={s} nav={nav} />)}
                </div>
              )}
          </>
        )}

        {tab === 'created' && (
          loading ? <div className="empty">载入中…</div> :
            mine.created.length === 0 ? (
              <div className="empty">
                <div className="big"><ScrollText size={46} /></div>你还没有创建剧本
                <div style={{ marginTop: 16 }}><button className="btn primary" onClick={() => nav('/script/new')}>创建第一个剧本</button></div>
              </div>
            ) : (
              <div className="grid">
                {mine.created.map(s => <ScriptCard key={s.id} s={s} nav={nav} />)}
              </div>
            )
        )}

        {tab === 'purchased' && (
          loading ? <div className="empty">载入中…</div> :
            mine.purchased.length === 0 ? (
              <div className="empty"><div className="big"><Inbox size={46} /></div>你还没有购买剧本</div>
            ) : (
              <div className="grid">
                {mine.purchased.map(s => (
                  <ScriptCard key={s.id} s={s} nav={nav}
                    extra={(it) => it.refunded ? <span className="muted">已退款</span> : (it.paid ? <span className="free-tag">已购</span> : null)} />
                ))}
              </div>
            )
        )}
      </div>
    </>
  );
}
