import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, uploadFile, assetUrl } from '../api.jsx';
import { parseCharacterCard } from '../charcard.js';
import { useToast, GridSkeleton } from '../ui.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { ArrowLeft, Globe, MessageCircle, Plus, RefreshCw, Search, X, Upload } from 'lucide-react';
import AppErrorState from '../components/AppErrorState.jsx';

export default function Library() {
  const appMode = isAppMode();
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState('all');
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef();

  // 导入角色卡：支持幻域 JSON / 酒馆 JSON / 酒馆 PNG（内嵌卡）。
  const importCard = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('文件过大（上限 8MB）', 'err'); return; }
    setImporting(true);
    try {
      const { character, world, worldbook, notices, imageBlob } = await parseCharacterCard(file);
      // PNG 卡：图片本身即立绘，上传为托管头像（服务端 avatar 存 URL，不能塞 data-URL）。
      if (imageBlob && !character.avatar) {
        try { const up = await uploadFile(imageBlob); if (up?.url) character.avatar = up.url; }
        catch { /* 头像上传失败不阻断导入，仍建角色 */ }
      }
      // 世界书条目随角色一并落入内嵌世界书（编辑页「世界书(N)」可见、计数正确）。
      const d = await api('/characters/import', { method: 'POST', body: { character, world: world || [] } });
      // 卡里用到了内嵌世界书表达不了的能力（选择性触发 / 概率 / 优先级 / 互斥分组 /
      // 深度 / 粘滞 / 冷却）时，charcard 会带出一本独立世界书 —— 这里建好并挂到角色上，
      // 完整保留而不是静默降级。建失败不阻断导入，但要如实告知。
      let wbCount = 0;
      if (worldbook?.entries?.length) {
        try {
          const wb = await api('/worldbooks', { method: 'POST', body: { name: worldbook.name, entries: worldbook.entries, max_active: 50 } });
          await api(`/worldbooks/${wb.worldbook.id}/attach/${d.character.id}`, { method: 'POST' });
          wbCount = worldbook.entries.length;
        } catch (e) {
          toast(`独立世界书创建失败（${e.message}），角色已导入但世界书需手动补建`, 'err');
        }
      }
      toast(`导入成功，已创建角色（世界书 ${wbCount || world?.length || 0} 条）`);
      (notices || []).forEach((n, i) => setTimeout(() => toast(n), 400 * (i + 1)));
      nav('/character/' + d.character.id + '/edit');
    } catch (err) {
      toast(err.message || '导入失败：不支持的文件格式', 'err');
    } finally { setImporting(false); }
  };

  const load = () => {
    setLoadError('');
    return api('/characters/mine')
      .then(d => setChars(d.characters))
      .catch(e => { setLoadError(e.message || '角色库载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const startChat = async (e, c) => {
    e.stopPropagation();
    try {
      const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } });
      nav('/chats/' + d.conversation.id);
    } catch (err) { toast(err.message, 'err'); }
  };
  const publish = async (e, c) => {
    e.stopPropagation();
    try { await api('/community/publish-character/' + c.id, { method: 'POST' }); toast('已发布到广场'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const del = async (e, c) => {
    e.stopPropagation();
    if (!confirm(`删除角色「${c.name}」？`)) return;
    try { await api('/characters/' + c.id, { method: 'DELETE' }); toast('已删除'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };

  const visibleChars = useMemo(() => {
    if (!appMode) return chars;
    const needle = q.trim().toLocaleLowerCase();
    return chars.filter(c => {
      if (visibility === 'public' && !c.is_public) return false;
      if (visibility === 'private' && c.is_public) return false;
      if (!needle) return true;
      return [c.name, c.tagline, c.intro, c.tags].some(value => String(value || '').toLocaleLowerCase().includes(needle));
    });
  }, [appMode, chars, q, visibility]);

  const openCharacter = (c) => nav('/character/' + c.id + '/edit');
  const LibraryShell = appMode ? 'div' : React.Fragment;

  return (
    <LibraryShell {...(appMode ? { className: 'qa-library-page' } : {})}>
      <div className={appMode ? 'topbar qa-library-topbar' : 'topbar'}>
        {appMode && <AppIconButton className="qa-library-back" onClick={() => nav('/me')} label="返回个人中心"><ArrowLeft size={20} /></AppIconButton>}
        <div style={{ flex: 1 }}>
          <h1>我的角色</h1>
          <div className="sub">创建并管理你的角色，配置立绘、动态背景与世界书</div>
        </div>
        {appMode ? (
          <>
            <AppIconButton className="qa-library-import" variant="secondary" loading={importing}
              onClick={() => fileRef.current?.click()} disabled={importing} label="导入角色卡"
              title="导入角色卡（支持幻域 JSON、酒馆 JSON / PNG 角色卡）"><Upload size={19} /></AppIconButton>
            <AppIconButton className="qa-library-create" variant="filled" onClick={() => nav('/character/new')} label="新建角色"><Plus size={20} /></AppIconButton>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing} title="导入角色卡（支持幻域 JSON、酒馆 JSON / PNG 角色卡）"><Upload size={15} style={{ verticalAlign: -3 }} /> {importing ? '导入中…' : '导入'}</button>
            <button className="btn primary" onClick={() => nav('/character/new')}><Plus size={16} style={{ verticalAlign: -3 }} /> 新建角色</button>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json,image/png,.png" style={{ display: 'none' }} onChange={importCard} />
      <div className={appMode ? 'page qa-library-content' : 'page'}>
        {appMode && (
          <div className="qa-library-controls" aria-label="角色筛选">
            <div className="qa-library-search">
              <Search size={18} aria-hidden="true" />
              <input value={q} onChange={e => setQ(e.target.value)} aria-label="搜索角色"
                placeholder="搜索名称、简介或标签" inputMode="search" />
              {q && <AppIconButton className="qa-library-search-clear" onClick={() => setQ('')} label="清除搜索"><X size={17} /></AppIconButton>}
            </div>
            <div className="qa-library-filters" role="group" aria-label="公开状态">
              <AppButton variant="tertiary" selected={visibility === 'all'} onClick={() => setVisibility('all')}>全部</AppButton>
              <AppButton variant="tertiary" selected={visibility === 'public'} onClick={() => setVisibility('public')}>已公开</AppButton>
              <AppButton variant="tertiary" selected={visibility === 'private'} onClick={() => setVisibility('private')}>未公开</AppButton>
            </div>
          </div>
        )}
        {loading ? <GridSkeleton n={6} /> :
          loadError && chars.length === 0 ? (
            app ? (
              <AppErrorState kind="library" title="角色库暂时无法载入" message={loadError} onRetry={() => { setLoading(true); load(); }} />
            ) : (
              <div className="empty lgw-error" role="alert">
                <span className="lgw-error-ic"><RefreshCw size={22} /></span>
                <h2 className="lgw-error-title">角色库暂时无法载入</h2>
                <p className="lgw-error-msg">{loadError}</p>
                <button className="btn primary lgw-error-retry" onClick={() => { setLoading(true); load(); }}><RefreshCw size={15} /> 重新载入</button>
              </div>
            )
          ) :
          visibleChars.length === 0 ? (
            <div className={appMode ? 'empty qa-library-empty' : 'empty'}>
              <EmptyArt kind="library" />{chars.length === 0 ? '还没有角色' : '没有符合条件的角色'}
              <div style={{ marginTop: 16 }}>
                {chars.length === 0
                  ? <AppButton className="btn primary" variant="primary" onClick={() => nav('/character/new')}>创建第一个角色</AppButton>
                  : <AppButton variant="secondary" onClick={() => { setQ(''); setVisibility('all'); }}>清除筛选</AppButton>}
              </div>
            </div>
          ) : (
            <div className={appMode ? 'grid qa-library-list' : 'grid'}>
              {visibleChars.map(c => (
                <div key={c.id} className={appMode ? 'char-card qa-library-card' : 'char-card'} onClick={() => openCharacter(c)}
                  {...(appMode ? { role: 'link', tabIndex: 0, 'aria-label': `编辑角色 ${c.name}`, onKeyDown: e => {
                    if (e.currentTarget !== e.target || !['Enter', ' '].includes(e.key)) return;
                    e.preventDefault(); openCharacter(c);
                  } } : {})}>
                  <div className={appMode ? 'cover qa-library-cover' : 'cover'}>
                    {c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                    {c.is_public ? <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 已公开</div> : null}
                  </div>
                  <div className={appMode ? 'meta qa-library-meta' : 'meta'}>
                    <h3>{c.name}</h3>
                    <p>{c.tagline || c.intro || '暂无简介'}</p>
                    <div className="foot">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageCircle size={13} /> {c.uses}</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <AppButton className="btn sm primary" size="sm" variant="primary" onClick={e => startChat(e, c)}>对话</AppButton>
                        {!c.is_public && <AppButton className="btn sm" size="sm" variant="secondary" onClick={e => publish(e, c)}>发布</AppButton>}
                        <AppIconButton className={'btn sm danger' + (appMode ? ' qa-library-delete' : '')} tone="danger" onClick={e => del(e, c)} label={`删除角色 ${c.name}`}><X size={appMode ? 17 : 14} /></AppIconButton>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </LibraryShell>
  );
}
