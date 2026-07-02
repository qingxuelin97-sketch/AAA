import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { CoverArt } from '../art.jsx';
import { Drama, ScrollText, Users, ArrowRight, Globe } from 'lucide-react';

export default function Publish() {
  const nav = useNavigate();
  const toast = useToast();
  const [mine, setMine] = useState([]);

  const load = () => api('/characters/mine').then(d => setMine(d.characters)).catch(() => {});
  useEffect(() => { load(); }, []);

  const publish = async (c) => {
    try { await api('/community/publish-character/' + c.id, { method: 'POST' }); toast('已发布到广场'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const OPTS = [
    { ic: Drama, t: '创建角色', d: '设计立绘、人设、世界书与动态背景', to: '/character/new', c: '#cc6a44' },
    { ic: ScrollText, t: '创作剧本', d: '编写剧情，可设为免费或金币付费', to: '/script/new', c: '#b3892f' },
    { ic: Users, t: '发布动态', d: '在社区分享你的创作与日常', to: '/community', c: '#3f8195' }
  ];

  return (
    <>
      <div className="topbar"><div style={{ flex: 1 }}><h1>发布作品</h1><div className="sub">把你的创意带给整个幻域社区</div></div></div>
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {OPTS.map(o => (
            <div key={o.t} className="card" style={{ cursor: 'pointer' }} onClick={() => nav(o.to)}>
              <div style={{ width: 48, height: 48, borderRadius: 13, display: 'grid', placeItems: 'center', background: o.c + '22', color: o.c, marginBottom: 12 }}><o.ic size={24} /></div>
              <h3 style={{ margin: '0 0 6px' }}>{o.t}</h3>
              <p className="muted" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{o.d}</p>
              <div style={{ marginTop: 12, color: o.c, fontSize: 13, fontWeight: 600 }}>开始 <ArrowRight size={13} style={{ verticalAlign: -2 }} /></div>
            </div>
          ))}
        </div>

        <div className="section-title" style={{ marginTop: 34 }}><h2>把已有角色发布到广场</h2></div>
        {mine.length === 0 ? <div className="empty" style={{ padding: 40 }}>还没有角色，先去创建一个吧</div> : (
          <div className="grid">
            {mine.map(c => (
              <div key={c.id} className="char-card">
                <div className="cover" onClick={() => nav('/character/' + c.id + '/edit')}>{c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                  {c.is_public ? <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 已公开</div> : null}</div>
                <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro || '暂无简介'}</p>
                  <div className="foot">
                    {c.is_public ? <span className="muted" style={{ fontSize: 12 }}>已在广场展示</span>
                      : <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => publish(c)}>发布到广场</button>}
                  </div></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
