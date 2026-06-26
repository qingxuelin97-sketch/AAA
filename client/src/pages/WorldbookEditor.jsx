import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Plus, ArrowLeft, Trash, BookOpen, Save, Globe, Settings2, ChevronDown, ChevronUp, Code2, Info } from 'lucide-react';

const BLANK = { name: '', description: '', tags: '', is_public: false, entries: [] };
// 常规条目默认字段；高级条目额外携带 mode/inject_pos/priority 等。
const newEntry = (advanced = false) => advanced
  ? { keys: '', content: '', enabled: true, mode: 'keyword', inject_pos: 'after', priority: 50, case_sensitive: false, group_name: '', comment: '' }
  : { keys: '', content: '', enabled: true };

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
  const [advanced, setAdvanced] = useState(false); // 高级模式开关
  const [expanded, setExpanded] = useState({}); // 条目高级面板展开状态
  const readOnly = editing && user && ownerId != null && ownerId !== user.id;

  useEffect(() => {
    if (!editing) { setLoaded(true); return; }
    api('/worldbooks/' + id).then(d => {
      const w = d.worldbook;
      setOwnerId(w.owner_id);
      const entries = (w.entries || []).map(e => ({
        keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
        mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after',
        priority: e.priority ?? 50, case_sensitive: !!e.case_sensitive,
        group_name: e.group_name || '', comment: e.comment || ''
      }));
      // 任意条目使用了高级字段则默认开启高级模式
      const hasAdvanced = entries.some(e => e.mode !== 'keyword' || e.inject_pos !== 'after' || e.priority !== 50 || e.case_sensitive || e.group_name || e.comment);
      setAdvanced(hasAdvanced);
      setWb({ name: w.name, description: w.description, tags: w.tags, is_public: !!w.is_public, entries });
      setLoaded(true);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const set = (k, v) => setWb(p => ({ ...p, [k]: v }));
  const addEntry = () => { set('entries', [...wb.entries, newEntry(advanced)]); setExpanded(p => ({ ...p, [wb.entries.length]: advanced })); };
  const updEntry = (i, k, v) => set('entries', wb.entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEntry = (i) => set('entries', wb.entries.filter((_, j) => j !== i));
  const toggleExpand = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  // 切换高级模式时，给现有条目补齐/精简高级字段
  const toggleAdvanced = () => {
    const next = !advanced;
    if (next) {
      set('entries', wb.entries.map(e => ({
        ...e, mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after',
        priority: e.priority ?? 50, case_sensitive: !!e.case_sensitive,
        group_name: e.group_name || '', comment: e.comment || ''
      })));
    }
    setAdvanced(next);
  };

  const save = async () => {
    if (!wb.name.trim()) { toast('请填写世界书名称', 'err'); return; }
    setBusy(true);
    try {
      if (editing) {
        await api('/worldbooks/' + id, { method: 'PUT', body: wb });
        toast('已保存');
      } else {
        const d = await api('/worldbooks', { method: 'POST', body: wb });
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

  if (!loaded) return (
    <><div className="topbar"><button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button><div style={{ flex: 1 }}><h1>世界书</h1></div></div>
      <div className="page"><div className="empty">载入中…</div></div></>
  );

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1 }}><h1>{editing ? wb.name || '世界书' : '新建世界书'}</h1><div className="sub"><BookOpen size={11} style={{ verticalAlign: -1 }} /> 独立世界书 · 可跨角色复用{readOnly ? ' · 只读' : ''}</div></div>
        {editing && !readOnly && <button className="btn ghost danger" onClick={del} title="删除"><Trash size={15} /></button>}
        {!readOnly && <button className="btn primary" onClick={save} disabled={busy}><Save size={15} /> {busy ? '保存中…' : '保存'}</button>}
      </div>
      <div className="page" style={{ maxWidth: 860 }}>
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

        <div className="section-title">
          <h2>设定条目 ({wb.entries.length})</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!readOnly && (
              <label className="wb-mode-toggle" title="高级模式：触发模式、注入位置、优先级、互斥分组等工程化控制">
                <input type="checkbox" checked={advanced} onChange={toggleAdvanced} disabled={readOnly} />
                <Code2 size={14} /> 高级模式
              </label>
            )}
            {!readOnly && <button className="btn sm" onClick={addEntry}><Plus size={14} /> 添加条目</button>}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
          {advanced
            ? <>高级模式已开启：每条目可配置触发模式（关键词/正则/常驻）、注入位置、优先级与互斥分组。适合复杂世界观工程化管理。</>
            : <>角色对话中出现「触发关键词」时，对应设定自动注入提示词。留空关键词则为常驻设定。世界书可关联到任意多个角色。</>}
        </p>
        {wb.entries.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目{readOnly ? '' : '，点击右上角添加'}</div>}
        {wb.entries.map((w, i) => (
          <div key={i} className={'world-entry' + (advanced ? ' advanced' : '')}>
            <div className="top">
              <input className="input" style={{ flex: 1 }} placeholder={advanced ? (w.mode === 'regex' ? '正则表达式，逗号分隔多个' : w.mode === 'always' ? '常驻条目无需关键词' : '触发关键词，逗号分隔') : '触发关键词，逗号分隔（留空=常驻）'}
                value={w.keys} onChange={e => updEntry(i, 'keys', e.target.value)} disabled={readOnly} />
              {advanced && (
                <select className="input" style={{ width: 'auto', minWidth: 92 }} value={w.mode || 'keyword'} onChange={e => updEntry(i, 'mode', e.target.value)} disabled={readOnly}>
                  <option value="keyword">关键词</option>
                  <option value="regex">正则</option>
                  <option value="always">常驻</option>
                </select>
              )}
              <label className="switch">
                <input type="checkbox" checked={w.enabled !== false} onChange={e => updEntry(i, 'enabled', e.target.checked)} disabled={readOnly} />
                <span className="track" />
              </label>
              {advanced && (
                <button className="btn sm ghost" onClick={() => toggleExpand(i)} title="高级配置" disabled={readOnly}>
                  {expanded[i] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
              {!readOnly && <button className="btn sm danger" onClick={() => delEntry(i)}>删除</button>}
            </div>
            <textarea className="textarea" placeholder="设定内容，例如：「圣城阿斯特拉位于浮空岛之上，由七位贤者守护…」"
              value={w.content} onChange={e => updEntry(i, 'content', e.target.value)} disabled={readOnly} />
            {advanced && expanded[i] && (
              <div className="we-advanced">
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
                  <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 8 }}>
                    <input type="checkbox" checked={!!w.case_sensitive} onChange={e => updEntry(i, 'case_sensitive', e.target.checked)} disabled={readOnly} />
                    <span className="track" />
                    <span style={{ fontSize: 12.5 }}>大小写敏感</span>
                  </label>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>作者备注 <span className="muted">（不注入提示词，仅备注用）</span></label>
                  <input className="input" placeholder="例如：此条目用于第3章剧情揭示" value={w.comment || ''} onChange={e => updEntry(i, 'comment', e.target.value)} disabled={readOnly} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
