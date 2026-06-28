import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import {
  ArrowLeft, Feather, Sparkles, Wand2, Loader2, Send, Square, Palette, Layers,
  BookLock, BookOpen, GitBranch, Download, Trash2, Pin, RefreshCw, Lock, Unlock,
  Plus, X, ChevronDown, Check, Pencil, ScrollText, Lightbulb, FileDown, Eye, EyeOff,
} from 'lucide-react';

/* ───────────────────────── shared option metadata ───────────────────────── */
export const TRIGGER_OPTS = [
  { v: 'always', label: '随时常驻', hint: '每次生成都注入' },
  { v: 'keyword', label: '关键词触发', hint: '提示词或近期正文命中关键词时注入' },
  { v: 'scene', label: '场合触发', hint: '近期剧情场景命中关键词时注入' },
];
export const CAT_OPTS = [
  ['world', '世界观'], ['character', '角色'], ['relationship', '关系'], ['faction', '势力'],
  ['location', '地点'], ['item', '物品'], ['lore', '设定'], ['rule', '规则'],
  ['timeline', '时间线'], ['plot', '剧情'], ['other', '其他'],
];
const CAT_LABEL = Object.fromEntries(CAT_OPTS);
const SOURCE_BADGE = {
  meta: { label: '局外母版', cls: 'src-meta' },
  manual: { label: '手动', cls: 'src-manual' },
  auto: { label: 'AI 自动', cls: 'src-auto' },
};
const STYLE_FIELDS = {
  pov: { label: '叙述视角', opts: [['first', '第一人称'], ['second', '第二人称'], ['third_limited', '第三人称·限知'], ['third_omni', '第三人称·全知']] },
  tense: { label: '时态', opts: [['past', '过去时'], ['present', '现在时']] },
  pacing: { label: '节奏', opts: [['slow', '舒缓'], ['medium', '适中'], ['fast', '快']] },
  paragraph: { label: '段落', opts: [['short', '短·留白'], ['medium', '中等'], ['long', '长·绵密']] },
  dialogue: { label: '对白比重', opts: [['low', '少对白'], ['balanced', '均衡'], ['high', '多对白']] },
  rating: { label: '尺度', opts: [['all', '全年龄'], ['teen', '轻度'], ['mature', '成人向']] },
  beat_length: { label: '单次篇幅', opts: [['short', '短'], ['medium', '中'], ['long', '长']] },
};

let _lid = 1;
const localId = () => 'l' + (_lid++) + Math.random().toString(36).slice(2, 5);

