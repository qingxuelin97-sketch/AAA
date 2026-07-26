import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { isAppMode } from '../appmode.js';
import { Tags as TagsIcon, RefreshCw } from 'lucide-react';

// 标签广场：聚合公开角色与剧本的 tags 字段，按热度排成标签云。
// 点击标签跳转到搜索页（角色卡 tab）按关键词检索 —— 复用现有 LIKE 搜索，无需新后端查询。
export default function Tags() {
  const app = isAppMode();
  const nav = useNavigate();
  const toast = useToast();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    if (!app) { setLoading(true); setLoadError(''); }
    return api('/meta/tags').then(d => setTags(d.tags || []))
      .catch(e => { if (!app) setLoadError(e.message || '标签载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // 按热度映射字号：最热 26px，最小 13px
  const max = tags.length ? tags[0].count : 1;
  const sizeFor = (c) => 13 + Math.round((c / max) * 13);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>标签广场</h1>
          <div className="sub">按标签发现角色与剧本 · 共 {tags.length} 个热门标签</div>
        </div>
      </div>
      <div className="page">
        {loading ? (
          app ? <div className="empty">载入中…</div> : (
            <div className="lgw-skel-list" aria-hidden="true">{[0, 1, 2, 3].map(i => <div key={i} className="skel lgw-skel-sm" />)}</div>
          )
        ) : !app && loadError && tags.length === 0 ? (
          <div className="empty lgw-error" role="alert">
            <span className="lgw-error-ic"><TagsIcon size={22} /></span>
            <h2 className="lgw-error-title">标签广场暂时无法载入</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" onClick={() => void load()}><RefreshCw size={15} /> 重新载入</button>
          </div>
        ) : tags.length === 0 ? (
            app ? (
              <div className="empty" style={{ padding: 60 }}>
                <div className="big"><TagsIcon size={42} /></div>
                还没有足够的标签数据<br />
                <span className="muted" style={{ fontSize: 13 }}>为角色和剧本添加标签后，这里会聚合成标签云</span>
              </div>
            ) : (
              <div className="empty lgw-empty">
                <EmptyArt kind="search" />
                <h2 className="lgw-empty-title">还没有足够的标签数据</h2>
                <p className="lgw-empty-sub">为角色和剧本添加标签后，这里会聚合成标签云。</p>
                <div className="lgw-empty-cta"><button className="btn primary" onClick={() => nav('/character/new')}>去创建一个带标签的角色</button></div>
              </div>
            )
          ) : (
            <div className="tag-cloud">
              {tags.map(t => (
                <button key={t.name} className="tag-cloud-item" style={{ fontSize: sizeFor(t.count) }}
                  onClick={() => nav('/search?q=' + encodeURIComponent(t.name) + '&tab=character')}
                  title={`${t.name} · ${t.count} 个作品`}>
                  {t.name}<span className="tag-cloud-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}
      </div>
    </>
  );
}
