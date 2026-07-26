import React, { useEffect, useMemo, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { ArrowLeft, BookOpen, Plus, Globe, BookLock, BookCheck, ArrowRight, Search, Sparkles, X,
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
  const appMode = isAppMode();
  const { user } = useAuth();
  const [tab, setTab] = useState('mine');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('hot');   // hot | new（仅公开广场）
  const toast = useToast();
  const nav = useNavigate();

  const load = (qOverride) => {
    setLoading(true);
    const base = tab === 'mine' ? '/worldbooks/mine' : '/worldbooks/public';
    const params = new URLSearchParams();
    const effQ = typeof qOverride === 'string' ? qOverride : q;
    if (tab === 'public' && effQ) params.set('q', effQ);
    if (tab === 'public' && sort !== 'hot') params.set('sort', sort);
    const qs = params.toString();
    setLoadError('');
    api(qs ? `${base}?${qs}` : base)
      .then(d => setList(d.worldbooks || []))
      .catch(e => { setLoadError(e.message || '世界书载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, sort]);

  const visibleList = useMemo(() => {
    if (!appMode || tab !== 'mine' || !q.trim()) return list;
    const needle = q.trim().toLocaleLowerCase();
    return list.filter(w => [w.name, w.description, w.tags].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
  }, [appMode, list, q, tab]);

  const openWorldbook = (w, owned) => nav(owned ? '/worldbook/' + w.id + '/edit' : '/worldbook/' + w.id);
  const WorldbooksShell = appMode ? 'div' : React.Fragment;

  return (
    <WorldbooksShell {...(appMode ? { className: 'qa-worldbooks-page' } : {})}>
      <div className={appMode ? 'topbar wb-list-topbar qa-worldbooks-topbar' : 'topbar wb-list-topbar'}>
        {appMode && <AppIconButton className="qa-worldbooks-back" onClick={() => nav('/library')} label="返回角色库"><ArrowLeft size={20} /></AppIconButton>}
        <div style={{ flex: 1 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            世界书
            <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          </h1>
          <div className="sub">独立设定集 · 能力可共存 · 跨角色复用与预注入图片</div>
        </div>
        {appMode
          ? <AppIconButton className="qa-worldbooks-create" variant="filled" onClick={() => nav('/worldbook/new/edit')} label="新建世界书"><Plus size={20} /></AppIconButton>
          : <button className="btn primary" onClick={() => nav('/worldbook/new/edit')}><Plus size={16} /> 新建世界书</button>}
      </div>

      <div className={appMode ? 'page wb-list qa-worldbooks-content' : 'page wb-list'}>
        {/* —— 能力说明 hero —— */}
        <div className={appMode ? 'wb-hero qa-worldbooks-hero' : 'wb-hero'}>
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

        <div className={appMode ? 'wb-list-controls qa-worldbooks-controls' : 'wb-list-controls'}>
          <div className="seg" style={{ marginBottom: 0 }} role={appMode ? 'tablist' : undefined} aria-label={appMode ? '世界书来源' : undefined}>
            <AppButton className={tab === 'mine' ? 'active' : ''} variant="tertiary" selected={tab === 'mine'}
              role={appMode ? 'tab' : undefined} aria-selected={appMode ? tab === 'mine' : undefined} onClick={() => setTab('mine')}>我的世界书</AppButton>
            <AppButton className={tab === 'public' ? 'active' : ''} variant="tertiary" selected={tab === 'public'}
              role={appMode ? 'tab' : undefined} aria-selected={appMode ? tab === 'public' : undefined} onClick={() => setTab('public')}>公开广场</AppButton>
          </div>
          {tab === 'public' && (
            <div className="seg seg-mini" style={{ marginBottom: 0 }} role={appMode ? 'group' : undefined} aria-label={appMode ? '排序方式' : undefined}>
              <AppButton className={sort === 'hot' ? 'active' : ''} variant="tertiary" selected={sort === 'hot'} onClick={() => setSort('hot')}>最热</AppButton>
              <AppButton className={sort === 'new' ? 'active' : ''} variant="tertiary" selected={sort === 'new'} onClick={() => setSort('new')}>最新</AppButton>
            </div>
          )}
          {(appMode || tab === 'public') && <div className={appMode ? 'wb-search qa-worldbooks-search' : 'wb-search'}>
            <Search size={16} aria-hidden="true" />
            <input placeholder="搜索名称/标签/简介" aria-label="搜索世界书" inputMode="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && (tab === 'public' ? load() : null)} />
            {appMode && q && <AppIconButton className="qa-worldbooks-search-clear" onClick={() => setQ('')} label="清除搜索"><X size={16} /></AppIconButton>}
            {appMode && tab === 'public' && <AppIconButton className="qa-worldbooks-search-submit" variant="filled" onClick={load} label="执行搜索"><Search size={17} /></AppIconButton>}
          </div>}
        </div>

        {loading ? <GridSkeleton n={4} /> :
          !appMode && loadError && list.length === 0 ? (
            <div className="empty wb-empty lgw-error" role="alert">
              <span className="lgw-error-ic"><BookLock size={22} /></span>
              <h2 className="lgw-error-title">世界书暂时无法载入</h2>
              <p className="lgw-error-msg">{loadError}</p>
              <button className="btn primary lgw-error-retry" onClick={() => load()}>重新载入</button>
            </div>
          ) :
          visibleList.length === 0 ? (
            <div className={appMode ? 'empty wb-empty qa-worldbooks-empty' : 'empty wb-empty lgw-empty'}>
              <div className="big"><BookLock size={46} /></div>
              {tab === 'mine' ? (list.length === 0
                ? <>还没有世界书<div style={{ marginTop: 14 }}><AppButton className="btn primary" variant="primary" onClick={() => nav('/worldbook/new/edit')}>创建第一本世界书</AppButton></div></>
                : <>没有匹配的世界书<div style={{ marginTop: 14 }}><AppButton variant="secondary" onClick={() => setQ('')}>清除搜索</AppButton></div></>)
                : (appMode
                  ? (q ? '没有匹配的世界书' : '广场还没有公开世界书')
                  : (
                    <>
                      <h2 className="lgw-empty-title">{q ? '没有匹配的世界书' : '广场还没有公开世界书'}</h2>
                      <p className="lgw-empty-sub">{q ? '换个关键词试试，或者把你的设定集公开出来。' : '第一本公开世界书由你来写，发布后设定可以跨角色复用。'}</p>
                      <div className="lgw-empty-cta">
                        {q ? <button className="btn" onClick={() => { setQ(''); load(''); }}>清除搜索</button> : null}
                        <button className="btn primary" onClick={() => nav('/worldbook/new/edit')}>新建世界书</button>
                      </div>
                    </>
                  ))}
            </div>
          ) : (
            <div className={appMode ? 'grid wb-grid qa-worldbooks-list' : 'grid wb-grid'}>
              {visibleList.map((w, i) => {
                const owned = user && w.owner_id === user.id;
                // 能力徽章：按字段派生
                const caps = CAPS.filter(c => w[c.key]);
                return (
                  <div key={w.id} className={appMode ? 'char-card wb-card qa-worldbooks-card' : 'char-card wb-card'} style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
                    onClick={() => openWorldbook(w, owned)} {...(appMode ? { role: 'link', tabIndex: 0, 'aria-label': `${owned ? '编辑' : '查看'}世界书 ${w.name}`,
                      onKeyDown: e => { if (!['Enter', ' '].includes(e.key)) return; e.preventDefault(); openWorldbook(w, owned); } } : {})}>
                    <div className={appMode ? 'cover wb-cover qa-worldbooks-cover' : 'cover wb-cover'}>
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
    </WorldbooksShell>
  );
}
