import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../api.jsx';
import { Logo } from '../assets.jsx';
import { LegalModal, LegalLinks } from './LegalModal.jsx';
import { ArrowLeft, LogIn, LayoutGrid, LifeBuoy } from 'lucide-react';

// Standalone shell for public marketing/help pages (/features, /help). Works both
// before and after login: header with brand + back/login, content, legal footer.
export default function PublicShell({ title, subtitle, active, children }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [legal, setLegal] = useState(null);

  const NAVS = [
    ['/features', '产品功能', LayoutGrid],
    ['/help', '帮助中心', LifeBuoy],
  ];

  return (
    // qa-unadapted：公共页（帮助/条款/关于）从没做过 App 适配 —— 实测 /help 上
    // 87 个可点元素**全部**小于 44px。这里不重画视觉，只让 app-tap.css 把热区兜到
    // 44px；类名只在 App 壳里有作用，Web 不受影响。
    <div className={'pubpage' + (isAppMode() ? ' qa-unadapted' : '')}>
      <header className="pubpage-top">
        <button className="pubpage-brand" onClick={() => nav(user ? '/' : '/auth')}>
          <Logo size={34} radius={10} />
          <span>幻域 <small>HUANYU</small></span>
        </button>
        <nav className="pubpage-nav">
          {NAVS.map(([to, label, Ic]) => (
            <button key={to} className={'pubpage-nav-link' + (active === to ? ' on' : '')} onClick={() => nav(to)}>
              <Ic size={15} /> {label}
            </button>
          ))}
        </nav>
        <button className="btn sm primary pubpage-enter" onClick={() => nav(user ? '/' : '/auth')}>
          {user ? <><ArrowLeft size={15} /> 返回应用</> : <><LogIn size={15} /> 登录 / 注册</>}
        </button>
      </header>

      <div className="pubpage-hero">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>

      <main className="pubpage-body">{children}</main>

      <footer className="pubpage-foot">
        <LegalLinks onOpen={setLegal} className="center" />
        <div className="pubpage-copy">© 2026 幻域 HUANYU · AI 角色扮演社区平台 · 在中华人民共和国现行法律法规下运行</div>
      </footer>

      {legal && <LegalModal docKey={legal} onClose={() => setLegal(null)} onOpen={setLegal} />}
    </div>
  );
}
