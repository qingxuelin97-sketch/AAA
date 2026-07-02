import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { shareUrl } from '../util.js';
import { BookOpen, ArrowLeft, Pencil, GitFork, Link2, Globe, BookLock, BookCheck, ChevronDown, ChevronUp,
  Users, Folder, Sparkles, Image as ImageIcon, Layout, Sliders, Layers, Variable, GitBranch, Plug, Check, BadgeCheck } from 'lucide-react';

// 世界书详情页：面向「使用者」的展示视角（编辑器面向作者）。
// 介绍这本书是什么、看得到条目结构、能一键挂载到自己的角色或 Fork 改造。
const CAPS = [
  { key: 'cap_image', label: '图片注入', icon: ImageIcon },
  { key: 'cap_front', label: '自构前端', icon: Layout },
  { key: 'cap_overlay', label: '提示词叠加', icon: Sliders },
  { key: 'cap_recursion', label: '递归触发', icon: Layers },
  { key: 'cap_variable', label: '世界变量', icon: Variable },
  { key: 'cap_branch', label: '分支选择', icon: GitBranch },
  { key: 'cap_vector', label: '语义检索', icon: Sparkles },
];

// 从条目派生能力徽章（详情接口返回完整条目，可直接在前端派生，与列表口径一致）。
function deriveCaps(w) {
  const es = w.entries || [];
  return {
    cap_image: es.some(e => e.image_urls && e.image_keys),
    cap_front: !!(w.front_schema && String(w.front_schema).trim()),
    cap_overlay: !!(w.prompt_overlay && String(w.prompt_overlay).trim()),
    cap_recursion: !!w.recursion,
    cap_variable: es.some(e => e.variable_write) || !!(w.variable_schema && String(w.variable_schema).trim()),
    cap_branch: es.some(e => e.branch),
    cap_vector: es.some(e => e.vectorize),
  };
}

