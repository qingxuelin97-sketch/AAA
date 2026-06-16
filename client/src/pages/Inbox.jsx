import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';

export default function Inbox() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api('/community/inbox').then(d => setShares(d.shares)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
    api('/community/inbox/seen', { method: 'POST' }).catch(() => {});
  }, []);

  return (
    <>
      <div className="topbar"><div style={{ flex: 1 }}><h1>收件箱</h1><div className="sub">其他玩家推送给你的剧本与角色卡</div></div></div>
      <div className="page" style={{ maxWidth: 760 }}>
        {loading ? <div className="empty">载入中…</div> :
          shares.length === 0 ? <div className="empty"><div className="big">📭</div>还没有收到推送</div> : (
            shares.map(s => (
              <div key={s.id} className="card" style={{ marginBottom: 14, display: 'flex', gap: 16, alignItems: 'center', cursor: 'pointer' }}
                onClick={() => nav('/post/' + s.post_id)}>
                <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', fontSize: 26 }}>
                  {s.cover ? <img src={s.cover} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (s.type === 'script' ? '📜' : '🎭')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <b>{s.title}</b><span className="tag">{s.type === 'script' ? '剧本' : '角色卡'}</span>
                    {!s.seen && <span className="tag" style={{ background: 'rgba(86,214,160,0.15)', color: 'var(--ok)' }}>NEW</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    来自 <b style={{ color: 'var(--text)' }}>{s.from_name}</b>{s.note ? ` · “${s.note}”` : ''}
                  </div>
                </div>
                <span className="muted">→</span>
              </div>
            ))
          )}
      </div>
    </>
  );
}
