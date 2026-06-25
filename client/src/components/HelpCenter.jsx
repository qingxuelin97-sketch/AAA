import React, { useMemo, useState } from 'react';
import { HELP } from '../help.js';
import {
  Rocket, Cpu, Volume2, Coins, Drama, Landmark, ShieldCheck, Server, LifeBuoy,
  Search, ChevronDown, HelpCircle,
} from 'lucide-react';

const ICONS = { Rocket, Cpu, Volume2, Coins, Drama, Landmark, ShieldCheck, Server, LifeBuoy };

// Reusable Help Center body. Rendered standalone on the public /help page and
// inline inside Settings → 帮助中心. Self-contained: search + collapsible Q&A.
export default function HelpCenter() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => ({})); // key `${cat}-${i}` → bool

  const kw = q.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!kw) return HELP;
    return HELP.map(g => ({
      ...g,
      items: g.items.filter(it => (it.q + it.a).toLowerCase().includes(kw)),
    })).filter(g => g.items.length || g.title.toLowerCase().includes(kw));
  }, [kw]);

  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  return (
    <div className="help">
      <div className="help-search">
        <Search size={16} />
        <input
          className="help-search-input"
          placeholder="搜索问题，例如：语音没声音、怎样配置模型、如何注册…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {q && <button className="help-search-clear" onClick={() => setQ('')}>清除</button>}
      </div>

      {groups.length === 0 && (
        <div className="help-empty"><HelpCircle size={28} /><p>没有找到相关内容，换个关键词试试，或通过平台内公告中的官方联系方式联系我们。</p></div>
      )}

      <div className="help-groups">
        {groups.map(g => {
          const Ic = ICONS[g.icon] || HelpCircle;
          return (
            <section className="help-group" key={g.id}>
              <header className="help-group-head">
                <span className="help-group-ic"><Ic size={18} /></span>
                <div><h3>{g.title}</h3><p>{g.desc}</p></div>
              </header>
              <div className="help-qa-list">
                {g.items.map((it, i) => {
                  const key = g.id + '-' + i;
                  const isOpen = kw ? true : !!open[key];
                  return (
                    <div className={'help-qa' + (isOpen ? ' open' : '')} key={key}>
                      <button className="help-q" onClick={() => toggle(key)} aria-expanded={isOpen}>
                        <span>{it.q}</span>
                        <ChevronDown size={16} className="help-q-chev" />
                      </button>
                      {isOpen && <div className="help-a">{it.a}</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
