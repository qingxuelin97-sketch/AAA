import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Plus, ArrowLeft, Trash, BookOpen, Save, Globe } from 'lucide-react';

const BLANK = { name: '', description: '', tags: '', is_public: false, entries: [] };

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
  const readOnly = editing && user && ownerId != null && ownerId !== user.id;

  useEffect(() => {
    if (!editing) { setLoaded(true); return; }
    api('/worldbooks/' + id).then(d => {
      const w = d.worldbook;
      setOwnerId(w.owner_id);
      setWb({ name: w.name, description: w.description, tags: w.tags, is_public: !!w.is_public, entries: (w.entries || []).map(e => ({ keys: e.keys, content: e.content, enabled: e.enabled !== false })) });
      setLoaded(true);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const set = (k, v) => setWb(p => ({ ...p, [k]: v }));
  const addEntry = () => set('entries', [...wb.entries, { keys: '', content: '', enabled: true }]);
  const updEntry = (i, k, v) => set('entries', wb.entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEntry = (i) => set('entries', wb.entries.filter((_, j) => j !== i));

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
          {!readOnly && <button className="btn sm" onClick={addEntry}><Plus size={14} /> 添加条目</button>}
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
          角色对话中出现「触发关键词」时，对应设定自动注入提示词。留空关键词则为常驻设定。世界书可关联到任意多个角色。
        </p>
        {wb.entries.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目{readOnly ? '' : '，点击右上角添加'}</div>}
        {wb.entries.map((w, i) => (
          <div key={i} className="world-entry">
            <div className="top">
              <input className="input" style={{ flex: 1 }} placeholder="触发关键词，逗号分隔（留空=常驻）"
                value={w.keys} onChange={e => updEntry(i, 'keys', e.target.value)} disabled={readOnly} />
              <label className="switch">
                <input type="checkbox" checked={w.enabled !== false} onChange={e => updEntry(i, 'enabled', e.target.checked)} disabled={readOnly} />
                <span className="track" />
              </label>
              {!readOnly && <button className="btn sm danger" onClick={() => delEntry(i)}>删除</button>}
            </div>
            <textarea className="textarea" placeholder="设定内容，例如：「圣城阿斯特拉位于浮空岛之上，由七位贤者守护…」"
              value={w.content} onChange={e => updEntry(i, 'content', e.target.value)} disabled={readOnly} />
          </div>
        ))}
      </div>
    </>
  );
}