export default function NovelWorkspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [novel, setNovel] = useState(null);
  const [runs, setRuns] = useState([]);
  const [run, setRun] = useState(null);     // active run (full, with canon)
  const [beats, setBeats] = useState([]);
  const [loading, setLoading] = useState(true);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [panel, setPanel] = useState(null); // style | codex | canon | runs
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [autoSync, setAutoSync] = useState(true);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const rafRef = useRef(0);
  const bufRef = useRef('');

  const loadRun = useCallback(async (rid) => {
    const d = await api(`/novels/runs/${rid}`);
    setRun(d.run); setNovel(d.novel); setBeats(d.beats);
    return d;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await api(`/novels/${id}`);
        if (!alive) return;
        setNovel(d.novel); setRuns(d.runs);
        const rid = d.runs.find(r => !r.archived)?.id || d.runs[0]?.id;
        if (rid) await loadRun(rid);
      } catch (e) { toast(e.message, 'err'); nav('/atelier'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id]);

  const scrollToEnd = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { scrollToEnd(); }, [beats.length, streaming]);

  const refreshRuns = () => api(`/novels/${id}`).then(d => { setRuns(d.runs); setNovel(d.novel); }).catch(() => {});

  // ── streaming write ──
  const flush = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (bufRef.current) {
      const chunk = bufRef.current; bufRef.current = '';
      setBeats(b => { const c = [...b]; const last = c[c.length - 1]; if (last?._streaming) c[c.length - 1] = { ...last, content: (last.content || '') + chunk }; return c; });
    }
  };
  const stream = async (endpoint, payload, { rewriteId } = {}) => {
    if (streaming) return;
    setStreaming(true); setSuggestions([]);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    if (!rewriteId) setBeats(b => [...b, { id: localId(), _streaming: true, directive: payload.directive || '', content: '' }]);
    else setBeats(b => b.map(x => x.id === rewriteId ? { ...x, _orig: x.content, content: '', _streaming: true } : x));
    let errored = false;
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(payload || {}), signal: ctrl.signal });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '请求失败'); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim(); if (!t.startsWith('data:')) continue;
          const p = t.slice(5).trim(); if (p === '[DONE]') continue;
          let j; try { j = JSON.parse(p); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.delta) {
            bufRef.current += j.delta;
            if (!rafRef.current) rafRef.current = requestAnimationFrame(() => {
              const chunk = bufRef.current; bufRef.current = ''; rafRef.current = 0;
              setBeats(b => { const c = [...b]; const last = c[c.length - 1]; if (last?._streaming) c[c.length - 1] = { ...last, content: (last.content || '') + chunk }; return c; });
            });
          }
          if (j.fee) toast(`本次平台创作扣除 ${j.fee} 金币`, 'info');
        }
      }
      flush();
    } catch (err) {
      errored = true; flush();
      if (err.name === 'AbortError') { /* keep partial */ }
      else toast(err.message, 'err');
    } finally {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      setBeats(b => b.map(x => x._streaming ? { ...x, _streaming: false } : x));
      setStreaming(false); abortRef.current = null;
    }
    // reconcile with server truth + auto-sync canon
    if (!errored) {
      try { await loadRun(run.id); } catch { /* */ }
      refreshRuns();
      if (autoSync && !rewriteId) syncCanon(true);
    } else if (rewriteId) {
      setBeats(b => b.map(x => x.id === rewriteId ? { ...x, content: x._orig ?? x.content } : x));
    }
  };

  const write = async (directive) => {
    const d = (directive ?? input).trim();
    if (directive === undefined) setInput('');
    await stream(`/api/novels/runs/${run.id}/write`, { directive: d });
  };
  const stop = () => abortRef.current?.abort();

  const rewriteBeat = (beat, instruction) => stream(`/api/novels/runs/${run.id}/beats/${beat.id}/rewrite`, { instruction }, { rewriteId: beat.id });

  const suggest = async () => {
    setSuggesting(true);
    try { const d = await api(`/novels/runs/${run.id}/suggest`, { method: 'POST' }); setSuggestions(d.suggestions || []); }
    catch (e) { toast(e.message, 'err'); }
    finally { setSuggesting(false); }
  };

  const syncCanon = async (silent) => {
    try {
      const d = await api(`/novels/runs/${run.id}/sync-canon`, { method: 'POST' });
      setRun(d.run);
      if (d.added || d.updated) toast(`局内设定已更新：新增 ${d.added}，修订 ${d.updated}`, 'ok');
      else if (!silent) toast('暂无可沉淀的新设定', 'info');
    } catch (e) { if (!silent) toast(e.message, 'err'); }
  };

  const switchRun = async (rid) => { if (rid === run?.id) return; setPanel(null); try { await loadRun(rid); } catch (e) { toast(e.message, 'err'); } };

  const delBeat = async (beat) => {
    if (beat._streaming) return;
    if (!confirm('删除这一段正文？')) return;
    setBeats(b => b.filter(x => x.id !== beat.id));
    try { await api(`/novels/runs/${run.id}/beats/${beat.id}`, { method: 'DELETE' }); refreshRuns(); }
    catch (e) { toast(e.message, 'err'); loadRun(run.id); }
  };
  const editBeat = async (beat, content) => {
    setBeats(b => b.map(x => x.id === beat.id ? { ...x, content } : x));
    try { await api(`/novels/runs/${run.id}/beats/${beat.id}`, { method: 'PATCH', body: { content } }); }
    catch (e) { toast(e.message, 'err'); }
  };
  const branchAt = async (beat) => {
    try { const d = await api(`/novels/runs/${run.id}/branch/${beat.id}`, { method: 'POST' }); toast('已从此处开出新分支', 'ok'); await refreshRuns(); await loadRun(d.run.id); }
    catch (e) { toast(e.message, 'err'); }
  };

  if (loading || !novel || !run) return <div className="empty" style={{ paddingTop: 160 }}>载入创作台…</div>;

  return (
    <div className="atl-ws">
      <WorkspaceHeader
        novel={novel} run={run} runs={runs} words={run.words}
        onBack={() => nav('/atelier')} onSwitchRun={switchRun}
        onOpenPanel={setPanel} activePanel={panel}
      />

      <div className="atl-ws-main">
        <div className="atl-manuscript" ref={scrollRef}>
          <div className="atl-ms-inner">
            <div className="atl-ms-head">
              <div className="atl-kicker"><ScrollText size={13} /> {run.name}</div>
              <h1 className="atl-ms-title">{novel.title}</h1>
              {novel.logline && <p className="atl-ms-logline">{novel.logline}</p>}
              {run.summary && <div className="atl-recap"><b>前情提要</b>{run.summary}</div>}
            </div>

            {beats.length === 0 && (
              <div className="atl-ms-empty">
                <Feather size={30} />
                <p>空白的第一页。在下方写下你想要的开场或方向，或点「灵感」让 AI 给你几条思路。</p>
                <div className="atl-starter">
                  {['以一个充满画面感的场景开场', '直接进入一段紧张的冲突', '从主角的一个清晨写起'].map(s => (
                    <button key={s} className="btn sm ghost" onClick={() => write(s)} disabled={streaming}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {beats.map((beat, i) => (
              <Beat key={beat.id} beat={beat} index={i} streaming={streaming}
                onRewrite={rewriteBeat} onDelete={delBeat} onEdit={editBeat} onBranch={branchAt} />
            ))}
            {streaming && <div className="atl-writing"><Loader2 size={14} className="spin" /> AI 正在落笔…</div>}
          </div>
        </div>

        {panel && (
          <SidePanel panel={panel} novel={novel} run={run} setRun={setRun}
            onClose={() => setPanel(null)} onSaveNovel={setNovel} refreshRuns={refreshRuns}
            onSwitchRun={switchRun} onSyncCanon={() => syncCanon(false)} toast={toast} loadRun={loadRun} nav={nav} />
        )}
      </div>

      <Composer
        input={input} setInput={setInput} streaming={streaming}
        onWrite={() => write()} onFree={() => write('')} onStop={stop}
        onSuggest={suggest} suggesting={suggesting} suggestions={suggestions}
        onPick={(p) => { setInput(p); setSuggestions([]); }}
        autoSync={autoSync} setAutoSync={setAutoSync} onManualSync={() => syncCanon(false)}
      />
    </div>
  );
}

/* ───────────────────────── header ───────────────────────── */
function WorkspaceHeader({ novel, run, runs, words, onBack, onSwitchRun, onOpenPanel, activePanel }) {
  const [runMenu, setRunMenu] = useState(false);
  const TOOLS = [
    { k: 'style', ic: Palette, label: '文风' },
    { k: 'codex', ic: BookLock, label: '局外设定' },
    { k: 'canon', ic: BookOpen, label: '局内设定' },
    { k: 'runs', ic: GitBranch, label: '剧情线' },
  ];
  return (
    <div className="atl-ws-head">
      <button className="btn ghost sm atl-back" onClick={onBack}><ArrowLeft size={16} /></button>
      <div className="atl-head-id">
        <b>{novel.title}</b>
        <div className="atl-run-pick" onClick={() => setRunMenu(v => !v)}>
          <span>{run.name}</span><ChevronDown size={13} />
          {runMenu && (
            <div className="atl-run-menu" onClick={e => e.stopPropagation()}>
              {runs.map(r => (
                <button key={r.id} className={'atl-run-item' + (r.id === run.id ? ' on' : '')} onClick={() => { onSwitchRun(r.id); setRunMenu(false); }}>
                  {r.id === run.id ? <Check size={13} /> : <span style={{ width: 13 }} />}
                  <span className="atl-run-nm">{r.name}{r.archived ? ' · 已归档' : ''}</span>
                  <span className="atl-run-w">{r.words || 0} 字</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="atl-words">{(words || 0).toLocaleString()} 字</span>
      <div className="atl-tools">
        {TOOLS.map(t => (
          <button key={t.k} className={'atl-tool' + (activePanel === t.k ? ' on' : '')} title={t.label} onClick={() => onOpenPanel(activePanel === t.k ? null : t.k)}>
            <t.ic size={16} /><span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── single beat ───────────────────────── */
function Beat({ beat, index, streaming, onRewrite, onDelete, onEdit, onBranch }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(beat.content);
  const [rewriting, setRewriting] = useState(false);
  const [instr, setInstr] = useState('');

  const save = () => { onEdit(beat, draft); setEditing(false); };
  const doRewrite = (text) => { onRewrite(beat, text); setRewriting(false); setInstr(''); setMenu(false); };

  return (
    <div className={'atl-beat' + (beat._streaming ? ' streaming' : '')}>
      {beat.directive ? <div className="atl-beat-dir"><Feather size={12} /> {beat.directive}</div> : null}
      {editing ? (
        <div className="atl-beat-edit">
          <textarea className="textarea" value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(20, Math.max(4, Math.ceil(draft.length / 40)))} />
          <div className="atl-beat-edit-act">
            <button className="btn sm ghost" onClick={() => { setEditing(false); setDraft(beat.content); }}>取消</button>
            <button className="btn sm primary" onClick={save}><Check size={13} /> 保存</button>
          </div>
        </div>
      ) : (
        <div className="atl-prose">{beat.content || (beat._streaming ? '' : '（空）')}{beat._streaming && <span className="atl-caret" />}</div>
      )}

      {!beat._streaming && !editing && (
        <div className="atl-beat-tools">
          <button title="改写润色" onClick={() => setRewriting(v => !v)}><Wand2 size={13} /></button>
          <button title="手动编辑" onClick={() => { setDraft(beat.content); setEditing(true); }}><Pencil size={13} /></button>
          <button title="从此处开分支" onClick={() => onBranch(beat)}><GitBranch size={13} /></button>
          <button title="删除" className="danger" onClick={() => onDelete(beat)}><Trash2 size={13} /></button>
        </div>
      )}

      {rewriting && (
        <div className="atl-rewrite-bar">
          <input className="input sm" placeholder="改写要求（留空＝整体润色），如：更紧凑、加强心理描写、改成下雨的夜晚…"
            value={instr} onChange={e => setInstr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doRewrite(instr); }} autoFocus />
          <button className="btn sm" onClick={() => doRewrite('')}>润色</button>
          <button className="btn sm primary" onClick={() => doRewrite(instr)}>改写</button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── composer (prompt bar) ───────────────────────── */
function Composer({ input, setInput, streaming, onWrite, onFree, onStop, onSuggest, suggesting, suggestions, onPick, autoSync, setAutoSync, onManualSync }) {
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onWrite(); } };
  return (
    <div className="atl-composer">
      {suggestions.length > 0 && (
        <div className="atl-suggest-row">
          {suggestions.map((s, i) => (
            <button key={i} className="atl-suggest" onClick={() => onPick(s.prompt)} title={s.prompt}>
              <Lightbulb size={12} /> <b>{s.label}</b><span>{s.prompt}</span>
            </button>
          ))}
        </div>
      )}
      <div className="atl-composer-bar">
        <textarea className="atl-prompt" placeholder="写下你想要的方向：接下来发生什么？谁登场？气氛如何？（⌘/Ctrl + Enter 发送）"
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} rows={1} disabled={streaming} />
        <div className="atl-composer-act">
          <button className="atl-mini" title="续写灵感" onClick={onSuggest} disabled={streaming || suggesting}>
            {suggesting ? <Loader2 size={15} className="spin" /> : <Lightbulb size={15} />}
          </button>
          <button className="atl-mini" title="自由续写（不给方向）" onClick={onFree} disabled={streaming}><Sparkles size={15} /></button>
          {streaming
            ? <button className="btn primary atl-send" onClick={onStop}><Square size={15} /> 停止</button>
            : <button className="btn primary atl-send" onClick={onWrite}><Send size={15} /> 写下去</button>}
        </div>
      </div>
      <div className="atl-composer-foot">
        <label className="atl-auto" title="每写完一段，自动把新设定沉淀进局内设定">
          <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} /> 自动沉淀设定
        </label>
        <button className="atl-link" onClick={onManualSync}><RefreshCw size={12} /> 立即提炼局内设定</button>
      </div>
    </div>
  );
}

/* ───────────────────────── side panel ───────────────────────── */
function SidePanel({ panel, novel, run, setRun, onClose, onSaveNovel, refreshRuns, onSwitchRun, onSyncCanon, toast, loadRun, nav }) {
  const titles = { style: '整体文风', codex: '局外设定 · 永不可改的母版', canon: '局内设定 · 唯一生效', runs: '剧情线' };
  return (
    <div className="atl-panel">
      <div className="atl-panel-head">
        <b>{titles[panel]}</b>
        <button className="atl-panel-x" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="atl-panel-body">
        {panel === 'style' && <StylePanel novel={novel} onSaveNovel={onSaveNovel} toast={toast} />}
        {panel === 'codex' && <CodexPanel novel={novel} onSaveNovel={onSaveNovel} toast={toast} />}
        {panel === 'canon' && <CanonPanel run={run} setRun={setRun} onSyncCanon={onSyncCanon} toast={toast} />}
        {panel === 'runs' && <RunsPanel novel={novel} run={run} onSwitchRun={onSwitchRun} refreshRuns={refreshRuns} toast={toast} loadRun={loadRun} />}
      </div>
    </div>
  );
}

function StylePanel({ novel, onSaveNovel, toast }) {
  const [style, setStyle] = useState(novel.style);
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setStyle(s => ({ ...s, [k]: v })); setDirty(true); };
  const save = async () => {
    try { const d = await api(`/novels/${novel.id}`, { method: 'PATCH', body: { style } }); onSaveNovel(d.novel); setDirty(false); toast('文风已保存', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="atl-style">
      <p className="atl-panel-hint">文风设定对整部作品的每一次生成生效。改完记得保存。</p>
      {Object.entries(STYLE_FIELDS).map(([k, f]) => (
        <div key={k} className="atl-style-field">
          <label>{f.label}</label>
          <div className="atl-seg">
            {f.opts.map(([v, l]) => (
              <button key={v} className={style[k] === v ? 'on' : ''} onClick={() => set(k, v)}>{l}</button>
            ))}
          </div>
        </div>
      ))}
      <label className="field-label">语气基调</label>
      <input className="input" value={style.tone || ''} onChange={e => set('tone', e.target.value)} maxLength={200} placeholder="如：冷峻克制、温柔治愈、荒诞黑色幽默" />
      <label className="field-label">笔法参照</label>
      <input className="input" value={style.influences || ''} onChange={e => set('influences', e.target.value)} maxLength={200} placeholder="借鉴某种气质（不抄袭原文），如：海明威式短句" />
      <label className="field-label">须避免</label>
      <input className="input" value={style.forbidden || ''} onChange={e => set('forbidden', e.target.value)} maxLength={400} placeholder="如：避免现代网络用语、避免上帝视角剧透" />
      <label className="field-label">作者额外指令</label>
      <textarea className="textarea" rows={3} value={style.custom || ''} onChange={e => set('custom', e.target.value)} maxLength={1200} placeholder="任何你想叮嘱 AI 的写作偏好" />
      <button className="btn primary block" style={{ marginTop: 12 }} onClick={save} disabled={!dirty}><Check size={15} /> 保存文风</button>
    </div>
  );
}

function CodexPanel({ novel, onSaveNovel, toast }) {
  const [codex, setCodex] = useState(novel.codex);
  const [dirty, setDirty] = useState(false);
  const [gen, setGen] = useState(false);
  const [focus, setFocus] = useState('');
  const update = (next) => { setCodex(next); setDirty(true); };
  const save = async () => {
    try { const d = await api(`/novels/${novel.id}`, { method: 'PATCH', body: { codex } }); onSaveNovel(d.novel); setCodex(d.novel.codex); setDirty(false); toast('局外母版已保存', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const generate = async () => {
    setGen(true);
    try { const d = await api(`/novels/${novel.id}/codex/generate`, { method: 'POST', body: { focus, append: true } }); onSaveNovel(d.novel); setCodex(d.novel.codex); setDirty(false); toast(`AI 生成了 ${d.generated} 条设定`, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { setGen(false); }
  };
  return (
    <div>
      <p className="atl-panel-hint"><BookLock size={13} /> 局外设定是你的创作母版，<b>永不会被剧情自动改动</b>。每开一条新剧情线，它都会被「复刻」成该线的局内设定。</p>
      <div className="atl-gen-box">
        <input className="input sm" value={focus} onChange={e => setFocus(e.target.value)} placeholder="想让 AI 侧重生成什么？（可留空）" />
        <button className="btn sm" onClick={generate} disabled={gen}>{gen ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} AI 生成设定</button>
      </div>
      <EntryEditor entries={codex} onChange={update} allowLock={false} />
      <button className="btn primary block atl-sticky-save" onClick={save} disabled={!dirty}><Check size={15} /> 保存母版</button>
    </div>
  );
}

function CanonPanel({ run, setRun, onSyncCanon, toast }) {
  const [canon, setCanon] = useState(run.canon);
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { setCanon(run.canon); setDirty(false); }, [run.canon]);
  const update = (next) => { setCanon(next); setDirty(true); };
  const save = async () => {
    try { const d = await api(`/novels/runs/${run.id}`, { method: 'PATCH', body: { canon } }); setRun(d.run); setDirty(false); toast('局内设定已保存', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const refork = async (keep) => {
    if (!confirm(keep ? '用局外母版重置局内设定（保留 AI/手动新增的条目）？' : '用局外母版完全重置局内设定？剧情中沉淀的设定将被清除。')) return;
    try { const d = await api(`/novels/runs/${run.id}/refork`, { method: 'POST', body: { keep_auto: keep } }); setRun(d.run); toast('已从母版复刻', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const sync = async () => { setSyncing(true); await onSyncCanon(); setSyncing(false); };
  return (
    <div>
      <p className="atl-panel-hint"><BookOpen size={13} /> 局内设定是<b>唯一真正生效</b>的设定，会随剧情推进被 AI 自动增补。可手动校正、锁定不被覆盖。</p>
      <div className="atl-canon-act">
        <button className="btn sm" onClick={sync} disabled={syncing}>{syncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} 从剧情提炼</button>
        <button className="btn sm ghost" onClick={() => refork(true)} title="保留沉淀条目，仅母版部分回到初始">复刻·保留</button>
        <button className="btn sm ghost danger" onClick={() => refork(false)} title="完全回到母版初始状态">复刻·重置</button>
      </div>
      <EntryEditor entries={canon} onChange={update} allowLock={true} showSource={true} />
      <button className="btn primary block atl-sticky-save" onClick={save} disabled={!dirty}><Check size={15} /> 保存局内设定</button>
    </div>
  );
}

function RunsPanel({ novel, run, onSwitchRun, refreshRuns, toast, loadRun }) {
  const [runs, setRuns] = useState([]);
  const reload = () => api(`/novels/${novel.id}`).then(d => setRuns(d.runs)).catch(() => {});
  useEffect(() => { reload(); }, [run.id]);
  const create = async () => {
    const name = prompt('新剧情线名称', '新线'); if (name === null) return;
    try { const d = await api(`/novels/${novel.id}/runs`, { method: 'POST', body: { name } }); toast('已创建新线（已复刻局外母版）', 'ok'); reload(); refreshRuns(); await loadRun(d.run.id); }
    catch (e) { toast(e.message, 'err'); }
  };
  const rename = async (r) => {
    const name = prompt('重命名剧情线', r.name); if (!name) return;
    try { await api(`/novels/runs/${r.id}`, { method: 'PATCH', body: { name } }); reload(); refreshRuns(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const archive = async (r) => { try { await api(`/novels/runs/${r.id}`, { method: 'PATCH', body: { archived: !r.archived } }); reload(); refreshRuns(); } catch (e) { toast(e.message, 'err'); } };
  const del = async (r) => {
    if (!confirm(`删除剧情线《${r.name}》及其全部正文？`)) return;
    try { await api(`/novels/runs/${r.id}`, { method: 'DELETE' }); toast('已删除', 'info'); const left = runs.filter(x => x.id !== r.id); reload(); refreshRuns(); if (r.id === run.id && left[0]) await loadRun(left[0].id); }
    catch (e) { toast(e.message, 'err'); }
  };
  const exportRun = async (r) => {
    try { const d = await api(`/novels/runs/${r.id}/export?format=md`); const blob = new Blob([d.text], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${novel.title}-${r.name}.md`; a.click(); URL.revokeObjectURL(url); }
    catch (e) { toast(e.message, 'err'); }
  };
  const recap = async (r) => {
    try { await api(`/novels/runs/${r.id}/recap`, { method: 'POST' }); toast('已生成前情提要', 'ok'); if (r.id === run.id) loadRun(run.id); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div>
      <p className="atl-panel-hint"><GitBranch size={13} /> 每条剧情线都是独立的存档：开新线会复刻一份局外母版作为它的局内设定，从此各自生长。</p>
      <button className="btn block" onClick={create} style={{ marginBottom: 12 }}><Plus size={15} /> 开一条新线（复刻母版）</button>
      <div className="atl-runs-list">
        {runs.map(r => (
          <div key={r.id} className={'atl-run-card' + (r.id === run.id ? ' on' : '') + (r.archived ? ' archived' : '')}>
            <div className="atl-run-main" onClick={() => onSwitchRun(r.id)}>
              <b>{r.name}{r.id === run.id && <span className="atl-run-cur">当前</span>}</b>
              <span>{r.beats} 段 · {(r.words || 0).toLocaleString()} 字{r.archived ? ' · 已归档' : ''}</span>
              {r.summary && <p>{r.summary}</p>}
            </div>
            <div className="atl-run-card-act">
              <button title="生成前情提要" onClick={() => recap(r)}><RefreshCw size={13} /></button>
              <button title="导出 Markdown" onClick={() => exportRun(r)}><FileDown size={13} /></button>
              <button title="重命名" onClick={() => rename(r)}><Pencil size={13} /></button>
              <button title={r.archived ? '取消归档' : '归档'} onClick={() => archive(r)}>{r.archived ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <button title="删除" className="danger" onClick={() => del(r)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── reusable entry editor ───────────────────────── */
function EntryEditor({ entries, onChange, allowLock, showSource }) {
  const upd = (i, k, v) => onChange(entries.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const add = () => onChange([...entries, { id: localId(), title: '', category: 'other', trigger: 'keyword', keys: '', content: '', source: 'manual', enabled: true, locked: false }]);
  const del = (i) => onChange(entries.filter((_, j) => j !== i));
  return (
    <div className="atl-entries">
      {entries.length === 0 && <div className="atl-entries-empty"><Layers size={15} /> 还没有设定条目，添加几条让世界立起来。</div>}
      {entries.map((e, i) => {
        const badge = showSource && SOURCE_BADGE[e.source];
        return (
          <div key={e.id || i} className={'atl-entry' + (e.enabled === false ? ' off' : '')}>
            <div className="atl-entry-top">
              <input className="input sm atl-entry-title" placeholder="条目名" value={e.title || ''} onChange={ev => upd(i, 'title', ev.target.value)} maxLength={80} />
              {badge && <span className={'atl-src ' + badge.cls}>{badge.label}</span>}
              <select className="select sm" value={e.category || 'other'} onChange={ev => upd(i, 'category', ev.target.value)}>
                {CAT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="atl-entry-trig">
              <select className="select sm" value={e.trigger || 'keyword'} onChange={ev => upd(i, 'trigger', ev.target.value)} title="触发方式">
                {TRIGGER_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              {e.trigger !== 'always' && (
                <input className="input sm" placeholder="触发关键词，逗号分隔" value={e.keys || ''} onChange={ev => upd(i, 'keys', ev.target.value)} maxLength={240} />
              )}
              {e.trigger === 'always' && <span className="atl-trig-note">每次生成都注入</span>}
            </div>
            <textarea className="textarea atl-entry-content" rows={2} placeholder="设定内容" value={e.content || ''} onChange={ev => upd(i, 'content', ev.target.value)} maxLength={4000} />
            <div className="atl-entry-foot">
              <button className="atl-entry-toggle" onClick={() => upd(i, 'enabled', e.enabled === false)} title={e.enabled === false ? '已停用' : '启用中'}>
                {e.enabled === false ? <EyeOff size={13} /> : <Eye size={13} />}{e.enabled === false ? '停用' : '启用'}
              </button>
              {allowLock && (
                <button className={'atl-entry-toggle' + (e.locked ? ' on' : '')} onClick={() => upd(i, 'locked', !e.locked)} title={e.locked ? '已锁定，不被 AI 自动覆盖' : '锁定后不被 AI 自动覆盖'}>
                  {e.locked ? <Lock size={13} /> : <Unlock size={13} />}{e.locked ? '锁定' : '可改'}
                </button>
              )}
              <button className="atl-entry-del" onClick={() => del(i)} title="删除"><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}
      <button className="btn sm ghost atl-entry-add" onClick={add}><Plus size={14} /> 添加设定条目</button>
    </div>
  );
}
