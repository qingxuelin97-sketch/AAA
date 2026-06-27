import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { BookOpen, Plus, Globe, BookLock, BookCheck, ArrowRight, Search, Sparkles, Wand2, Code2 } from 'lucide-react';

// 三档徽章配置：与编辑器保持一致
const TIER_BADGE = {
  normal: { name: '通常', icon: BookOpen, accent: '#c97a3f' },
  advanced: { name: '高级', icon: Code2, accent: '#7c5bd9' },
  expert: { name: '专家', icon: Wand2, accent: '#d4677a' },
};

export default function Worldbooks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('mine');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    const base = tab === 'mine' ? '/worldbooks/mine' : '/worldbooks/public';
    const params = new URLSearchParams();
    if (tab === 'public' && q) params.set('q', q);
    if (tab === 'public' && tierFilter !== 'all') params.set('tier', tierFilter);
    const qs = params.toString();
    api(qs ? `${base}?${qs}` : base)
      .then(d => setList(d.worldbooks || []))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, tierFilter]);

  // 客户端二次过滤（mine tab 没有 tier 后端过滤）
  const filtered = tierFilter === 'all' ? list : list.filter(w => (w.tier || 'normal') === tierFilter);

  return (
    <>
      <div className="topbar wb-list-topbar">
        <div style={{ flex: 1 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            世界书
            <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          </h1>
          <div className="sub">独立设定集 · 三档创作者体系 · 跨角色复用与图片触发</div>
        </div>
        <button className="btn primary" onClick={() => nav('/worldbook/new/edit')}><Plus size={16} /> 新建世界书</button>
      </div>

      <div className="page wb-list">
        {/* —— 档位速览：引导创作者进入对应能力档 —— */}
        <div className="wb-hero">
          <div className="wb-hero-aurora" />
          <div className="wb-hero-content">
            <div className="wb-hero-title">三档创作者体系</div>
            <div className="wb-hero-row">
              {Object.entries(TIER_BADGE).map(([id, t]) => {
                const Icon = t.icon;
                return (
                  <div key={id} className={'wb-hero-pill tier-' + id}>
                    <Icon size={14} /> {t.name}档
                    <span className="wb-hero-pill-sub">
                      {id === 'normal' && '关键词触发'}
                      {id === 'advanced' && '工程化设定'}
                      {id === 'expert' && '图片触发 + 自构前端'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="wb-list-controls">
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的世界书</button>
            <button className={tab === 'public' ? 'active' : ''} onClick={() => setTab('public')}>公开广场</button>
          </div>
          <div className="wb-tier-filter">
            <button className={tierFilter === 'all' ? 'active' : ''} onClick={() => setTierFilter('all')}>全部</button>
            <button className={tierFilter === 'normal' ? 'active tier-normal' : 'tier-normal'} onClick={() => setTierFilter('normal')}>通常</button>
            <button className={tierFilter === 'advanced' ? 'active tier-advanced' : 'tier-advanced'} onClick={() => setTierFilter('advanced')}>高级</button>
            <button className={tierFilter === 'expert' ? 'active tier-expert' : 'tier-expert'} onClick={() => setTierFilter('expert')}>专家</button>
          </div>
          {tab === 'public' && (
            <div className="wb-search">
              <Search size={14} />
              <input placeholder="搜索名称/标签/简介" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
            </div>
          )}
        </div>

        {loading ? <GridSkeleton n={4} /> :
          filtered.length === 0 ? (
            <div className="empty wb-empty">
              <div className="big"><BookLock size={46} /></div>
              {tab === 'mine' ? <>还没有世界书<div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => nav('/worldbook/new/edit')}>创建第一本世界书</button></div></> : (q || tierFilter !== 'all' ? '没有匹配的世界书' : '广场还没有公开世界书')}
            </div>
          ) : (
            <div className="grid wb-grid">
              {filtered.map((w, i) => {
                const owned = user && w.owner_id === user.id;
                const tier = w.tier || 'normal';
                const badge = TIER_BADGE[tier];
                const BIcon = badge.icon;
                return (
                  <div key={w.id} className={'char-card wb-card tier-' + tier} style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }} onClick={() => nav('/worldbook/' + w.id + '/edit')}>
                    <div className="cover wb-cover">
                      <div className="wb-cover-aurora" />
                      <div className="wb-cover-icon"><BIcon size={30} /></div>
                      <div className={'wb-tier-ribbon tier-' + tier}>
                        <BIcon size={11} /> {badge.name}档
                      </div>
                      {w.is_public ? <div className="pill-pub"><Globe size={12} /> 公开</div> : null}
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
