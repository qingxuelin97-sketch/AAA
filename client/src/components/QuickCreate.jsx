import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../api.jsx';
import { Plus, X, UserPlus, Sparkles, ScrollText, Landmark } from 'lucide-react';

// Floating speed-dial for the most common creation actions.
export default function QuickCreate() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const go = (to) => { setOpen(false); nav(to); };
  const items = [
    { ic: UserPlus, label: '新建角色', to: '/character/new' },
    { ic: Sparkles, label: '发布作品', to: '/publish' },
    { ic: ScrollText, label: '新建剧本', to: '/script/new' },
    ...(user?.is_councilor ? [{ ic: Landmark, label: '发起提案', to: '/parliament' }] : []),
  ];

  return (
    <div className={'qc' + (open ? ' open' : '')}>
      {open && <div className="qc-mask" onClick={() => setOpen(false)} />}
      <div className="qc-menu" role="menu" aria-hidden={!open}>
        {items.map((it, i) => (
          <button key={it.to} className="qc-item" style={{ '--i': items.length - i }} onClick={() => go(it.to)} role="menuitem">
            <span className="qc-item-tx">{it.label}</span>
            <span className="qc-item-ic"><it.ic size={18} /></span>
          </button>
        ))}
      </div>
      <button className="qc-fab" onClick={() => setOpen(o => !o)} aria-label={open ? '关闭' : '快速创建'} title="快速创建">
        {open ? <X size={22} /> : <Plus size={24} />}
      </button>
    </div>
  );
}
