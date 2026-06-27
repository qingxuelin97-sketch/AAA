import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Plus, ArrowLeft, Trash, BookOpen, Save, Globe, ChevronDown, ChevronUp,
  Code2, Sparkles, Wand2, Image as ImageIcon, Layout, Play, Eye } from 'lucide-react';

const BLANK = { name: '', description: '', tags: '', tier: 'normal', is_public: false, front_schema: '', prompt_overlay: '', entries: [] };

// 世界书设置级别（不是创作者档位、不上锁）：仅决定编辑器显示哪些特性面板。
// tier 可自由切换，所有字段始终保留入库，运行时按 tier 决定是否启用专家特性。
const TIERS = [
  { id: 'normal', name: '简单', icon: BookOpen, accent: 'var(--accent-2)',
    desc: '关键词触发 · 跨角色复用 · 适合普通创作者',
    cap: ['关键词触发', '常驻条目', '公开共享'] },
  { id: 'advanced', name: '标准', icon: Code2, accent: '#7c5bd9',
    desc: '正则/常驻/优先级/互斥分组 · 工程化设定',
    cap: ['正则与常驻', '注入位置', '优先级 + 互斥分组', '作者备注'] },
  { id: 'expert', name: '专家', icon: Wand2, accent: '#d4677a',
    desc: '预注入图片触发 · 自构对话前端 · 提示词叠加',
    cap: ['预注入图片触发展示', '玩家自构对话前端 (front_schema)', '专家级 prompt_overlay', '全部标准能力'] },
];

// 条目默认值：始终包含全部字段（不按 tier 剥离），仅前端按 tier 控制面板可见性。
const newEntry = () => ({
  keys: '', content: '', enabled: true,
  mode: 'keyword', inject_pos: 'after', priority: 50, case_sensitive: false, group_name: '', comment: '',
  image_urls: '', image_keys: '', image_position: 'inline', front_slot: ''
});