export default function WorldbookView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [wb, setWb] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [chars, setChars] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/worldbooks/' + id).then(d => setWb(d.worldbook)).catch(e => { toast(e.message, 'err'); nav('/worldbooks'); });
    // eslint-disable-next-line
  }, [id]);

  const caps = useMemo(() => wb ? CAPS.filter(c => deriveCaps(wb)[c.key]) : [], [wb]);
  const folders = useMemo(() => {
    if (!wb) return [];
    const map = new Map();
    (wb.entries || []).forEach(e => {
      const f = e.folder || '';
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(e);
    });
    return [...map.entries()];
  }, [wb]);

  const isOwner = user && wb && wb.owner_id === user.id;

  const fork = async () => {
    if (busy) return; setBusy(true);
    try {
      const d = await api(`/worldbooks/${id}/fork`, { method: 'POST', body: {} });
      toast('已复制为我的世界书');
      nav('/worldbook/' + d.worldbook.id + '/edit');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const openAttach = async () => {
    setAttachOpen(true);
    try { const d = await api(`/worldbooks/${id}/attachments`); setChars(d.characters); }
    catch (e) { toast(e.message, 'err'); setAttachOpen(false); }
  };
  const toggleAttach = async (c) => {
    try {
      await api(`/worldbooks/${id}/attach/${c.id}`, { method: c.attached ? 'DELETE' : 'POST' });
      setChars(cs => cs.map(x => x.id === c.id ? { ...x, attached: !x.attached } : x));
      toast(c.attached ? `已从「${c.name}」卸下` : `已挂载到「${c.name}」`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl('/worldbook/' + id)); toast('链接已复制'); }
    catch { toast('复制失败', 'err'); }
  };

  if (!wb) return <div className="empty" style={{ paddingTop: 120 }}>展开卷轴…</div>;
  const shownFolders = showAll ? folders : folders.map(([f, es]) => [f, es]).slice(0, 50);
  const totalEntries = (wb.entries || []).length;
  let previewLeft = showAll ? Infinity : 12;

  return (
    <>
      <div className="topbar">
        <button className="btn ghost" onClick={() => nav('/worldbooks')}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{wb.name}
            {wb.is_public ? <span className="pill-pub" style={{ position: 'static' }}><Globe size={11} /> 公开</span> : <span className="pill-pub" style={{ position: 'static' }}><BookLock size={11} /> 私有</span>}
          </h1>
          <div className="sub">世界书 · {totalEntries} 条设定{wb.uses ? ` · 被使用 ${wb.uses} 次` : ''}</div>
        </div>
        <button className="btn ghost" onClick={copyLink} title="复制分享链接"><Link2 size={15} /></button>
        {isOwner
          ? <button className="btn primary" onClick={() => nav('/worldbook/' + id + '/edit')}><Pencil size={15} /> 编辑</button>
          : <button className="btn primary" onClick={fork} disabled={busy}><GitFork size={15} /> {busy ? '复制中…' : 'Fork 为我的'}</button>}
      </div>

      <div className="page wbv">
        {/* —— 卷首 —— */}
        <div className="wb-hero wbv-hero">
          <div className="wb-hero-aurora" />
          <div className="wb-hero-content">
            <div className="wbv-owner">
              <Avatar src={wb.owner_avatar} name={wb.owner_name} size={34} />
              <div>
                <b>{wb.owner_name || '创作者'}{wb.owner_verified ? <BadgeCheck size={13} style={{ marginLeft: 4, color: 'var(--accent)' }} /> : null}</b>
                <span className="muted">著</span>
              </div>
            </div>
            {wb.description && <p className="wbv-desc">{wb.description}</p>}
            {wb.tags && (
              <div className="wbv-tags">
                {String(wb.tags).split(',').filter(Boolean).map((t, i) => <span key={i} className="tag">{t.trim()}</span>)}
              </div>
            )}
            {caps.length > 0 && (
              <div className="wb-card-caps" style={{ marginTop: 10 }}>
                {caps.map(c => { const Icon = c.icon; return <span key={c.key} className="wb-cap-chip tier-expert"><Icon size={10} /> {c.label}</span>; })}
              </div>
            )}
            <div className="wbv-actions">
              <button className="btn sm" onClick={openAttach}><Plug size={13} /> 挂载到我的角色</button>
              {!isOwner && <button className="btn sm ghost" onClick={fork} disabled={busy}><GitFork size={13} /> Fork 改造</button>}
              {isOwner && <button className="btn sm ghost" onClick={() => nav('/worldbook/' + id + '/edit')}><Pencil size={13} /> 进入编辑器</button>}
            </div>
          </div>
        </div>

        {/* —— 条目总览 —— */}
        <div className="wbv-sec-title"><BookCheck size={14} /> 设定条目 <span className="muted">（{totalEntries} 条）</span></div>
        {totalEntries === 0 && <div className="empty" style={{ padding: 30 }}>这本书还没有条目</div>}
        {shownFolders.map(([folder, es]) => (
          <div key={folder || '_root'} className="wbv-folder">
            {folder && <div className="wbv-folder-hd"><Folder size={13} /> {folder} <span className="muted">{es.length} 条</span></div>}
            {es.map(e => {
              if (previewLeft <= 0) return null;
              previewLeft -= 1;
              const open = !!expanded[e.id];
              const keys = (e.keys || '').split(',').map(k => k.trim()).filter(Boolean);
              return (
                <div key={e.id} className={'wbv-entry' + (e.enabled === 0 || e.enabled === false ? ' off' : '')}>
                  <button className="wbv-entry-hd" onClick={() => setExpanded(x => ({ ...x, [e.id]: !open }))}>
                    <div className="wbv-entry-keys">
                      {e.mode === 'always' || keys.length === 0
                        ? <span className="wbv-key always">常驻</span>
                        : keys.slice(0, 6).map((k, i) => <span key={i} className="wbv-key">{k}</span>)}
                      {keys.length > 6 && <span className="muted" style={{ fontSize: 11 }}>+{keys.length - 6}</span>}
                    </div>
                    {e.comment && <span className="wbv-entry-note">{e.comment}</span>}
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {open && <div className="wbv-entry-body">{e.content}</div>}
                </div>
              );
            })}
          </div>
        ))}
        {!showAll && totalEntries > 12 && (
          <button className="btn block ghost" onClick={() => setShowAll(true)}>展开全部 {totalEntries} 条</button>
        )}
      </div>

      {attachOpen && (
        <Modal onClose={() => setAttachOpen(false)}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Plug size={18} /> 挂载到我的角色</h2>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>挂载后，与该角色对话时会按关键词自动注入这本书的设定。</p>
          {!chars && <div className="empty" style={{ padding: 24 }}>加载角色…</div>}
          {chars && chars.length === 0 && <div className="empty" style={{ padding: 24 }}>你还没有角色，先去创建一个吧</div>}
          {chars && chars.map(c => (
            <div key={c.id} className={'wbv-char-row' + (c.attached ? ' on' : '')} onClick={() => toggleAttach(c)}>
              <Avatar src={c.avatar} name={c.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{c.name}</b>
                <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.tagline || ''}</div>
              </div>
              {c.attached ? <span className="wbv-attached"><Check size={13} /> 已挂载</span> : <span className="muted" style={{ fontSize: 12 }}>点击挂载</span>}
            </div>
          ))}
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => setAttachOpen(false)}>完成</button>
        </Modal>
      )}
    </>
  );
}
