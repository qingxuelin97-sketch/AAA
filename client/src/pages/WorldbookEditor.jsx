import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { Plus, ArrowLeft, Trash, BookOpen, Save, Globe, ChevronDown, ChevronUp,
  Settings2, Image as ImageIcon, Layout, Play, Eye, Sliders, Filter, Clock, Percent, Layers } from 'lucide-react';

const BLANK = {
  name: '', description: '', tags: '', is_public: false,
  front_schema: '', prompt_overlay: '',
  scan_depth: 4, token_budget: 0, recursion: false,
  entries: []
};

// 条目默认值：所有能力字段始终存在（不按档位剥离），按需填写即启用。
const newEntry = () => ({
  keys: '', content: '', enabled: true,
  mode: 'keyword', inject_pos: 'after', priority: 50, case_sensitive: false, group_name: '', comment: '',
  exclude_keys: '', probability: 100, min_turns: 0,
  image_urls: '', image_keys: '', image_position: 'inline', front_slot: ''
});

// 保存前补齐缺失字段，保证数据完整。
const normalizeEntries = (entries) => entries.map(e => ({
  keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
  mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after', priority: e.priority ?? 50,
  case_sensitive: !!e.case_sensitive, group_name: e.group_name || '', comment: e.comment || '',
  exclude_keys: e.exclude_keys || '', probability: e.probability ?? 100, min_turns: e.min_turns ?? 0,
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
  const [showAdvanced, setShowAdvanced] = useState(false); // 世界书级高级设定折叠
  const [showSchema, setShowSchema] = useState(false);
  const [preview, setPreview] = useState({ text: '', result: null, loading: false });
  const readOnly = editing && user && ownerId != null && ownerId !== user.id;

  useEffect(() => {
    if (!editing) { setLoaded(true); return; }
    api('/worldbooks/' + id).then(d => {
      const w = d.worldbook;
      setOwnerId(w.owner_id);
      setWb({
        name: w.name, description: w.description, tags: w.tags,
        is_public: !!w.is_public, front_schema: w.front_schema || '', prompt_overlay: w.prompt_overlay || '',
        scan_depth: w.scan_depth ?? 4, token_budget: w.token_budget ?? 0, recursion: !!w.recursion,
        entries: (w.entries || []).map(e => ({
          keys: e.keys || '', content: e.content || '', enabled: e.enabled !== false,
          mode: e.mode || 'keyword', inject_pos: e.inject_pos || 'after',
          priority: e.priority ?? 50, case_sensitive: !!e.case_sensitive,
          group_name: e.group_name || '', comment: e.comment || '',
          exclude_keys: e.exclude_keys || '', probability: e.probability ?? 100, min_turns: e.min_turns ?? 0,
          image_urls: e.image_urls || '', image_keys: e.image_keys || '',
          image_position: e.image_position || 'inline', front_slot: e.front_slot || '',
          _id: e.id
        }))
      });
      setLoaded(true);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const set = (k, v) => setWb(p => ({ ...p, [k]: v }));
  const addEntry = () => {
    set('entries', [...wb.entries, newEntry()]);
    setExpanded(p => ({ ...p, [wb.entries.length]: false }));
  };
  const updEntry = (i, k, v) => set('entries', wb.entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEntry = (i) => set('entries', wb.entries.filter((_, j) => j !== i));
  const toggleExpand = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

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

  const runPreview = async () => {
    if (!editing) { toast('请先保存后再预览触发', 'err'); return; }
    setPreview(p => ({ ...p, loading: true }));
    try {
      const d = await api('/worldbooks/' + id + '/test-trigger', { method: 'POST', body: { text: preview.text } });
      setPreview(p => ({ ...p, result: d, loading: false }));
    } catch (e) { toast(e.message, 'err'); setPreview(p => ({ ...p, loading: false })); }
  };

  // 派生：已启用了哪些能力（用于在顶部展示能力徽章，不再作单选档位）
  const hasImage = wb.entries.some(e => e.image_urls && e.image_keys);
  const hasFront = !!wb.front_schema;
  const hasOverlay = !!wb.prompt_overlay?.trim();
  const hasRecursion = !!wb.recursion;

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
          <div className="sub"><BookOpen size={11} style={{ verticalAlign: -1 }} /> 独立世界书 · 可跨角色复用 · 能力可共存{readOnly ? ' · 只读' : ''}</div>
        </div>
        {editing && !readOnly && <button className="btn ghost danger" onClick={del} title="删除"><Trash size={15} /></button>}
        {!readOnly && <button className="btn primary" onClick={save} disabled={busy}><Save size={15} /> {busy ? '保存中…' : '保存'}</button>}
      </div>

      <div className="page wb-editor">
        {/* —— 能力徽章（仅展示已启用能力，非单选档位）—— */}
        <div className="wb-cap-bar">
          <span className="wb-cap-badge">简单<span className="muted"> 关键词</span></span>
          <span className="wb-cap-badge">标准<span className="muted"> 正则/分组/概率</span></span>
          {hasImage && <span className="wb-cap-badge on expert"><ImageIcon size={11} /> 图片注入</span>}
          {hasFront && <span className="wb-cap-badge on expert"><Layout size={11} /> 自构前端</span>}
          {hasOverlay && <span className="wb-cap-badge on expert"><Sliders size={11} /> 提示词叠加</span>}
          {hasRecursion && <span className="wb-cap-badge on expert"><Layers size={11} /> 递归触发</span>}
        </div>

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

        {/* —— 世界书级高级设定（折叠）—— */}
        <div className="card wb-advanced-panel">
          <button className="wb-advanced-toggle" onClick={() => setShowAdvanced(s => !s)} disabled={readOnly}>
            <Settings2 size={16} /> 高级设定
            <span className="wb-adv-summary">
              {wb.scan_depth}轮回看{wb.token_budget > 0 ? ` · ${wb.token_budget}Token` : ' · 不限Token'}{wb.recursion ? ' · 递归' : ''}
              {hasOverlay ? ' · 含叠加' : ''}{hasFront ? ' · 含前端' : ''}
            </span>
            {showAdvanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showAdvanced && (
            <div className="wb-advanced-body">
              {/* 触发扫描 */}
              <div className="wb-adv-section">
                <div className="wb-adv-section-head"><Sliders size={13} /> 触发扫描</div>
                <div className="wb-adv-grid">
                  <div className="field" style={{ margin: 0 }}>
                    <label>扫描深度 <span className="muted">（回看最近几轮对话）</span></label>
                    <input type="number" className="input" min={1} max={50} value={wb.scan_depth} onChange={e => set('scan_depth', +e.target.value || 4)} disabled={readOnly} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Token 预算 <span className="muted">（0 = 不限；注入上限）</span></label>
                    <input type="number" className="input" min={0} max={8000} value={wb.token_budget} onChange={e => set('token_budget', +e.target.value || 0)} disabled={readOnly} />
                  </div>
                  <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 8 }}>
                    <input type="checkbox" checked={!!wb.recursion} onChange={e => set('recursion', e.target.checked)} disabled={readOnly} />
                    <span className="track" />
                    <span style={{ fontSize: 12.5 }}><Layers size={11} style={{ verticalAlign: -1 }} /> 递归触发（条目内容可继续激活其他条目）</span>
                  </label>
                </div>
              </div>

              {/* 提示词叠加 */}
              <div className="wb-adv-section">
                <div className="wb-adv-section-head"><Sliders size={13} /> 提示词叠加 prompt_overlay</div>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                  拼接在系统提示词最前方的指令模板，可定制角色语气、叙述风格、节奏控制。留空则不启用。
                </p>
                <textarea className="textarea mono" rows={3} value={wb.prompt_overlay} onChange={e => set('prompt_overlay', e.target.value)} disabled={readOnly}
                  placeholder="例：以电影分镜方式叙述场景，每段 ≤ 80 字，重要意象后插入 [[wbimg:对应条目ID]] 标记。" />
              </div>

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
            </div>
          )}
        </div>

        {/* —— 条目列表 —— */}
        <div className="section-title" style={{ marginTop: 20 }}>
          <h2>设定条目 ({wb.entries.length})</h2>
          {!readOnly && <button className="btn sm" onClick={addEntry}><Plus size={14} /> 添加条目</button>}
        </div>
        <p className="muted wb-tier-hint">
          角色对话出现「触发关键词」时设定自动注入；留空关键词为常驻设定。点击条目右侧 <ChevronDown size={11} style={{ verticalAlign: -1 }} /> 展开高级配置（触发条件、注入与分组、计时与概率、图片注入）。
        </p>

        {wb.entries.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目{readOnly ? '' : '，点击右上角添加'}</div>}
        {wb.entries.map((w, i) => (
          <div key={i} className="world-entry">
            <div className="top">
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
              {!readOnly && <button className="btn sm danger" onClick={() => delEntry(i)}>删除</button>}
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
                      <label>作者备注 <span className="muted">（不注入，仅备注）</span></label>
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
              </div>
            )}
          </div>
        ))}

        {/* —— 触发预览 —— */}
        {editing && (
          <div className="card wb-preview">
            <div className="wb-preview-head"><Eye size={16} /> 触发预览</div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
              输入一段模拟对话文本，查看哪些条目会被激活（含排除关键词与图片注入命中）。概率/最少轮数需实际对话上下文，预览仅回显配置。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="例：我们走向圣城阿斯特拉的城门…"
                value={preview.text} onChange={e => setPreview(p => ({ ...p, text: e.target.value }))} />
              <button className="btn primary" onClick={runPreview} disabled={preview.loading}><Play size={13} /> {preview.loading ? '分析中…' : '测试'}</button>
            </div>
            {preview.result && (
              <div className="wb-preview-result">
                <div className="muted" style={{ fontSize: 12 }}>
                  回看 {preview.result.scan_depth} 轮 · Token {preview.result.token_budget || '不限'} · 递归 {preview.result.recursion ? '开' : '关'} · 命中 {preview.result.results.length} / {preview.result.total} 条
                </div>
                {preview.result.results.length === 0
                  ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>无命中条目</div>
                  : preview.result.results.map((r, i) => (
                    <div key={i} className="wb-prev-row">
                      <div className="wb-prev-keys">
                        {r.keys || '(常驻)'}
                        {r.imgTriggered && <span className="wb-img-tag"><ImageIcon size={10} /> 图</span>}
                        {r.exclude_keys && <span className="wb-img-tag" style={{ background: 'var(--bg-2)', color: 'var(--muted)' }}>排除词已设</span>}
                        {r.probability < 100 && <span className="wb-img-tag" style={{ background: 'var(--bg-2)', color: 'var(--muted)' }}>概率{r.probability}%</span>}
                        {r.min_turns > 0 && <span className="wb-img-tag" style={{ background: 'var(--bg-2)', color: 'var(--muted)' }}>≥{r.min_turns}轮</span>}
                      </div>
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
