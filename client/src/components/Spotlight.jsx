// Spotlight —— 自动轮播的精选角色聚光灯（原 pages/Home.jsx 内部组件原样搬出，
// D2 去 App 化重布局：Web 首页 WebHome 直接复用）。props 不变：items/onView/onChat。
// 样式沿用 web-super.css 的 .spotlight / .sp-* 家族；桌面首页的尺寸覆盖在
// web-lumen-home.css（html:not([data-app="1"]) 围栏内）。
import React, { useEffect, useState } from 'react';
import { assetUrl } from '../api.jsx';
import { Avatar, CreatorV } from '../ui.jsx';
import { MessageCircle, Drama, Star, ChevronLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import { CategoryIcon, categoryName } from '../assets.jsx';

// Auto-rotating spotlight of featured characters — the hero of the discover page.
export default function Spotlight({ items, onView, onChat }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = items.slice(0, 5);
  useEffect(() => {
    if (paused || list.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 5200);
    return () => clearInterval(t);
  }, [paused, list.length]);
  useEffect(() => { if (i >= list.length) setI(0); }, [i, list.length]);
  if (list.length === 0) return null;
  const c = list[i];
  const go = (d) => setI((x) => (x + d + list.length) % list.length);
  return (
    <div className="spotlight" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="sp-stage">
        {list.map((it, n) => (
          <div key={it.id} className={'sp-slide' + (n === i ? ' on' : '')} aria-hidden={n !== i}>
            {it.avatar ? <img src={assetUrl(it.avatar)} alt="" loading="lazy" decoding="async" /> : <div className="sp-ph"><Drama size={64} /></div>}
          </div>
        ))}
        <div className="sp-scrim" />
        <div className="sp-body">
          <span className="sp-tag"><Star size={12} fill="currentColor" /> 官方推荐</span>
          <h2 key={c.id}>{c.name}</h2>
          <p>{c.tagline || c.intro || '一个等待被开启的故事。'}</p>
          <div className="sp-meta">
            <span className="sp-author"><Avatar src={c.owner_avatar} name={c.owner_name} size={20} /> {c.owner_name}<CreatorV tier={c.owner_tier} size={13} /></span>
            <span><MessageCircle size={13} /> {c.uses}</span>
            {c.category && <span><CategoryIcon slug={c.category} size={13} /> {categoryName(c.category)}</span>}
          </div>
          <div className="sp-acts">
            <button className="btn primary" onClick={(e) => onChat(e, c)}><MessagesSquare size={16} /> 开始对话</button>
            <button className="btn glass" onClick={() => onView(c)}>查看详情</button>
          </div>
        </div>
        {list.length > 1 && <>
          <button className="sp-nav prev" onClick={() => go(-1)} aria-label="上一个"><ChevronLeft size={20} /></button>
          <button className="sp-nav next" onClick={() => go(1)} aria-label="下一个"><ChevronRight size={20} /></button>
        </>}
      </div>
      {list.length > 1 && (
        <div className="sp-dots">
          {list.map((_, n) => <button key={n} className={'sp-dot' + (n === i ? ' on' : '')} onClick={() => setI(n)} aria-label={'第' + (n + 1) + '个'} />)}
        </div>
      )}
    </div>
  );
}
