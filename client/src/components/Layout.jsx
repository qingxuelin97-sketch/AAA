import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth, api } from '../api.jsx';
import { Avatar } from '../ui.jsx';

const NAV = [
  { to: '/', ic: '🏠', label: '发现广场', end: true },
  { to: '/library', ic: '🎭', label: '我的角色' },
  { to: '/chats', ic: '💬', label: '对话' },
  { to: '/inbox', ic: '📨', label: '收件箱', badge: 'inbox' },
  { to: '/settings', ic: '⚙️', label: '设置' }
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api('/community/inbox').then(d => {
      if (alive) setUnseen(d.shares.filter(s => !s.seen).length);
    }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">🜲</div>
          <div><b>幻域</b><small>HUANYU AI</small></div>
        </div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <span className="ic">{n.ic}</span>{n.label}
            {n.badge === 'inbox' && unseen > 0 && <span className="nav-badge">{unseen}</span>}
          </NavLink>
        ))}
        <NavLink to="/publish" className="nav-item" style={{ marginTop: 6 }}>
          <span className="ic">✨</span>发布到广场
        </NavLink>

        <div className="sidebar-foot">
          <div className="user-chip" onClick={() => nav('/profile')}>
            <Avatar src={user?.avatar} name={user?.display_name} size={36} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name}</b>
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>@{user?.username}</span>
            </div>
            <span title="退出登录" onClick={(e) => { e.stopPropagation(); logout(); }} style={{ color: 'var(--faint)' }}>⏻</span>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
