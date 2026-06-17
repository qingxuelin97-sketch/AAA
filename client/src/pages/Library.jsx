import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, GridSkeleton } from '../ui.jsx';
import { Drama, Globe, MessageCircle, Plus, X } from 'lucide-react';

export default function Library() {
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => api('/characters/mine').then(d => setChars(d.characters)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
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

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的角色</h1>
          <div className="sub">创建并管理你的角色，配置立绘、动态背景与世界书</div>
        </div>
        <button className="btn primary" onClick={() => nav('/character/new')}><Plus size={16} style={{ verticalAlign: -3 }} /> 新建角色</button>
      </div>
      <div className="page">
        {loading ? <GridSkeleton n={6} /> :
          chars.length === 0 ? (
            <div className="empty">
              <div className="big"><Drama size={46} /></div>还没有角色
              <div style={{ marginTop: 16 }}><button className="btn primary" onClick={() => nav('/character/new')}>创建第一个角色</button></div>
            </div>
          ) : (
            <div className="grid">
              {chars.map(c => (
                <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id + '/edit')}>
                  <div className="cover">
                    {c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={46} /></div>}
                    {c.is_public ? <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 已公开</div> : null}
                  </div>
                  <div className="meta">
                    <h3>{c.name}</h3>
                    <p>{c.tagline || c.intro || '暂无简介'}</p>
                    <div className="foot">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageCircle size={13} /> {c.uses}</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button className="btn sm primary" onClick={e => startChat(e, c)}>对话</button>
                        {!c.is_public && <button className="btn sm" onClick={e => publish(e, c)}>发布</button>}
                        <button className="btn sm danger" onClick={e => del(e, c)}><X size={14} /></button>
                      </div>
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
