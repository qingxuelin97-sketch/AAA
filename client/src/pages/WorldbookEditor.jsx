import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { Plus, ArrowLeft, Trash, BookOpen, Save, Globe, ChevronDown, ChevronUp,
  Settings2, Image as ImageIcon, Layout, Play, Eye, Sliders, Filter, Clock, Percent, Layers,
  Copy, Folder, FolderOpen, Search, Download, Upload, Variable, GitBranch, Sparkles, Timer,
  BookCheck, AlertTriangle, ArrowRight, Wand2, Check } from 'lucide-react';

const BLANK = {
  name: '', description: '', tags: '', is_public: false,
  front_schema: '', prompt_overlay: '', variable_schema: '',
  scan_depth: 4, token_budget: 0, recursion: false,
  max_active: 6, system_pos: 'after', recursion_depth: 2,
  entries: []
};

// 条目默认值：所有能力字段始终存在（不按档位剥离），按需填写即启用。
const newEntry = (folder = '') => ({
  keys: '', content: '', enabled: true,
  mode: 'keyword', inject_pos: 'after', priority: 50, case_sensitive: false, group_name: '', comment: '',
  exclude_keys: '', probability: 100, min_turns: 0, max_turns: 0, cooldown: 0,
  required_keys: '', sticky: 0, depth: 0,
  variable_write: '', branch: '', vectorize: false, tone: '',
  image_urls: '', image_keys: '', image_position: 'inline', front_slot: '',
  folder
});

// 保存前补齐缺失字段，保证数据完整。
const normalizeEntries = (entries) => entries.map(e => ({
  keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
  mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after', priority: e.priority ?? 50,
  case_sensitive: !!e.case_sensitive, group_name: e.group_name || '', comment: e.comment || '',
  exclude_keys: e.exclude_keys || '', probability: e.probability ?? 100, min_turns: e.min_turns ?? 0,
  max_turns: e.max_turns ?? 0, cooldown: e.cooldown ?? 0, required_keys: e.required_keys || '',
  sticky: e.sticky ?? 0, depth: e.depth ?? 0,
  variable_write: e.variable_write || '', branch: e.branch || '', vectorize: !!e.vectorize, tone: e.tone || '',
  image_urls: e.image_urls || '', image_keys: e.image_keys || '',
  image_position: e.image_position || 'inline', front_slot: e.front_slot || '',
  folder: e.folder || ''
}));

// front_schema 默认模板，让创作者一键起步
const DEFAULT_SCHEMA = JSON.stringify({
  layout: 'split', accent: '#d4677a',
  slots: [
    { id: 'banner', type: 'banner', bind: '', src: '' },
    { id: 'side', type: 'image-carousel', bind: 'scene' },
    { id: 'mood', type: 'text-bar', bind: 'mood' }
  ]
}, null, 2);

const DEFAULT_VAR_SCHEMA = JSON.stringify({
  met_queen: { type: 'bool', default: false },
  chapter: { type: 'number', default: 1 }
}, null, 2);

