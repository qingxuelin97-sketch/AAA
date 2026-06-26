import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { BookOpen, Plus, Globe, BookLock, BookCheck, ArrowRight } from 'lucide-react';

export default function Worldbooks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('mine');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    const path = tab === 'mine' ? '/worldbooks/mine' : '/worldbooks/public';
    api(path).then(d => setList(d.worldbooks || [])).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>世界书</h1><div className="sub">独立管理设定集，关联到任意角色实现跨角色复用</div></div>
        <button className="btn primary" onClick={() => nav('/worldbook/new/edit')}><Plus size={16} /> 新建世界书</button>
      </div>
      <div className="page">
        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的世界书</button>
          <button className={tab === 'public' ? 'active' : ''} onClick={() => setTab('public')}>公开广场</button>
        </div>

        {loading ? <GridSkeleton n={4} /> :
          list.length === 0 ? (
            <div className="empty">
              <div className="big"><BookLock size={46} /></div>
              {tab === 'mine' ? <>还没有世界书<div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => nav('/worldbook/new/edit')}>创建第一本世界书</button></div></> : '广场还没有公开世界书'}
            </div>
          ) : (
            <div className="grid">
              {list.map(w => {
                const owned = user && w.owner_id === user.id;
                return (
                  <div key={w.id} className="char-card" onClick={() => nav('/worldbook/' + w.id + '/edit')}>
                    <div className="cover" style={{ minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-2)' }}>
                      <BookOpen size={38} style={{ color: 'var(--accent)' }} />
                      {w.is_public ? <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 公开</div> : null}
                    </div>
                    <div className="meta">
                      <h3>{w.name}</h3>
                      <p>{w.description || '暂无简介'}</p>
                      {w.tags && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                        {String(w.tags).split(',').filter(Boolean).slice(0, 4).map((t, i) => <span key={i} className="tag">{t.trim()}</span>)}
                      </div>}
                      <div className="foot">
                        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><BookCheck size={12} /> {w.entry_count || 0} 条</span>
                        {tab === 'public' && w.owner_name && <span className="muted" style={{ fontSize: 12 }}>· {w.owner_name}</span>}
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 12.5 }}>
                          {owned ? '编辑' : '查看'} <ArrowRight size={12} />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </>
  );
}
