import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { useAuth, api } from '../api.jsx';
import { Avatar } from '../ui.jsx';
import { getThemeMode, resolveTheme, setThemeMode } from '../theme.js';
import { ACCENTS, getAccent, setAccent } from '../accent.js';
import {
  Search, Compass, PartyPopper, Dices, ScrollText, Users, Trophy, Megaphone,
  MessageCircle, Drama, Library, TrendingUp, Heart, Wallet, Bell, Settings,
  Sparkles, UserPlus, Moon, Sun, LogOut, CornerDownLeft, Command, ArrowUp, ArrowDown, Landmark, UserRound, Feather, Orbit, Palette
} from 'lucide-react';

// Flat list of navigable destinations (mirrors the sidebar) + quick actions.
const NAV = [
  { to: '/', ic: Compass, label: '发现广场', kw: 'home faxian guangchang discover' },
  { to: '/events', ic: PartyPopper, label: '活动', kw: 'events huodong' },
  { to: '/gacha', ic: Dices, label: '扭蛋机', kw: 'gacha niudan' },
  { to: '/scripts', ic: ScrollText, label: '剧本', kw: 'scripts juben' },
  { to: '/community', ic: Users, label: '社区', kw: 'community shequ' },
  { to: '/leaderboard', ic: Trophy, label: '排行榜', kw: 'leaderboard paihang' },
  { to: '/parliament', ic: Landmark, label: '议会 · 提案', kw: 'parliament yihui tian proposal' },
  { to: '/announcements', ic: Megaphone, label: '公告', kw: 'announcements gonggao' },
  { to: '/chats', ic: MessageCircle, label: '对话', kw: 'chats duihua' },
  { to: '/atelier', ic: Feather, label: '小说创作 · 工坊', kw: 'atelier novel xiaoshuo chuangzuo write ai' },
  { to: '/friends', ic: UserRound, label: '好友 · 私信', kw: 'friends haoyou sixin dm' },
  { to: '/groups', ic: Users, label: '群聊', kw: 'groups qunliao' },
  { to: '/theater', ic: Drama, label: '剧场 · 联机', kw: 'theater juchang' },
  { to: '/library', ic: Library, label: '我的角色', kw: 'library wodejuese' },
  { to: '/studio', ic: TrendingUp, label: '创作中心', kw: 'studio chuangzuo' },
  { to: '/insights', ic: Orbit, label: '星轨 · 我的旅程', kw: 'insights xinggui journey stats shuju' },
  { to: '/achievements', ic: Trophy, label: '成就', kw: 'achievements chengjiu trophy' },
  { to: '/favorites', ic: Heart, label: '收藏', kw: 'favorites shoucang' },
  { to: '/wallet', ic: Wallet, label: '钱包 / 充值', kw: 'wallet qianbao chongzhi recharge' },
  { to: '/notifications', ic: Bell, label: '通知', kw: 'notifications tongzhi' },
  { to: '/settings', ic: Settings, label: '设置', kw: 'settings shezhi' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [chars, setChars] = useState([]);
  const [recents, setRecents] = useState([]);
  const nav = useNavigate();
  const { logout } = useAuth();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Global open hotkey (⌘K / Ctrl+K) + custom event from topbar buttons.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('huanyu-cmdk', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('huanyu-cmdk', onOpen); };
  }, []);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQ(''); setActive(0); setChars([]);
      try { setRecents(JSON.parse(localStorage.getItem('recent_chars') || '[]').filter(c => c && c.id).slice(0, 5)); } catch { setRecents([]); }
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Live character search (debounced).
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 1) { setChars([]); return; }
    const t = setTimeout(() => {
      api('/characters/public?q=' + encodeURIComponent(term) + '&sort=hot')
        .then((d) => setChars((d.characters || []).slice(0, 6)))
        .catch(() => setChars([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const dark = resolveTheme(getThemeMode()) === 'dark';
  const actions = useMemo(() => ([
    { id: 'a-publish', ic: Sparkles, label: '发布作品', hint: '操作', run: () => nav('/publish') },
    { id: 'a-newchar', ic: UserPlus, label: '新建角色', hint: '操作', run: () => nav('/character/new') },
    { id: 'a-newnovel', ic: Feather, label: '小说创作工坊', hint: '操作', run: () => nav('/atelier') },
    { id: 'a-theme', ic: dark ? Sun : Moon, label: dark ? '切换到浅色模式' : '切换到深色模式', hint: '操作',
      run: () => setThemeMode(dark ? 'light' : 'dark'), keepOpen: true },
    { id: 'a-accent', ic: Palette, label: '换个主题色', hint: '操作',
      run: () => { const ids = ACCENTS.map(a => a.id); setAccent(ids[(ids.indexOf(getAccent()) + 1) % ids.length]); } },
    { id: 'a-wallet', ic: Wallet, label: '前往充值', hint: '操作', run: () => nav('/wallet') },
    { id: 'a-logout', ic: LogOut, label: '退出登录', hint: '操作', run: () => logout() },
  ]), [dark, nav, logout]);

  // Build the filtered, ordered result groups.
  const term = q.trim().toLowerCase();
  const navHits = useMemo(() => {
    if (!term) return NAV;
    return NAV.filter((n) => n.label.toLowerCase().includes(term) || n.kw.includes(term));
  }, [term]);
  const actionHits = useMemo(() => {
    if (!term) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(term));
  }, [term, actions]);

  const showRecents = !term && recents.length > 0;
  // Flatten into one indexed list for keyboard navigation.
  const flat = useMemo(() => {
    const rows = [];
    if (showRecents) recents.forEach((c) => rows.push({ kind: 'char', c }));
    chars.forEach((c) => rows.push({ kind: 'char', c }));
    navHits.forEach((n) => rows.push({ kind: 'nav', n }));
    actionHits.forEach((a) => rows.push({ kind: 'action', a }));
    return rows;
  }, [chars, navHits, actionHits, recents, showRecents]);

  useEffect(() => { if (active >= flat.length) setActive(0); }, [flat.length, active]);

  const run = (row) => {
    if (!row) return;
    if (row.kind === 'char') { nav('/character/' + row.c.id); setOpen(false); }
    else if (row.kind === 'nav') { nav(row.n.to); setOpen(false); }
    else if (row.kind === 'action') { row.a.run(); if (!row.a.keepOpen) setOpen(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[active]); }
  };

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector('.cmdk-row.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let idx = -1;
  const Row = ({ row, children, icon }) => {
    idx += 1; const i = idx;
    return (
      <button className={'cmdk-row' + (i === active ? ' active' : '')}
        onMouseEnter={() => setActive(i)} onClick={() => run(row)}>
        {icon}
        <span className="cmdk-label">{children}</span>
        {i === active && <CornerDownLeft size={14} className="cmdk-enter" />}
      </button>
    );
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="命令面板">
        <div className="cmdk-input">
          <Search size={18} className="muted" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown} placeholder="搜索角色、跳转页面或执行操作…" aria-label="命令搜索" />
          <kbd className="cmdk-esc">ESC</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {flat.length === 0 && <div className="cmdk-empty">没有找到「{q}」相关结果</div>}

          {showRecents && <div className="cmdk-group">最近浏览</div>}
          {showRecents && recents.map((c) => (
            <Row key={'r' + c.id} row={{ kind: 'char', c }} icon={<Avatar src={c.avatar} name={c.name} size={26} />}>
              <b>{c.name}</b>
              <small className="muted">{c.tagline || c.intro || '角色'}</small>
            </Row>
          ))}

          {chars.length > 0 && <div className="cmdk-group">角色</div>}
          {chars.map((c) => (
            <Row key={'c' + c.id} row={{ kind: 'char', c }}
              icon={<Avatar src={c.avatar} name={c.name} size={26} />}>
              <b>{c.name}</b>
              <small className="muted">{c.tagline || c.intro || '角色'}</small>
            </Row>
          ))}

          {navHits.length > 0 && <div className="cmdk-group">前往</div>}
          {navHits.map((n) => (
            <Row key={n.to} row={{ kind: 'nav', n }} icon={<span className="cmdk-ic"><n.ic size={17} /></span>}>
              {n.label}
            </Row>
          ))}

          {actionHits.length > 0 && <div className="cmdk-group">操作</div>}
          {actionHits.map((a) => (
            <Row key={a.id} row={{ kind: 'action', a }} icon={<span className="cmdk-ic"><a.ic size={17} /></span>}>
              {a.label}
            </Row>
          ))}
        </div>
        <div className="cmdk-foot">
          <span><ArrowUp size={12} /><ArrowDown size={12} /> 选择</span>
          <span><CornerDownLeft size={12} /> 打开</span>
          <span className="cmdk-foot-r"><Command size={12} /> K 随时唤起</span>
        </div>
      </div>
    </div>
  );
}