export default function WorldbookEditor() {
  const { id } = useParams();
  const editing = id && id !== 'new';
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [wb, setWb] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerId, setOwnerId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);   // 高级设定面板
  const [showExpert, setShowExpert] = useState(false);      // 专家能力面板
  const [showSchema, setShowSchema] = useState(false);
  const [showVarSchema, setShowVarSchema] = useState(false);
  const [preview, setPreview] = useState({ texts: [''], multi: false, result: null, loading: false });
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');     // '' = 全部
  const [statFilter, setStatFilter] = useState('all');      // all | always | trigger | disabled（概览仪表盘点选）
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [aiSplit, setAiSplit] = useState(null);   // AI 拆书：null 关闭 | { text, loading, result, picked }
  const fileRef = React.useRef(null);
  const readOnly = editing && user && ownerId != null && ownerId !== user.id;

  useEffect(() => {
    if (!editing) { setLoaded(true); return; }
    api('/worldbooks/' + id).then(d => {
      const w = d.worldbook;
      setOwnerId(w.owner_id);
      setWb({
        name: w.name, description: w.description, tags: w.tags,
        is_public: !!w.is_public, front_schema: w.front_schema || '', prompt_overlay: w.prompt_overlay || '',
        variable_schema: w.variable_schema || '',
        scan_depth: w.scan_depth ?? 4, token_budget: w.token_budget ?? 0, recursion: !!w.recursion,
        max_active: w.max_active ?? 6, system_pos: w.system_pos || 'after', recursion_depth: w.recursion_depth ?? 2,
        entries: (w.entries || []).map(e => ({
          keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
          mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after',
          priority: e.priority ?? 50, case_sensitive: !!e.case_sensitive,
          group_name: e.group_name || '', comment: e.comment || '',
          exclude_keys: e.exclude_keys || '', probability: e.probability ?? 100, min_turns: e.min_turns ?? 0,
          max_turns: e.max_turns ?? 0, cooldown: e.cooldown ?? 0, required_keys: e.required_keys || '',
          sticky: e.sticky ?? 0, depth: e.depth ?? 0,
          variable_write: e.variable_write || '', branch: e.branch || '', vectorize: !!e.vectorize, tone: e.tone || '',
          image_urls: e.image_urls || '', image_keys: e.image_keys || '',
          image_position: e.image_position || 'inline', front_slot: e.front_slot || '',
          folder: e.folder || '',
          _id: e.id
        }))
      });
      setLoaded(true);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const set = (k, v) => setWb(p => ({ ...p, [k]: v }));
  const addEntry = (folder = '') => {
    set('entries', [...wb.entries, newEntry(folder)]);
    setExpanded(p => ({ ...p, [wb.entries.length]: false }));
  };
  const updEntry = (i, k, v) => set('entries', wb.entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEntry = (i) => {
    set('entries', wb.entries.filter((_, j) => j !== i));
    setSelected(s => { const n = new Set(s); n.delete(i); return n; });
  };
  const dupEntry = (i) => {
    const copy = { ...wb.entries[i], _id: undefined };
    set('entries', [...wb.entries.slice(0, i + 1), copy, ...wb.entries.slice(i + 1)]);
    toast('已复制条目');
  };
  const toggleExpand = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  // —— 文件夹分组 ——
  const folders = useMemo(() => {
    const set2 = new Set();
    wb.entries.forEach(e => { if (e.folder) set2.add(e.folder); });
    return [...set2];
  }, [wb.entries]);

  // —— 搜索过滤 + 文件夹过滤 ——
  const filteredIdx = useMemo(() => {
    return wb.entries.map((e, i) => i).filter(i => {
      const e = wb.entries[i];
      if (folderFilter && e.folder !== folderFilter) return false;
      if (statFilter === 'always' && e.mode !== 'always') return false;
      if (statFilter === 'trigger' && (e.mode || 'keyword') === 'always') return false;
      if (statFilter === 'disabled' && e.enabled !== false) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (e.keys || '').toLowerCase().includes(q) ||
        (e.content || '').toLowerCase().includes(q) ||
        (e.comment || '').toLowerCase().includes(q) ||
        (e.group_name || '').toLowerCase().includes(q);
    });
  }, [wb.entries, search, folderFilter, statFilter]);

  // 按文件夹分组（无文件夹归到「未分组」）
  const grouped = useMemo(() => {
    const g = new Map();
    filteredIdx.forEach(i => {
      const e = wb.entries[i];
      const f = e.folder || '';
      if (!g.has(f)) g.set(f, []);
      g.get(f).push(i);
    });
    return [...g.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));
  }, [filteredIdx, wb.entries]);

  // —— 批量操作 ——
  const toggleSel = (i) => setSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const selAll = () => setSelected(new Set(filteredIdx));
  const selNone = () => setSelected(new Set());
  const batchSet = (k, v) => {
    set('entries', wb.entries.map((e, j) => selected.has(j) ? { ...e, [k]: v } : e));
    toast(`已应用到 ${selected.size} 条`);
  };
  const batchDel = () => {
    if (!selected.size) return;
    if (!confirm(`删除选中的 ${selected.size} 条条目？`)) return;
    set('entries', wb.entries.filter((_, j) => !selected.has(j)));
    setSelected(new Set());
    toast('已批量删除');
  };

  // —— 导入 / 导出 ——
  const exportJson = () => {
    const data = { ...wb, entries: normalizeEntries(wb.entries), _format: 'worldbook/v2', _at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${wb.name || 'worldbook'}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  // SillyTavern（酒馆）世界书：entries 为 { uid: {...} } 对象且字段名不同，识别后逐字段映射。
  const fromSillyTavern = (d) => {
    const src = d?.entries && !Array.isArray(d.entries) && typeof d.entries === 'object' ? Object.values(d.entries) : null;
    if (!src || !src.length || !src.some(e => e && (Array.isArray(e.key) || 'constant' in e || 'uid' in e))) return null;
    return src.map(e => ({
      keys: Array.isArray(e.key) ? e.key.join(', ') : String(e.key || ''),
      required_keys: Array.isArray(e.keysecondary) && e.selective ? e.keysecondary.join(', ') : '',
      content: String(e.content || ''),
      comment: String(e.comment || ''),
      enabled: !e.disable,
      mode: e.constant ? 'always' : 'keyword',
      priority: Math.max(0, Math.min(100, parseInt(e.order, 10) || 50)),
      probability: e.useProbability === false ? 100 : Math.max(0, Math.min(100, parseInt(e.probability ?? 100, 10) || 0)),
      case_sensitive: !!e.caseSensitive,
      group_name: String(e.group || ''),
      depth: Math.max(0, Math.min(50, parseInt(e.depth, 10) || 0)),
      sticky: Math.max(0, Math.min(99, parseInt(e.sticky, 10) || 0)),
      cooldown: Math.max(0, Math.min(999, parseInt(e.cooldown, 10) || 0)),
    })).filter(e => e.content || e.keys);
  };
  const importJson = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || typeof d !== 'object') throw new Error('格式非法');
        // 优先识别酒馆格式：只并入条目，不覆盖本书元信息。
        const st = fromSillyTavern(d);
        if (st) {
          setWb(p => ({ ...p, name: p.name || d.name || '', entries: [...p.entries, ...normalizeEntries(st)] }));
          toast(`已识别 SillyTavern 格式，导入 ${st.length} 条条目`);
          return;
        }
        const imported = normalizeEntries(Array.isArray(d.entries) ? d.entries : []);
        setWb(p => ({
          ...p,
          name: d.name || p.name, description: d.description || p.description, tags: d.tags || p.tags,
          front_schema: d.front_schema || p.front_schema, prompt_overlay: d.prompt_overlay || p.prompt_overlay,
          variable_schema: d.variable_schema || p.variable_schema,
          scan_depth: d.scan_depth ?? p.scan_depth, token_budget: d.token_budget ?? p.token_budget,
          recursion: d.recursion ?? p.recursion, max_active: d.max_active ?? p.max_active,
          system_pos: d.system_pos || p.system_pos, recursion_depth: d.recursion_depth ?? p.recursion_depth,
          entries: [...p.entries, ...imported]
        }));
        toast(`已导入 ${imported.length} 条条目`);
      } catch (e) { toast('导入失败：' + e.message, 'err'); }
    };
    reader.readAsText(file);
  };

  // —— AI 拆书：粘贴整段自由设定，交给用户自己的 LLM 拆成结构化条目，预览勾选后并入。
  const runAiSplit = async () => {
    const text = (aiSplit?.text || '').trim();
    if (!text) { toast('请先粘贴设定文本', 'err'); return; }
    setAiSplit(s => ({ ...s, loading: true }));
    try {
      const d = await api('/worldbooks/assist/extract', { method: 'POST', body: { text } });
      setAiSplit(s => s ? { ...s, loading: false, result: d.entries, picked: new Set(d.entries.map((_, i) => i)) } : s);
    } catch (e) { toast(e.message, 'err'); setAiSplit(s => s ? { ...s, loading: false } : s); }
  };
  const mergeAiSplit = () => {
    const list = (aiSplit?.result || []).filter((_, i) => aiSplit.picked.has(i));
    if (!list.length) { toast('未勾选任何条目', 'err'); return; }
    set('entries', [...wb.entries, ...normalizeEntries(list.map(e => ({ ...newEntry(), ...e })))]);
    toast(`已并入 ${list.length} 条条目，记得保存`);
    setAiSplit(null);
  };

  const save = async () => {
    if (!wb.name.trim()) { toast('请填写世界书名称', 'err'); return; }
    setBusy(true);
    try {
      const payload = { ...wb, entries: normalizeEntries(wb.entries) };
      delete payload._format; delete payload._at;
      if (editing) {
        await api('/worldbooks/' + id, { method: 'PUT', body: payload });
        toast('已保存');
      } else {
        const d = await api('/worldbooks', { method: 'POST', body: payload });
        toast('已创建');
        nav('/worldbook/' + d.worldbook.id + '/edit', { replace: true });
      }
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const del = async () => {
    if (!editing) return;
    if (!confirm(`删除世界书「${wb.name}」？关联的角色将自动解除关联。`)) return;
    try { await api('/worldbooks/' + id, { method: 'DELETE' }); toast('已删除'); nav('/worldbooks'); }
    catch (e) { toast(e.message, 'err'); }
  };

  // —— 预览：支持多段批量测试 + Token 估算 + 互斥告警 ——
  const runPreview = async () => {
    if (!editing) { toast('请先保存后再预览触发', 'err'); return; }
    setPreview(p => ({ ...p, loading: true }));
    try {
      const body = preview.multi
        ? { texts: preview.texts.filter(t => t.trim()) }
        : { text: preview.texts[0] || '' };
      const d = await api('/worldbooks/' + id + '/test-trigger', { method: 'POST', body: body });
      setPreview(p => ({ ...p, result: d, loading: false }));
    } catch (e) { toast(e.message, 'err'); setPreview(p => ({ ...p, loading: false })); }
  };

  // —— 派生能力徽章（三档身份）——
  const hasImage = wb.entries.some(e => e.image_urls && e.image_keys);
  const hasFront = !!wb.front_schema?.trim();
  const hasOverlay = !!wb.prompt_overlay?.trim();
  const hasRecursion = !!wb.recursion;
  const hasVariable = wb.entries.some(e => e.variable_write) || !!wb.variable_schema?.trim();
  const hasBranch = wb.entries.some(e => e.branch);
  const hasVector = wb.entries.some(e => e.vectorize);
  const advancedOn = wb.entries.some(e => e.required_keys || e.max_turns || e.cooldown || e.sticky || e.depth || e.group_name || e.exclude_keys || (e.probability != null && e.probability < 100) || e.min_turns);

  // —— 世界书概览：条目统计 + Token 估算（创作者一眼掌握全书规模与构成）——
  const stats = useMemo(() => {
    const es = wb.entries;
    const total = es.length;
    const enabled = es.filter(e => e.enabled !== false).length;
    const always = es.filter(e => e.mode === 'always').length;
    const trigger = es.filter(e => (e.mode || 'keyword') !== 'always').length;
    // 中文约 1 token/字，这里用 0.6 系数做粗略估算（含标点/英文混排），仅供参考。
    const tok = (arr) => Math.round(arr.reduce((n, e) => n + (e.content || '').length, 0) * 0.6);
    return {
      total, enabled, disabled: total - enabled, always, trigger,
      tokens: tok(es.filter(e => e.enabled !== false)),
      alwaysTokens: tok(es.filter(e => e.enabled !== false && e.mode === 'always')),
    };
  }, [wb.entries]);

  // —— 健康检查：揪出不会触发 / 配置不全的条目，避免「写了却没生效」——
  const lints = useMemo(() => {
    const out = [];
    wb.entries.forEach((e, i) => {
      const mode = e.mode || 'keyword';
      if (e.enabled === false) return;
      if ((mode === 'keyword' || mode === 'regex') && !(e.keys || '').trim())
        out.push({ i, msg: `第 ${i + 1} 条 · ${mode === 'regex' ? '正则' : '关键词'}模式却没填关键词，永远不会触发（改为「常驻」或补关键词）` });
      if (!(e.content || '').trim())
        out.push({ i, msg: `第 ${i + 1} 条 · 内容为空，触发了也注入不了任何设定` });
      if ((e.image_urls && !e.image_keys) || (!e.image_urls && e.image_keys))
        out.push({ i, msg: `第 ${i + 1} 条 · 预注入图片需同时填「图片地址」与「触发关键词」` });
      if ((e.front_slot || '').trim() && !(wb.front_schema || '').trim())
        out.push({ i, msg: `第 ${i + 1} 条 · 指定了前端槽位，但还没配置「自构前端」Schema` });
    });
    return out;
  }, [wb.entries, wb.front_schema]);
  const [showLints, setShowLints] = useState(false);

  // 跳转并展开某条目（清掉过滤，确保它可见），平滑滚动到视图中央。
  const jumpTo = (i) => {
    setSearch(''); setFolderFilter('');
    setCollapsedFolders({});
    setExpanded(p => ({ ...p, [i]: true }));
    setTimeout(() => {
      const el = document.querySelector(`.world-entry[data-eidx="${i}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el) { el.classList.add('wb-flash'); setTimeout(() => el.classList.remove('wb-flash'), 1400); }
    }, 80);
  };

  if (!loaded) return (
    <><div className="topbar"><button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button><div style={{ flex: 1 }}><h1>世界书</h1></div></div>
      <div className="page"><div className="empty">载入中…</div></div></>
  );

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1 }}>
          <h1>{editing ? wb.name || '世界书' : '新建世界书'}</h1>
          <div className="sub"><BookOpen size={11} style={{ verticalAlign: -1 }} /> 独立世界书 · 可跨角色复用 · 通常/高级/专家能力可共存{readOnly ? ' · 只读' : ''}</div>
        </div>
        {editing && !readOnly && <button className="btn ghost" onClick={exportJson} title="导出 JSON"><Download size={15} /></button>}
        {!readOnly && <button className="btn ghost" onClick={() => fileRef.current?.click()} title="导入 JSON（支持本站与 SillyTavern 酒馆格式）"><Upload size={15} /></button>}
        {!readOnly && <button className="btn ghost" onClick={() => setAiSplit({ text: '', loading: false, result: null, picked: new Set() })} title="AI 拆书：粘贴大段设定，自动拆成条目"><Wand2 size={15} /></button>}
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; }} />
        {editing && !readOnly && <button className="btn ghost danger" onClick={del} title="删除"><Trash size={15} /></button>}
        {!readOnly && <button className="btn primary" onClick={save} disabled={busy}><Save size={15} /> {busy ? '保存中…' : '保存'}</button>}
      </div>

      <div className="page wb-editor">
        {/* —— 三档身份徽章（通常/高级/专家，三类可共存）—— */}
        <div className="wb-cap-bar">
          <span className="wb-cap-badge tier-normal on"><BookOpen size={11} /> 通常<span className="muted"> 关键词</span></span>
          {advancedOn && <span className="wb-cap-badge tier-advanced on"><Sliders size={11} /> 高级<span className="muted"> 概率/分组/计时</span></span>}
          {hasImage && <span className="wb-cap-badge tier-expert on"><ImageIcon size={11} /> 图片注入</span>}
          {hasFront && <span className="wb-cap-badge tier-expert on"><Layout size={11} /> 自构前端</span>}
          {hasOverlay && <span className="wb-cap-badge tier-expert on"><Sliders size={11} /> 提示词叠加</span>}
          {hasRecursion && <span className="wb-cap-badge tier-advanced on"><Layers size={11} /> 递归</span>}
          {hasVariable && <span className="wb-cap-badge tier-expert on"><Variable size={11} /> 世界变量</span>}
          {hasBranch && <span className="wb-cap-badge tier-expert on"><GitBranch size={11} /> 分支</span>}
          {hasVector && <span className="wb-cap-badge tier-expert on"><Sparkles size={11} /> 语义检索</span>}
        </div>

        {/* —— 世界书概览：规模统计 + Token 估算 + 健康检查 —— */}
        {wb.entries.length > 0 && (
          <div className="wb-overview">
            <div className="wb-ov-stats">
              <button type="button" className={'wb-ov-stat' + (statFilter === 'all' ? ' active' : '')} onClick={() => setStatFilter('all')}><b>{stats.total}</b><span>全部条目</span></button>
              <button type="button" className={'wb-ov-stat' + (statFilter === 'always' ? ' active' : '')} onClick={() => setStatFilter(f => f === 'always' ? 'all' : 'always')}><b>{stats.always}</b><span>常驻</span></button>
              <button type="button" className={'wb-ov-stat' + (statFilter === 'trigger' ? ' active' : '')} onClick={() => setStatFilter(f => f === 'trigger' ? 'all' : 'trigger')}><b>{stats.trigger}</b><span>触发型</span></button>
              {stats.disabled > 0 && <button type="button" className={'wb-ov-stat dim' + (statFilter === 'disabled' ? ' active' : '')} onClick={() => setStatFilter(f => f === 'disabled' ? 'all' : 'disabled')}><b>{stats.disabled}</b><span>已停用</span></button>}
              <div className="wb-ov-stat tokens" title="按启用条目内容粗略估算，常驻条目恒定占用上下文">
                <b>≈{stats.tokens}</b><span>预估 Token{stats.alwaysTokens > 0 ? ` · 常驻${stats.alwaysTokens}` : ''}</span>
              </div>
            </div>
            {lints.length === 0 ? (
              <div className="wb-ov-health ok"><BookCheck size={14} /> 配置健康，没有发现明显问题</div>
            ) : (
              <div className="wb-ov-health warn">
                <button className="wb-ov-health-toggle" onClick={() => setShowLints(s => !s)}>
                  <AlertTriangle size={14} /> {lints.length} 处可能影响触发的配置
                  {showLints ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showLints && (
                  <ul className="wb-ov-lint-list">
                    {lints.map((l, k) => (
                      <li key={k}><button onClick={() => jumpTo(l.i)}>{l.msg} <ArrowRight size={12} /></button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* —— 基础信息 —— */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>名称</label>
            <input className="input" placeholder="如：圣域世界观" value={wb.name} onChange={e => set('name', e.target.value)} maxLength={60} disabled={readOnly} />
          </div>
          <div className="field">
            <label>简介</label>
            <textarea className="textarea" placeholder="这个世界书涵盖哪些设定？方便复用时筛选" value={wb.description} onChange={e => set('description', e.target.value)} maxLength={500} rows={2} disabled={readOnly} />
          </div>
          <div className="field">
            <label>标签（逗号分隔）</label>
            <input className="input" placeholder="奇幻, 魔法, 中世纪" value={wb.tags} onChange={e => set('tags', e.target.value)} maxLength={200} disabled={readOnly} />
          </div>
          <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={wb.is_public} onChange={e => set('is_public', e.target.checked)} disabled={readOnly} />
            <span className="track" />
            <span style={{ fontSize: 13.5 }}><Globe size={12} style={{ verticalAlign: -1 }} /> 公开到广场（其他用户可关联复用）</span>
          </label>
        </div>

        {/* —— 高级设定面板（折叠）—— */}
        <div className="card wb-advanced-panel">
          <button className="wb-advanced-toggle" onClick={() => setShowAdvanced(s => !s)} disabled={readOnly}>
            <Sliders size={16} /> 高级设定
            <span className="wb-adv-summary">
              {wb.scan_depth}轮回看{wb.token_budget > 0 ? ` · ${wb.token_budget}Token` : ' · 不限Token'}{wb.recursion ? ` · 递归${wb.recursion_depth}轮` : ''} · 最多激活{wb.max_active}
            </span>
            {showAdvanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showAdvanced && (
            <div className="wb-advanced-body">
              <div className="wb-adv-section">
                <div className="wb-adv-section-head"><Sliders size={13} /> 触发扫描</div>
                <div className="wb-adv-grid">
                  <div className="field" style={{ margin: 0 }}>
                    <label>扫描深度 <span className="muted">（回看最近几轮对话）</span></label>
                    <input type="number" className="input" min={1} max={50} value={wb.scan_depth} onChange={e => set('scan_depth', +e.target.value || 4)} disabled={readOnly} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Token 预算 <span className="muted">（0 = 不限）</span></label>
                    <input type="number" className="input" min={0} max={8000} value={wb.token_budget} onChange={e => set('token_budget', +e.target.value || 0)} disabled={readOnly} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>最大激活条目数 <span className="muted">（防 Token 爆炸）</span></label>
                    <input type="number" className="input" min={1} max={50} value={wb.max_active} onChange={e => set('max_active', +e.target.value || 6)} disabled={readOnly} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>系统提示词注入位置</label>
                    <select className="input" value={wb.system_pos} onChange={e => set('system_pos', e.target.value)} disabled={readOnly}>
                      <option value="after">角色设定后（默认）</option>
                      <option value="before">角色设定前</option>
                      <option value="front">最前方</option>
                    </select>
                  </div>
                  <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 8 }}>
                    <input type="checkbox" checked={!!wb.recursion} onChange={e => set('recursion', e.target.checked)} disabled={readOnly} />
                    <span className="track" />
                    <span style={{ fontSize: 12.5 }}><Layers size={11} style={{ verticalAlign: -1 }} /> 递归触发</span>
                  </label>
                  {wb.recursion && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>递归最大轮数</label>
                      <input type="number" className="input" min={1} max={10} value={wb.recursion_depth} onChange={e => set('recursion_depth', +e.target.value || 2)} disabled={readOnly} />
                    </div>
                  )}
                </div>
              </div>

              <div className="wb-adv-section">
                <div className="wb-adv-section-head"><Sliders size={13} /> 提示词叠加 prompt_overlay</div>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                  拼接在系统提示词的指令模板，可定制角色语气、叙述风格、节奏控制。留空则不启用。
                </p>
                <textarea className="textarea mono" rows={3} value={wb.prompt_overlay} onChange={e => set('prompt_overlay', e.target.value)} disabled={readOnly}
                  placeholder="例：以电影分镜方式叙述场景，每段 ≤ 80 字，重要意象后插入 [[wbimg:对应条目ID]] 标记。" />
              </div>
            </div>
          )}
        </div>

        {/* —— 专家能力面板（折叠，独立于高级设定）—— */}
        <div className="card wb-expert-panel">
          <button className="wb-advanced-toggle expert" onClick={() => setShowExpert(s => !s)} disabled={readOnly}>
            <Sparkles size={16} /> 专家能力
            <span className="wb-adv-summary">
              {hasFront ? ' · 含前端' : ''}{hasVariable ? ' · 含变量' : ''}{hasBranch ? ' · 含分支' : ''}{hasVector ? ' · 含语义' : ''}
            </span>
            {showExpert ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showExpert && (
            <div className="wb-advanced-body">
              {/* 自构对话前端 */}
              <div className="wb-adv-section">
                <div className="wb-adv-section-head">
                  <Layout size={13} /> 自构对话前端 front_schema
                  <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => { setShowSchema(s => !s); if (!wb.front_schema) set('front_schema', DEFAULT_SCHEMA); }} disabled={readOnly}>
                    {showSchema ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showSchema ? '收起' : '展开'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                  定义玩家在对话页见到的布局：banner / 侧边图片轮播 / 心情文本条。条目可通过 front_slot 绑定到对应 slot。留空则不启用。
                </p>
                {showSchema && (
                  <textarea className="textarea mono" rows={9} value={wb.front_schema} onChange={e => set('front_schema', e.target.value)} disabled={readOnly}
                    placeholder={DEFAULT_SCHEMA} spellCheck={false} />
                )}
              </div>

              {/* 世界变量声明 */}
              <div className="wb-adv-section">
                <div className="wb-adv-section-head">
                  <Variable size={13} /> 世界变量声明 variable_schema
                  <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => { setShowVarSchema(s => !s); if (!wb.variable_schema) set('variable_schema', DEFAULT_VAR_SCHEMA); }} disabled={readOnly}>
                    {showVarSchema ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showVarSchema ? '收起' : '展开'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                  声明世界变量（变量名/类型/默认值）。条目可通过 variable_write 写入变量，branch 按变量值选不同 content。运行时模型可在回复中嵌入 {'{{set:var=value}}'} 指令更新变量。留空则不启用。
                </p>
                {showVarSchema && (
                  <textarea className="textarea mono" rows={7} value={wb.variable_schema} onChange={e => set('variable_schema', e.target.value)} disabled={readOnly}
                    placeholder={DEFAULT_VAR_SCHEMA} spellCheck={false} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* —— 条目列表 —— */}
        <div className="section-title wb-list-head" style={{ marginTop: 20 }}>
          <h2>设定条目 ({wb.entries.length})</h2>
          <div className="wb-list-actions">
            <div className="wb-search-inline">
              <Search size={13} />
              <input placeholder="搜索关键词/内容/备注" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input sm" value={folderFilter} onChange={e => setFolderFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="">全部文件夹</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {!readOnly && <button className="btn sm" onClick={() => addEntry(folderFilter)}><Plus size={14} /> 添加条目</button>}
          </div>
        </div>
        <p className="muted wb-tier-hint">
          角色对话出现「触发关键词」时设定自动注入；留空关键词为常驻设定。点击条目右侧 <ChevronDown size={11} style={{ verticalAlign: -1 }} /> 展开高级配置（触发条件 / 注入与分组 / 计时与概率 / 预注入图片 / 专家能力）。
        </p>

        {/* —— 批量操作栏 —— */}
        {selected.size > 0 && !readOnly && (
          <div className="wb-batch-bar">
            <span>已选 {selected.size} 条</span>
            <button className="btn sm ghost" onClick={selAll}>全选</button>
            <button className="btn sm ghost" onClick={selNone}>取消</button>
            <span className="muted" style={{ fontSize: 11.5 }}>批量：</span>
            <button className="btn sm" onClick={() => batchSet('enabled', true)}>启用</button>
            <button className="btn sm" onClick={() => batchSet('enabled', false)}>禁用</button>
            <button className="btn sm" onClick={() => { const f = prompt('移动到文件夹：'); if (f != null) batchSet('folder', f.trim()); }}>移至文件夹</button>
            <button className="btn sm danger" onClick={batchDel}><Trash size={12} /> 删除</button>
          </div>
        )}

        {wb.entries.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目{readOnly ? '' : '，点击右上角添加或导入 JSON'}</div>}
        {wb.entries.length > 0 && filteredIdx.length === 0 && (
          <div className="empty" style={{ padding: 30, fontSize: 13.5 }}>
            没有符合当前筛选的条目
            <div style={{ marginTop: 10 }}><button className="btn sm ghost" onClick={() => { setStatFilter('all'); setSearch(''); setFolderFilter(''); }}>清除筛选</button></div>
          </div>
        )}

        {/* —— 按文件夹分组渲染 —— */}
        {grouped.map(([folder, idxs]) => {
          const hasFolder = !!folder;
          const collapsed = collapsedFolders[folder];
          return (
            <div key={folder || '__none'} className="wb-folder-group">
              {hasFolder && (
                <div className="wb-folder-head" onClick={() => setCollapsedFolders(p => ({ ...p, [folder]: !p[folder] }))}>
                  {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
                  <span className="wb-folder-name">{folder}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{idxs.length} 条</span>
                  {!readOnly && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={(ev) => { ev.stopPropagation(); addEntry(folder); }}><Plus size={12} /> 添加</button>}
                </div>
              )}
              {!collapsed && idxs.map(i => {
                const w = wb.entries[i];
                const isSel = selected.has(i);
                return (
                  <div key={i} className="world-entry" data-selected={isSel} data-eidx={i}>
                    <div className="top">
                      {!readOnly && (
                        <label className="switch" style={{ flexShrink: 0 }}>
                          <input type="checkbox" checked={isSel} onChange={() => toggleSel(i)} />
                          <span className="track" style={{ width: 16, height: 16 }} />
                        </label>
                      )}
                      <input className="input" style={{ flex: 1 }}
                        placeholder={w.mode === 'regex' ? '正则表达式，逗号分隔多个' : w.mode === 'always' ? '常驻条目无需关键词' : '触发关键词，逗号分隔（留空=常驻）'}
                        value={w.keys} onChange={e => updEntry(i, 'keys', e.target.value)} disabled={readOnly} />
                      <select className="input" style={{ width: 'auto', minWidth: 92 }} value={w.mode || 'keyword'} onChange={e => updEntry(i, 'mode', e.target.value)} disabled={readOnly}>
                        <option value="keyword">关键词</option>
                        <option value="regex">正则</option>
                        <option value="always">常驻</option>
                      </select>
                      <label className="switch">
                        <input type="checkbox" checked={w.enabled !== false} onChange={e => updEntry(i, 'enabled', e.target.checked)} disabled={readOnly} />
                        <span className="track" />
                      </label>
                      <button className="btn sm ghost" onClick={() => toggleExpand(i)} title="高级配置" disabled={readOnly}>
                        {expanded[i] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {!readOnly && <button className="btn sm ghost" onClick={() => dupEntry(i)} title="复制"><Copy size={13} /></button>}
                      {!readOnly && <button className="btn sm danger" onClick={() => delEntry(i)} title="删除"><Trash size={13} /></button>}
                    </div>
                    <textarea className="textarea" placeholder="设定内容，例如：「圣城阿斯特拉位于浮空岛之上，由七位贤者守护…」"
                      value={w.content} onChange={e => updEntry(i, 'content', e.target.value)} disabled={readOnly} />

                    {expanded[i] && (
                      <div className="we-advanced">
                        {/* 块1：触发条件 */}
                        <div className="we-block">
                          <div className="we-block-head"><Filter size={12} /> 触发条件</div>
                          <div className="we-adv-grid">
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="checkbox" checked={!!w.case_sensitive} onChange={e => updEntry(i, 'case_sensitive', e.target.checked)} disabled={readOnly} />
                              <span className="track" />
                              <span style={{ fontSize: 12.5 }}>大小写敏感</span>
                            </label>
                            <div className="field" style={{ margin: 0 }}>
                              <label>排除关键词 <span className="muted">（出现任一则不触发）</span></label>
                              <input className="input" placeholder="例：梦境, 幻觉" value={w.exclude_keys || ''} onChange={e => updEntry(i, 'exclude_keys', e.target.value)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>AND 关键词 <span className="muted">（必须全部命中）</span></label>
                              <input className="input" placeholder="例：圣城, 城门" value={w.required_keys || ''} onChange={e => updEntry(i, 'required_keys', e.target.value)} disabled={readOnly} />
                            </div>
                          </div>
                        </div>

                        {/* 块2：注入与分组 */}
                        <div className="we-block">
                          <div className="we-block-head"><Sliders size={12} /> 注入与分组</div>
                          <div className="we-adv-grid">
                            <div className="field" style={{ margin: 0 }}>
                              <label>注入位置</label>
                              <select className="input" value={w.inject_pos || 'after'} onChange={e => updEntry(i, 'inject_pos', e.target.value)} disabled={readOnly}>
                                <option value="after">角色设定后（默认）</option>
                                <option value="before">角色设定前</option>
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>优先级 <span className="muted">({w.priority ?? 50})</span></label>
                              <input type="range" min="0" max="100" value={w.priority ?? 50} onChange={e => updEntry(i, 'priority', +e.target.value)} disabled={readOnly} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>互斥分组</label>
                              <input className="input" placeholder="留空=不互斥；同组只触发最高优先级" value={w.group_name || ''} onChange={e => updEntry(i, 'group_name', e.target.value)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>注入深度 <span className="muted">（注入到历史第几条之后）</span></label>
                              <input type="number" className="input" min={0} max={50} value={w.depth ?? 0} onChange={e => updEntry(i, 'depth', +e.target.value || 0)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>文件夹 <span className="muted">（分组折叠）</span></label>
                              <input className="input" placeholder="留空=未分组" value={w.folder || ''} onChange={e => updEntry(i, 'folder', e.target.value)} disabled={readOnly} />
                            </div>
                          </div>
                        </div>

                        {/* 块3：计时与概率 */}
                        <div className="we-block">
                          <div className="we-block-head"><Clock size={12} /> 计时与概率</div>
                          <div className="we-adv-grid">
                            <div className="field" style={{ margin: 0 }}>
                              <label><Percent size={10} style={{ verticalAlign: -1 }} /> 触发概率 <span className="muted">({w.probability ?? 100}%)</span></label>
                              <input type="range" min="0" max="100" value={w.probability ?? 100} onChange={e => updEntry(i, 'probability', +e.target.value)} disabled={readOnly} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>最少轮数 <span className="muted">（达到后才能触发）</span></label>
                              <input type="number" className="input" min={0} max={999} value={w.min_turns ?? 0} onChange={e => updEntry(i, 'min_turns', +e.target.value || 0)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>最多触发轮数 <span className="muted">（超过则停用）</span></label>
                              <input type="number" className="input" min={0} max={999} value={w.max_turns ?? 0} onChange={e => updEntry(i, 'max_turns', +e.target.value || 0)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label><Timer size={10} style={{ verticalAlign: -1 }} /> 冷却轮数 <span className="muted">（触发后N轮不触发）</span></label>
                              <input type="number" className="input" min={0} max={999} value={w.cooldown ?? 0} onChange={e => updEntry(i, 'cooldown', +e.target.value || 0)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>粘性轮数 <span className="muted">（触发后持续N轮）</span></label>
                              <input type="number" className="input" min={0} max={99} value={w.sticky ?? 0} onChange={e => updEntry(i, 'sticky', +e.target.value || 0)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>作者备注 <span className="muted">（不注入）</span></label>
                              <input className="input" placeholder="例：第3章剧情揭示" value={w.comment || ''} onChange={e => updEntry(i, 'comment', e.target.value)} disabled={readOnly} />
                            </div>
                          </div>
                        </div>

                        {/* 块4：预注入图片 */}
                        <div className="we-block we-block-image">
                          <div className="we-block-head"><ImageIcon size={12} /> 预注入图片触发</div>
                          <p className="muted" style={{ fontSize: 11.5, margin: '2px 0 8px' }}>
                            由<b>创建者</b>预填图片 URL。对话命中下方关键词时，模型在文中嵌入 <code>[[wbimg:{w._id || '新条目'}]]</code> 标记，前端直接展示你预设的图片（不调用 AI 生图）。留空则不启用。
                          </p>
                          <div className="we-adv-grid">
                            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                              <label>预注入图片 URL <span className="muted">（逗号分隔，可多张）</span></label>
                              <textarea className="textarea" rows={2} placeholder="https://cdn.example.com/scene.jpg, https://cdn.example.com/scene_night.jpg"
                                value={w.image_urls || ''} onChange={e => updEntry(i, 'image_urls', e.target.value)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>图片触发关键词 <span className="muted">（命中即展示）</span></label>
                              <input className="input" placeholder="圣城, 阿斯特拉" value={w.image_keys || ''} onChange={e => updEntry(i, 'image_keys', e.target.value)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>图片位置</label>
                              <select className="input" value={w.image_position || 'inline'} onChange={e => updEntry(i, 'image_position', e.target.value)} disabled={readOnly}>
                                <option value="inline">行内插入</option>
                                <option value="before">消息前</option>
                                <option value="after">消息后</option>
                                <option value="side">侧边槽位</option>
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                              <label>绑定前端 slot <span className="muted">（与 front_schema.slots[].id 对应）</span></label>
                              <input className="input" placeholder="例：scene / banner / mood" value={w.front_slot || ''} onChange={e => updEntry(i, 'front_slot', e.target.value)} disabled={readOnly} />
                            </div>
                          </div>
                        </div>

                        {/* 块5：专家能力（变量/分支/语义/语气） */}
                        <div className="we-block we-block-expert">
                          <div className="we-block-head"><Sparkles size={12} /> 专家能力</div>
                          <div className="we-adv-grid">
                            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                              <label><Variable size={10} style={{ verticalAlign: -1 }} /> 变量写入 <span className="muted">（触发时写入，如 met_queen=true,chapter=2）</span></label>
                              <input className="input" placeholder="met_queen=true,chapter=2" value={w.variable_write || ''} onChange={e => updEntry(i, 'variable_write', e.target.value)} disabled={readOnly} />
                            </div>
                            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                              <label><GitBranch size={10} style={{ verticalAlign: -1 }} /> 分支条件 <span className="muted">（JSON，按变量值选不同 content）</span></label>
                              <textarea className="textarea mono" rows={3} placeholder={'{"met_queen=true":"女王已死后的内容","default":"默认内容"}'}
                                value={w.branch || ''} onChange={e => updEntry(i, 'branch', e.target.value)} disabled={readOnly} spellCheck={false} />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>语气标签 <span className="muted">（注入叙述风格，如 紧张/温馨）</span></label>
                              <input className="input" placeholder="紧张" value={w.tone || ''} onChange={e => updEntry(i, 'tone', e.target.value)} disabled={readOnly} />
                            </div>
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 8 }}>
                              <input type="checkbox" checked={!!w.vectorize} onChange={e => updEntry(i, 'vectorize', e.target.checked)} disabled={readOnly} />
                              <span className="track" />
                              <span style={{ fontSize: 12.5 }}><Sparkles size={11} style={{ verticalAlign: -1 }} /> 语义检索触发</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* —— 触发预览：多段测试 + Token 估算 + 互斥告警 + 变量状态 —— */}
        {editing && (
          <div className="card wb-preview">
            <div className="wb-preview-head">
              <Eye size={16} /> 触发预览
              <label className="switch" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={preview.multi} onChange={e => setPreview(p => ({ ...p, multi: e.target.checked, texts: e.target.checked && p.texts.length === 1 ? [p.texts[0], ''] : p.texts }))} />
                <span className="track" />
                多段批量测试
              </label>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
              输入模拟对话文本，查看哪些条目会被激活（含排除词、AND关键词、图片注入）。概率/最少轮数/冷却/粘性需实际对话上下文，预览仅回显配置。
            </p>
            {!preview.multi ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder="例：我们走向圣城阿斯特拉的城门…"
                  value={preview.texts[0] || ''} onChange={e => setPreview(p => ({ ...p, texts: [e.target.value] }))} />
                <button className="btn primary" onClick={runPreview} disabled={preview.loading}><Play size={13} /> {preview.loading ? '分析中…' : '测试'}</button>
              </div>
            ) : (
              <div>
                {preview.texts.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder={`测试文本 ${i + 1}`}
                      value={t} onChange={e => setPreview(p => ({ ...p, texts: p.texts.map((x, j) => j === i ? e.target.value : x) }))} />
                    {preview.texts.length > 1 && <button className="btn sm ghost" onClick={() => setPreview(p => ({ ...p, texts: p.texts.filter((_, j) => j !== i) }))}><Trash size={12} /></button>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn sm ghost" onClick={() => setPreview(p => ({ ...p, texts: [...p.texts, ''] }))}><Plus size={12} /> 添加段落</button>
                  <button className="btn primary" onClick={runPreview} disabled={preview.loading}><Play size={13} /> {preview.loading ? '分析中…' : '批量测试'}</button>
                </div>
              </div>
            )}
            {preview.result && (
              <div className="wb-preview-result">
                <div className="muted wb-prev-meta" style={{ fontSize: 12 }}>
                  回看 {preview.result.scan_depth} 轮 · Token {preview.result.token_budget || '不限'} · 最多激活 {preview.result.max_active} · 递归 {preview.result.recursion ? preview.result.recursion_depth + ' 轮' : '关'} · 系统注入 {preview.result.system_pos}
                  {' · '}预计消耗 <b style={{ color: preview.result.est_tokens > (preview.result.token_budget || 99999) ? '#d4677a' : 'var(--accent)' }}>{preview.result.est_tokens} Token</b>
                </div>
                {preview.result.variable_schema && (
                  <div className="wb-var-preview">
                    <Variable size={11} /> 世界变量声明：<code>{preview.result.variable_schema}</code>
                  </div>
                )}
                {preview.result.conflicts && preview.result.conflicts.length > 0 && (
                  <div className="wb-conflict-warn">
                    <Filter size={11} /> 互斥组冲突：{preview.result.conflicts.map(c => `${c.group}(${c.entries.length}条)`).join('、')}
                  </div>
                )}
                {preview.result.results.map((r, i) => (
                  <div key={i} className="wb-prev-group">
                    <div className="wb-prev-group-text">{r.text || '(空文本)'}</div>
                    {r.hits.length === 0
                      ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>无命中条目</div>
                      : r.hits.map((h, j) => (
                        <div key={j} className="wb-prev-row">
                          <div className="wb-prev-keys">
                            {h.keys || '(常驻)'}
                            {h.imgTriggered && <span className="wb-img-tag"><ImageIcon size={10} /> 图</span>}
                            {h.exclude_keys && <span className="wb-img-tag neutral">排除词</span>}
                            {h.required_keys && <span className="wb-img-tag neutral">AND</span>}
                            {h.probability < 100 && <span className="wb-img-tag neutral">概率{h.probability}%</span>}
                            {h.min_turns > 0 && <span className="wb-img-tag neutral">≥{h.min_turns}轮</span>}
                            {h.max_turns > 0 && <span className="wb-img-tag neutral">≤{h.max_turns}轮</span>}
                            {h.cooldown > 0 && <span className="wb-img-tag neutral">冷却{h.cooldown}</span>}
                            {h.sticky > 0 && <span className="wb-img-tag neutral">粘{h.sticky}</span>}
                            {h.tone && <span className="wb-img-tag neutral">{h.tone}</span>}
                            {h.variable_write && <span className="wb-img-tag neutral"><Variable size={9} /> 写</span>}
                            {h.branch && <span className="wb-img-tag neutral"><GitBranch size={9} /> 支</span>}
                            {h.vectorize && <span className="wb-img-tag neutral"><Sparkles size={9} /> 语</span>}
                          </div>
                          <div className="wb-prev-content">{h.content}</div>
                          {h.image_urls && h.image_urls.length > 0 && (
                            <div className="wb-prev-img"><ImageIcon size={11} /> 预注入 {h.image_urls.length} 张图片</div>
                          )}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* —— AI 拆书 —— */}
      {aiSplit && (
        <Modal onClose={() => setAiSplit(null)}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Wand2 size={18} /> AI 拆书</h2>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
            把小说设定、维基条目、跑团模组等大段文本粘贴进来，AI 会拆成带触发关键词的世界书条目；预览勾选后并入本书。使用你在设置中配置的语言模型。
          </p>
          {!aiSplit.result && (
            <>
              <textarea className="textarea" rows={9} placeholder="粘贴设定文本（最长约 1.2 万字）…"
                value={aiSplit.text} onChange={e => setAiSplit(s => ({ ...s, text: e.target.value }))} />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn block" onClick={() => setAiSplit(null)}>取消</button>
                <button className="btn primary block" onClick={runAiSplit} disabled={aiSplit.loading}>
                  <Sparkles size={14} /> {aiSplit.loading ? '拆解中，请稍候…' : '开始拆解'}
                </button>
              </div>
            </>
          )}
          {aiSplit.result && (
            <>
              <div className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
                拆出 {aiSplit.result.length} 条 · 已勾选 {aiSplit.picked.size} 条（点击卡片切换）
              </div>
              <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aiSplit.result.map((e, i) => {
                  const on = aiSplit.picked.has(i);
                  return (
                    <div key={i} className={'wbv-entry' + (on ? '' : ' off')} style={{ cursor: 'pointer' }}
                      onClick={() => setAiSplit(s => { const p = new Set(s.picked); p.has(i) ? p.delete(i) : p.add(i); return { ...s, picked: p }; })}>
                      <div className="wbv-entry-hd" style={{ pointerEvents: 'none' }}>
                        <div className="wbv-entry-keys">
                          {(e.keys || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 6).map((k, j) => <span key={j} className="wbv-key">{k}</span>)}
                        </div>
                        {e.comment && <span className="wbv-entry-note">{e.comment}</span>}
                        {on && <Check size={14} style={{ color: 'var(--accent)' }} />}
                      </div>
                      <div className="wbv-entry-body" style={{ pointerEvents: 'none' }}>{e.content}</div>
                    </div>
                  );
                })}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn block" onClick={() => setAiSplit(s => ({ ...s, result: null }))}>重新拆解</button>
                <button className="btn primary block" onClick={mergeAiSplit}><Plus size={14} /> 并入 {aiSplit.picked.size} 条</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
