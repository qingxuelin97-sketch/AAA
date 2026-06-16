import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Bell } from 'lucide-react';

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    api('/social/notifications')
      .then(d => { if (alive) setItems(d.notifications || []); })
      .catch(e => toast(e.message, 'err'))
      .finally(() => { if (alive) setLoading(false); });
    api('/social/notifications/read', { method: 'POST' }).catch(() => { /* ignore */ });
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, []);

  const fmtDate = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>通知</h1>
          <div className="sub">点赞、评论、系统消息都在这里</div>
        </div>
      </div>

      <div className="page">
        {loading ? (
          <div className="empty">载入中…</div>
        ) : items.length === 0 ? (
          <div className="empty"><div className="big"><Bell size={46} /></div>暂时没有新通知</div>
        ) : (
          items.map(n => (
            <div
              key={n.id}
              className="card"
              style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-start', cursor: n.link ? 'pointer' : 'default' }}
              onClick={() => n.link && nav(n.link)}
            >
              <Bell size={20} style={{ flexShrink: 0, marginTop: 2, opacity: n.read ? 0.5 : 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: n.read ? 400 : 600 }}>{n.text}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{fmtDate(n.created_at)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
