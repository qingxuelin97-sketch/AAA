import React, { useEffect, useMemo, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { AppButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { Heart, RefreshCw } from 'lucide-react';

export default function Favorites() {
  const app = isAppMode();
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cat, setCat] = useState('all'); // S7-G10 App 分类筛选（Web 零变化）
  const toast = useToast();
  const nav = useNavigate();
  // 从收藏本身推导出现过的分类（≥2 类才展示筛选行，避免单类噪音）
  const cats = useMemo(() => [...new Set(chars.map(c => c.category).filter(Boolean))], [chars]);
  const shown = useMemo(() => (app && cat !== 'all' ? chars.filter(c => c.category === cat) : chars), [app, cat, chars]);

  const load = () => {
    if (!app) setLoading(true); // App 侧维持原刷新行为（不回骨架）
    setLoadError('');
    return api('/characters/favorites/list')
      .then(d => setChars(d.characters || []))
      .catch(e => { setLoadError(e.message || '收藏载入失败，请稍后重试'); toast(e.message, 'err'); })
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

  const unfavorite = async (e, c) => {
    e.stopPropagation();
    try {
      await api('/characters/' + c.id + '/favorite', { method: 'POST' });
      toast('已取消收藏');
      load();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的收藏</h1>
          <div className="sub">收藏的角色，随时开启对话</div>
        </div>
      </div>

      <div className="page">
        {app && !loading && cats.length >= 2 && (
          <div className="qa-fav-cats" role="group" aria-label="按分类筛选收藏">
            {[['all', '全部'], ...cats.map(k => [k, k])].map(([key, label]) => (
              <AppButton key={key} size="sm" variant="tertiary" selected={cat === key} pressed={cat === key} onClick={() => setCat(key)}>
                {label}
              </AppButton>
            ))}
          </div>
        )}
        {loading ? (
          <GridSkeleton n={4} />
        ) : !app && loadError && chars.length === 0 ? (
          <div className="empty lgw-error" role="alert">
            <span className="lgw-error-ic"><RefreshCw size={22} /></span>
            <h2 className="lgw-error-title">收藏暂时无法载入</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" onClick={() => load()}><RefreshCw size={15} /> 重新载入</button>
          </div>
        ) : chars.length === 0 ? (
          app
            ? <div className="empty"><EmptyArt kind="favorites" />还没有收藏角色<br /><span style={{ fontSize: 13 }}>在发现广场点亮心形，喜欢的角色就会住进这里</span></div>
            : (
              <div className="empty lgw-empty">
                <EmptyArt kind="favorites" />
                <h2 className="lgw-empty-title">还没有收藏角色</h2>
                <p className="lgw-empty-sub">在发现广场点亮心形，喜欢的角色就会住进这里。</p>
                <div className="lgw-empty-cta">
                  <button className="btn primary" onClick={() => nav('/')}>去发现广场逛逛</button>
                </div>
              </div>
            )
        ) : shown.length === 0 ? (
          <div className="empty"><EmptyArt kind="noresult" size={96} />该分类下暂无收藏</div>
        ) : (
          <div className="grid">
            {shown.map(c => (
              <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id)}>
                <div className="cover">
                  {c.avatar ? <img src={assetUrl(c.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                  <button
                    className="btn sm danger"
                    style={{ position: 'absolute', top: 8, right: 8 }}
                    title="取消收藏"
                    onClick={e => unfavorite(e, c)}
                  ><Heart size={14} fill="currentColor" /></button>
                </div>
                <div className="meta">
                  <h3>{c.name}</h3>
                  <p>{c.tagline || c.intro || '暂无简介'}</p>
                  {c.tags && c.tags.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                      {(Array.isArray(c.tags) ? c.tags : String(c.tags).split(',')).filter(Boolean).slice(0, 4).map((t, i) => (
                        <span key={i} className="tag tag-link" onClick={e => { e.stopPropagation(); nav('/search?q=' + encodeURIComponent(String(t).trim()) + '&tab=character'); }}>{t}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="foot">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Heart size={14} /> {c.likes || 0}
                    </span>
                    <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={e => startChat(e, c)}>对话</button>
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
