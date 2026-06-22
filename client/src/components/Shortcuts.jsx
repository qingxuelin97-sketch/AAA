import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setThemeMode, getThemeMode, resolveTheme } from '../theme.js';
import { Keyboard, X } from 'lucide-react';

// Chord targets: press `g` then the key.
const GOTO = {
  h: ['/', '发现广场'], e: ['/events', '活动'], c: ['/chats', '对话'], l: ['/library', '我的角色'],
  p: ['/parliament', '议会'], s: ['/settings', '设置'], w: ['/wallet', '钱包'], n: ['/notifications', '通知'],
  r: ['/leaderboard', '排行榜'], m: ['/community', '社区'], u: ['/profile', '我的主页'],
};

function isTyping(el) {
  if (!el) return false;
  const t = el.tagName; return t === 'INPUT' || t === 'TEXTAREA' || el.isContentEditable || t === 'SELECT';
}

export default function Shortcuts() {
  const nav = useNavigate();
  const [help, setHelp] = useState(false);
  const gPending = useRef(false);
  const gTimer = useRef();

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();

      // chord: g then <key>
      if (gPending.current) {
        gPending.current = false; clearTimeout(gTimer.current);
        if (GOTO[k]) { e.preventDefault(); nav(GOTO[k][0]); return; }
      }
      if (k === 'g') { gPending.current = true; clearTimeout(gTimer.current); gTimer.current = setTimeout(() => { gPending.current = false; }, 1300); return; }
      if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); setHelp(h => !h); return; }
      if (k === 't') { const cur = resolveTheme(getThemeMode()); setThemeMode(cur === 'dark' ? 'light' : 'dark'); return; }
      if (k === 'escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer.current); };
  }, [nav]);

  if (!help) return null;
  const rows = [
    ['命令面板 · 搜索', ['⌘', 'K']],
    ['快捷键帮助', ['?']],
    ['切换深 / 浅色', ['T']],
    ['前往发现广场', ['G', 'H']],
    ['前往对话', ['G', 'C']],
    ['前往我的角色', ['G', 'L']],
    ['前往议会', ['G', 'P']],
    ['前往钱包', ['G', 'W']],
    ['前往通知', ['G', 'N']],
    ['前往设置', ['G', 'S']],
    ['前往社区 / 排行榜', ['G', 'M / R']],
    ['关闭弹层', ['Esc']],
  ];
  return (
    <div className="sc-backdrop" onClick={() => setHelp(false)}>
      <div className="sc-card" onClick={e => e.stopPropagation()} role="dialog" aria-label="键盘快捷键">
        <div className="sc-head"><Keyboard size={18} /> <b>键盘快捷键</b><button className="sc-x" onClick={() => setHelp(false)} aria-label="关闭"><X size={16} /></button></div>
        <div className="sc-grid">
          {rows.map(([label, keys]) => (
            <div className="sc-row" key={label}>
              <span>{label}</span>
              <span className="sc-keys">{keys.map((kk, i) => <kbd key={i}>{kk}</kbd>)}</span>
            </div>
          ))}
        </div>
        <div className="sc-foot">提示：先按 <kbd>G</kbd> 再按目标键即可快速跳转。</div>
      </div>
    </div>
  );
}
