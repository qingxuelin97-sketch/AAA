import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { BookOpen, Plus, Globe, BookLock, BookCheck, ArrowRight, Search, Sparkles,
  Image as ImageIcon, Layout, Sliders, Layers, Variable, GitBranch } from 'lucide-react';

// 能力徽章定义：按字段是否有数据派生，与编辑器一致。
const CAPS = [
  { key: 'cap_image', label: '图片注入', icon: ImageIcon, tier: 'expert' },
  { key: 'cap_front', label: '自构前端', icon: Layout, tier: 'expert' },
  { key: 'cap_overlay', label: '提示词叠加', icon: Sliders, tier: 'expert' },
  { key: 'cap_recursion', label: '递归触发', icon: Layers, tier: 'advanced' },
  { key: 'cap_variable', label: '世界变量', icon: Variable, tier: 'expert' },
  { key: 'cap_branch', label: '分支选择', icon: GitBranch, tier: 'expert' },
  { key: 'cap_vector', label: '语义检索', icon: Sparkles, tier: 'expert' },
];

export default function Worldbooks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('mine');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('hot');   // hot | new（仅公开广场）
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    const base = tab === 'mine' ? '/worldbooks/mine' : '/worldbooks/public';
    const params = new URLSearchParams();
    if (tab === 'public' && q) params.set('q', q);
    if (tab === 'public' && sort !== 'hot') params.set('sort', sort);
    const qs = params.toString();
    api(qs ? `${base}?${qs}` : base)
      .then(d => setList(d.worldbooks || []))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, sort]);

  return (
    <>
      <div className="topbar wb-list-topbar">
        <div style={{ flex: 1 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            世界书
            <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          </h1>
          <div className="sub">独立设定集 · 能力可共存 · 跨角色复用与预注入图片</div>
        </div>
        <button className="btn primary" onClick={() => nav('/worldbook/new/edit')}><Plus size={16} /> 新建世界书</button>
      </div>

      <div className="page wb-list">
        {/* —— 能力说明 hero —— */}
        <div className="wb-hero">
          <div className="wb-hero-aurora" />
          <div className="wb-hero-content">
            <div className="wb-hero-title">世界书能力体系</div>
            <div className="wb-hero-row">
              <div className="wb-hero-pill tier-normal"><BookOpen size={14} /> 通常<span className="wb-hero-pill-sub">关键词 / 常驻</span></div>
              <div className="wb-hero-pill tier-advanced"><Sliders size={14} /> 高级<span className="wb-hero-pill-sub">正则 / 分组 / 概率 / 计时</span></div>
              <div className="wb-hero-pill tier-expert"><Sparkles size={14} /> 专家<span className="wb-hero-pill-sub">图片 / 前端 / 变量 / 分支</span></div>
              <span className="wb-hero-note">三档能力可在同一本世界书共存，无需二选一</span>
            </div>
          </div>
        </div>

        <div className="wb-list-controls">
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的世界书</button>
            <button className={tab === 'public' ? 'active' : ''} onClick={() => setTab('public')}>公开广场</button>
          </div>
          {tab === 'public' && (
            <>
              <div className="seg seg-mini" style={{ marginBottom: 0 }}>
                <button className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>最热</button>
                <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>最新</button>
              </div>
              <div className="wb-search">
                <Search size={14} />
                <input placeholder="搜索名称/标签/简介" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
              </div>
            </>
          )}
        </div>

        {loading ? <GridSkeleton n={4} /> :
          list.length === 0 ? (
            <div className="empty wb-empty">
              <div className="big"><BookLock size={46} /></div>
              {tab === 'mine' ? <>还没有世界书<div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => nav('/worldbook/new/edit')}>创建第一本世界书</button></div></> : (q ? '没有匹配的世界书' : '广场还没有公开世界书')}
            </div>
          ) : (
            <div className="grid wb-grid">
              {list.map((w, i) => {
                const owned = user && w.owner_id === user.id;
                // 能力徽章：按字段派生
                const caps = CAPS.filter(c => w[c.key]);
                return (
                  <div key={w.id} className="char-card wb-card" style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
                    onClick={() => nav(owned ? '/worldbook/' + w.id + '/edit' : '/worldbook/' + w.id)}>
                    <div className="cover wb-cover">
                      <div className="wb-cover-aurora" />
                      <div className="wb-cover-icon"><BookOpen size={30} /></div>
                      {caps.length > 0 && <div className="wb-cap-ribbon">{caps.length} 项能力</div>}
                      {w.is_public ? <div className="pill-pub"><Globe size={12} /> 公开</div> : null}
                    </div>
                    <div className="meta">
                      <h3>{w.name}</h3>
                      <p>{w.description || '暂无简介'}</p>
                      {w.tags && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                        {String(w.tags).split(',').filter(Boolean).slice(0, 4).map((t, i) => <span key={i} className="tag">{t.trim()}</span>)}
                      </div>}
                      {caps.length > 0 && (
                        <div className="wb-card-caps">
                          {caps.map(c => {
                            const Icon = c.icon;
                            return <span key={c.key} className={`wb-cap-chip tier-${c.tier || 'expert'}`}><Icon size={10} /> {c.label}</span>;
                          })}
                        </div>
                      )}
                      <div className="foot">
                        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><BookCheck size={12} /> {w.entry_count || 0} 条</span>
                        {tab === 'public' && w.uses > 0 && <span className="muted" style={{ fontSize: 12 }}>· {w.uses} 次使用</span>}
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