// 切换 tier 不再剥离字段，仅补齐缺失字段，保证数据完整。
const normalizeEntries = (entries) => entries.map(e => ({
  keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
  mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after', priority: e.priority ?? 50,
  case_sensitive: !!e.case_sensitive, group_name: e.group_name || '', comment: e.comment || '',
  image_urls: e.image_urls || '', image_keys: e.image_keys || '',
  image_position: e.image_position || 'inline', front_slot: e.front_slot || ''
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
  const [showSchema, setShowSchema] = useState(false);
  const [preview, setPreview] = useState({ text: '', result: null, loading: false });
  const readOnly = editing && user && ownerId != null && ownerId !== user.id;

  const tier = wb.tier || 'normal';
  const tierMeta = TIERS.find(t => t.id === tier) || TIERS[0];

  useEffect(() => {
    if (!editing) { setLoaded(true); return; }
    api('/worldbooks/' + id).then(d => {
      const w = d.worldbook;
      setOwnerId(w.owner_id);
      const entries = (w.entries || []).map(e => ({
        keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
        mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after',
        priority: e.priority ?? 50, case_sensitive: !!e.case_sensitive,
        group_name: e.group_name || '', comment: e.comment || '',
        image_urls: e.image_urls || '', image_keys: e.image_keys || '',
        image_position: e.image_position || 'inline', front_slot: e.front_slot || '',
        _id: e.id
      }));
      setWb({
        name: w.name, description: w.description, tags: w.tags, tier: w.tier || 'normal',
        is_public: !!w.is_public, front_schema: w.front_schema || '', prompt_overlay: w.prompt_overlay || '',
        entries
      });
      setLoaded(true);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const set = (k, v) => setWb(p => ({ ...p, [k]: v }));
  const addEntry = () => {
    set('entries', [...wb.entries, newEntry()]);
    setExpanded(p => ({ ...p, [wb.entries.length]: tier !== 'normal' }));
  };
  const updEntry = (i, k, v) => set('entries', wb.entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEntry = (i) => set('entries', wb.entries.filter((_, j) => j !== i));
  const toggleExpand = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  // 切换级别：自由切换，不剥离字段（数据始终保留）。切到专家档且无 front_schema 时给默认模板起步。
  const changeTier = (nextTier) => {
    if (readOnly || nextTier === tier) return;
    set('tier', nextTier);
    if (nextTier === 'expert' && !wb.front_schema) set('front_schema', DEFAULT_SCHEMA);
  };

  const save = async () => {
    if (!wb.name.trim()) { toast('请填写世界书名称', 'err'); return; }
    setBusy(true);
    try {
      const payload = { ...wb, entries: normalizeEntries(wb.entries) };
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

  // 触发预览：调用后端 test-trigger
  const runPreview = async () => {
    if (!editing) { toast('请先保存后再预览触发', 'err'); return; }
    setPreview(p => ({ ...p, loading: true }));
    try {
      const d = await api('/worldbooks/' + id + '/test-trigger', { method: 'POST', body: { text: preview.text } });
      setPreview(p => ({ ...p, result: d, loading: false }));
    } catch (e) { toast(e.message, 'err'); setPreview(p => ({ ...p, loading: false })); }
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
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {editing ? wb.name || '世界书' : '新建世界书'}
            <span className={'wb-tier-chip tier-' + tier}>{tierMeta.name}档</span>
          </h1>
          <div className="sub"><BookOpen size={11} style={{ verticalAlign: -1 }} /> 独立世界书 · 可跨角色复用{readOnly ? ' · 只读' : ''}</div>
        </div>
        {editing && !readOnly && <button className="btn ghost danger" onClick={del} title="删除"><Trash size={15} /></button>}
        {!readOnly && <button className="btn primary" onClick={save} disabled={busy}><Save size={15} /> {busy ? '保存中…' : '保存'}</button>}
      </div>

      <div className="page wb-editor">
        {/* —— 档位选择 —— */}
        {!readOnly && (
          <div className="wb-tier-grid">
            {TIERS.map(t => {
              const Icon = t.icon;
              const on = tier === t.id;
              return (
                <button key={t.id} className={'wb-tier-card' + (on ? ' on tier-' + t.id : '')} onClick={() => changeTier(t.id)} disabled={readOnly}>
                  <div className="wb-tier-icon"><Icon size={18} /></div>
                  <div className="wb-tier-name">{t.name}档</div>
                  <div className="wb-tier-desc">{t.desc}</div>
                  <div className="wb-tier-cap">
                    {t.cap.map((c, i) => <span key={i} className="wb-cap-pill">{c}</span>)}
                  </div>
                  {on && <span className="wb-tier-check"><Sparkles size={12} /> 当前</span>}
                </button>
              );
            })}
          </div>
        )}
        {readOnly && (
          <div className={'wb-tier-banner tier-' + tier}>
            当前为<b>{tierMeta.name}档</b> · {tierMeta.desc}
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

        {/* —— 专家档：自构对话前端 + 提示词叠加 —— */}
        {tier === 'expert' && (
          <div className="card wb-expert-panel">
            <div className="wb-expert-head">
              <Layout size={16} /> 自构对话前端（front_schema）
              <button className="btn sm ghost" onClick={() => setShowSchema(s => !s)}>{showSchema ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showSchema ? '收起' : '展开'}</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
              定义玩家在对话页见到的布局：banner / 侧边图片轮播 / 心情文本条。条目可通过 front_slot 绑定到对应 slot，触发后即在对应位置渲染。
            </p>
            {showSchema && (
              <textarea className="textarea mono" rows={10} value={wb.front_schema} onChange={e => set('front_schema', e.target.value)} disabled={readOnly}
                placeholder={DEFAULT_SCHEMA} spellCheck={false} />
            )}
            <div className="wb-expert-head" style={{ marginTop: 14 }}>
              <Sparkles size={16} /> 专家级提示词叠加（prompt_overlay）
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
              拼接在系统提示词最前方的指令模板，可定制角色语气、叙述风格、节奏控制等。
            </p>
            <textarea className="textarea mono" rows={4} value={wb.prompt_overlay} onChange={e => set('prompt_overlay', e.target.value)} disabled={readOnly}
              placeholder="例：以电影分镜方式叙述场景，每段 ≤ 80 字，重要意象后插入 [[wbimg:对应条目ID]] 标记。" />
          </div>
        )}

        {/* —— 条目列表 —— */}
        <div className="section-title">
          <h2>设定条目 ({wb.entries.length})</h2>
          {!readOnly && <button className="btn sm" onClick={addEntry}><Plus size={14} /> 添加条目</button>}
        </div>
        <p className="muted wb-tier-hint">
          {tier === 'normal' && <>角色对话出现「触发关键词」时设定自动注入。留空关键词为常驻设定。</>}
          {tier === 'advanced' && <>标准级已开启：可配置触发模式（关键词/正则/常驻）、注入位置、优先级与互斥分组。</>}
          {tier === 'expert' && <>专家级已开启：在标准能力基础上，每条目可「预注入图片」，命中图片触发关键词时，模型在文中嵌入 <code>[[wbimg:条目ID]]</code> 标记，前端直接展示你预设的图片（不调用 AI 生图）。</>}
        </p>

        {wb.entries.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目{readOnly ? '' : '，点击右上角添加'}</div>}
        {wb.entries.map((w, i) => (
          <div key={i} className={'world-entry tier-' + tier}>
            <div className="top">
              <input className="input" style={{ flex: 1 }}
                placeholder={tier === 'normal' ? '触发关键词，逗号分隔（留空=常驻）'
                  : (w.mode === 'regex' ? '正则表达式，逗号分隔多个' : w.mode === 'always' ? '常驻条目无需关键词' : '触发关键词，逗号分隔')}
                value={w.keys} onChange={e => updEntry(i, 'keys', e.target.value)} disabled={readOnly} />
              {tier !== 'normal' && (
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
              {tier !== 'normal' && (
                <button className="btn sm ghost" onClick={() => toggleExpand(i)} title="高级配置" disabled={readOnly}>
                  {expanded[i] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
              {!readOnly && <button className="btn sm danger" onClick={() => delEntry(i)}>删除</button>}
            </div>
            <textarea className="textarea" placeholder="设定内容，例如：「圣城阿斯特拉位于浮空岛之上，由七位贤者守护…」"
              value={w.content} onChange={e => updEntry(i, 'content', e.target.value)} disabled={readOnly} />

            {tier !== 'normal' && expanded[i] && (
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

                {/* —— 专家档：预注入图片触发 —— */}
                {tier === 'expert' && (
                  <div className="we-image">
                    <div className="we-image-head"><ImageIcon size={14} /> 预注入图片触发</div>
                    <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                      由<b>创建者</b>预填图片 URL（一张或多张）。对话命中下方关键词时，模型在文中嵌入 <code>[[wbimg:{w._id || '新条目'}]]</code> 标记，前端直接展示你预设的图片（不调用 AI 生图，不产生生图费用）。
                    </p>
                    <div className="we-adv-grid">
                      <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                        <label>预注入图片 URL <span className="muted">（逗号分隔，可多张；支持外部图床直链）</span></label>
                        <textarea className="textarea" rows={2} placeholder="例：https://cdn.example.com/scene_astrala.jpg, https://cdn.example.com/scene_astrala_night.jpg"
                          value={w.image_urls || ''} onChange={e => updEntry(i, 'image_urls', e.target.value)} disabled={readOnly} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>图片触发关键词 <span className="muted">（逗号分隔，命中即展示）</span></label>
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
                        <label>绑定前端 slot <span className="muted">（留空=不绑；与 front_schema.slots[].id 对应）</span></label>
                        <input className="input" placeholder="例：scene / banner / mood" value={w.front_slot || ''} onChange={e => updEntry(i, 'front_slot', e.target.value)} disabled={readOnly} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* —— 触发预览 —— */}
        {editing && (
          <div className="card wb-preview">
            <div className="wb-preview-head"><Eye size={16} /> 触发预览</div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
              输入一段模拟对话文本，查看哪些条目会被激活（专家档可看到图片触发命中）。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="例：我们走向圣城阿斯特拉的城门…"
                value={preview.text} onChange={e => setPreview(p => ({ ...p, text: e.target.value }))} />
              <button className="btn primary" onClick={runPreview} disabled={preview.loading}><Play size={13} /> {preview.loading ? '分析中…' : '测试'}</button>
            </div>
            {preview.result && (
              <div className="wb-preview-result">
                <div className="muted" style={{ fontSize: 12 }}>档位：{preview.result.tier} · 命中 {preview.result.results.length} / {preview.result.total} 条</div>
                {preview.result.results.length === 0
                  ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>无命中条目</div>
                  : preview.result.results.map((r, i) => (
                    <div key={i} className="wb-prev-row">
                      <div className="wb-prev-keys">{r.keys || '(常驻)'}{r.imgTriggered && <span className="wb-img-tag"><ImageIcon size={10} /> 图</span>}</div>
                      <div className="wb-prev-content">{r.content}</div>
                      {r.image_urls && r.image_urls.length > 0 && (
                        <div className="wb-prev-img"><ImageIcon size={11} /> 预注入 {r.image_urls.length} 张图片</div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
