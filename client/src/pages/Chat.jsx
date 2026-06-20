import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getToken, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Send, Volume2, MessageCircle, Plus, X, ArrowLeft, Copy, RotateCcw, PanelLeftClose, PanelLeftOpen, Square, ArrowDown, Pencil, Trash2, Check, Heart, BookOpen, Brain } from 'lucide-react';

const LIST_KEY = 'huanyu_chatlist_mini';

// Relationship tiers driven by accumulated affinity (grows ~+3 per exchange).
const AFFINITY_LEVELS = [
  { min: 0, name: '初识', icon: '🌱' }, { min: 10, name: '相识', icon: '🌿' },
  { min: 30, name: '熟悉', icon: '☕' }, { min: 60, name: '友好', icon: '😊' },
  { min: 100, name: '亲近', icon: '💗' }, { min: 160, name: '信赖', icon: '✨' },
  { min: 250, name: '挚爱', icon: '💖' }
];
function affinityInfo(v) {
  v = v || 0; let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i++) if (v >= AFFINITY_LEVELS[i].min) idx = i;
  const cur = AFFINITY_LEVELS[idx], next = AFFINITY_LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round((v - cur.min) / (next.min - cur.min) * 100)) : 100;
  return { level: idx + 1, name: cur.name, icon: cur.icon, pct, value: v, nextAt: next ? next.min : null };
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [convs, setConvs] = useState([]);
  const [conv, setConv] = useState(null);
  const [character, setCharacter] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [listMini, setListMini] = useState(() => localStorage.getItem(LIST_KEY) === '1');
  const [atBottom, setAtBottom] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [affinity, setAffinity] = useState(0);
  const [memories, setMemories] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newMem, setNewMem] = useState('');
  const scrollRef = useRef();
  const abortRef = useRef(null);
  const syncMessages = () => api('/chat/conversations/' + id).then(d => { setMessages(d.messages); setAffinity(d.conversation.affinity || 0); setMemories(d.conversation.memories || []); }).catch(() => {});

  const addMemory = async () => {
    const c = newMem.trim(); if (!c) return;
    try { const d = await api(`/chat/conversations/${id}/memories`, { method: 'POST', body: { content: c } }); setMemories(d.memories); setNewMem(''); }
    catch (e) { toast(e.message, 'err'); }
  };
  const delMemory = async (mid) => {
    try { const d = await api(`/chat/conversations/${id}/memories/${mid}`, { method: 'DELETE' }); setMemories(d.memories); }
    catch (e) { toast(e.message, 'err'); }
  };

  const startEdit = (msg) => { setEditingId(msg.id); setEditText(msg.content); };
  const saveEdit = async (msg) => {
    const c = editText.trim(); if (!c) return;
    try {
      await api(`/chat/conversations/${id}/messages/${msg.id}`, { method: 'PATCH', body: { content: c } });
      setMessages(ms => ms.map(x => x.id === msg.id ? { ...x, content: c } : x));
      setEditingId(null);
    } catch (e) { toast(e.message, 'err'); }
  };
  const delMsg = async (msg) => {
    if (!msg.id) return;
    if (!confirm('删除这条消息？')) return;
    try { await api(`/chat/conversations/${id}/messages/${msg.id}`, { method: 'DELETE' }); setMessages(ms => ms.filter(x => x.id !== msg.id)); }
    catch (e) { toast(e.message, 'err'); }
  };
  const toggleList = () => setListMini(v => { const n = !v; localStorage.setItem(LIST_KEY, n ? '1' : '0'); return n; });

  const loadConvs = () => api('/chat/conversations').then(d => setConvs(d.conversations)).catch(() => {});
  useEffect(() => { loadConvs(); }, []);

  useEffect(() => {
    if (!id) { setConv(null); setCharacter(null); setMessages([]); return; }
    setDrawerOpen(false);
    api('/chat/conversations/' + id).then(d => {
      setConv(d.conversation); setCharacter(d.character); setMessages(d.messages);
      setAffinity(d.conversation.affinity || 0); setMemories(d.conversation.memories || []);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  const scrollToBottom = (behavior = 'smooth') => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  // Only auto-stick to the bottom when the user is already near it (don't yank them
  // away while they scroll back to read history).
  useEffect(() => { if (atBottom) scrollToBottom(); }, [messages, streaming]);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  // Stream a reply from the given endpoint into the trailing assistant bubble.
  const streamInto = async (endpoint, payload) => {
    setStreaming(true);
    setAtBottom(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload || {}), signal: ctrl.signal
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '请求失败'); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload2 = t.slice(5).trim();
          if (payload2 === '[DONE]') continue;
          try {
            const j = JSON.parse(payload2);
            if (j.error) throw new Error(j.error);
            if (j.delta) setMessages(m => {
              const copy = [...m]; copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + j.delta };
              return copy;
            });
          } catch (err) { if (err.message && !err.message.includes('JSON')) throw err; }
        }
      }
      setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], _streaming: false }; return c; });
      loadConvs();
      refreshUser?.();
      syncMessages(); // pull server IDs so edit/delete work on the new turn
    } catch (err) {
      // User-initiated stop: keep whatever streamed so far, no error toast.
      if (err.name === 'AbortError') {
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming) c[c.length - 1] = { ...last, content: last.content || '（已停止）', _streaming: false }; return c; });
      } else {
        toast(err.message, 'err');
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming) c[c.length - 1] = { role: 'assistant', content: '（连接出错）' + err.message, _streaming: false }; return c; });
      }
    } finally { setStreaming(false); abortRef.current = null; }
  };

  const stop = () => { abortRef.current?.abort(); };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', _streaming: true }]);
    await streamInto(`/api/chat/conversations/${id}/complete`, { content: text });
  };

  const regenerate = async () => {
    if (streaming) return;
    setMessages(m => {
      const c = [...m];
      while (c.length && c[c.length - 1].role === 'assistant') c.pop();
      return [...c, { role: 'assistant', content: '', _streaming: true }];
    });
    await streamInto(`/api/chat/conversations/${id}/regenerate`, {});
  };

  const copyMsg = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { toast('复制失败', 'err'); }
  };

  const speak = async (text) => {
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, voice: character?.voice_name || undefined })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
    } catch (err) { toast(err.message, 'err'); }
  };

  const delConv = async (e, cv) => {
    e.stopPropagation();
    if (!confirm('删除该对话？')) return;
    await api('/chat/conversations/' + cv.id, { method: 'DELETE' });
    if (String(cv.id) === String(id)) nav('/chats');
    loadConvs();
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className={'chat-layout' + (conv ? ' immersive' : '')}>
      <div className={'chat-list' + (conv ? ' hide-mobile' : '') + (listMini ? ' mini' : '')}>
        <div className="hd">
          {!listMini && <span style={{ flex: 1 }}>对话</span>}
          <button className="btn ghost sm" onClick={toggleList} title={listMini ? '展开对话列表' : '收起对话列表'}>
            {listMini ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          {!listMini && <button className="btn sm" onClick={() => nav('/library')} title="从角色库新建对话"><Plus size={15} /></button>}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {convs.length === 0 && !listMini && <div className="empty" style={{ padding: 30, fontSize: 13 }}>从「我的角色」开始一段对话</div>}
          {convs.map(cv => (
            <div key={cv.id} className={'conv-item' + (String(cv.id) === String(id) ? ' active' : '')} onClick={() => nav('/chats/' + cv.id)} title={listMini ? cv.character_name : undefined}>
              <Avatar src={cv.character_avatar} name={cv.character_name} size={40} />
              <div className="tx"><b>{cv.character_name}</b><span>{cv.title}</span></div>
              <button className="speak" onClick={e => delConv(e, cv)}><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className={'chat-main' + (character?.background ? ' has-bg' : '')}>
        {!conv ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="big"><MessageCircle size={46} /></div>选择左侧对话，或从角色库开启新对话
          </div>
        ) : (
          <>
            {character?.background && (
              <div className="chat-bg">
                {character.background_type === 'video'
                  ? <video src={character.background} muted loop autoPlay playsInline />
                  : <img src={character.background} alt="" />}
              </div>
            )}
            <div className="chat-head">
              <button className="btn ghost sm mobile-only" onClick={() => nav('/chats')}><ArrowLeft size={16} /></button>
              <Avatar src={character?.avatar} name={character?.name} size={42} />
              <div className="nm"><b>{character?.name}</b><br /><span>{character?.tagline || '正在扮演中'}</span></div>
              {(() => { const af = affinityInfo(affinity); return (
                <button className="affinity-badge" onClick={() => setDrawerOpen(true)} title="角色档案 · 好感度 / 记忆 / 世界书">
                  <span className="af-ic">{af.icon}</span>
                  <span className="af-tx"><b>{af.name}</b><i><em style={{ width: af.pct + '%' }} /></i></span>
                </button>
              ); })()}
            </div>

            <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
              {messages.map((m, i) => (
                <div key={m.id || i} className={'msg ' + m.role}>
                  {m.role === 'assistant' && <Avatar src={character?.avatar} name={character?.name} size={36} />}
                  <div>
                    {editingId === m.id ? (
                      <div className="msg-edit">
                        <textarea value={editText} autoFocus onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } if (e.key === 'Escape') setEditingId(null); }} />
                        <div className="msg-edit-acts">
                          <button className="btn sm primary" onClick={() => saveEdit(m)}><Check size={13} /> 保存</button>
                          <button className="btn sm ghost" onClick={() => setEditingId(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div className="bubble">
                        {m.content || (m._streaming && <span className="typing"><span></span><span></span><span></span></span>)}
                      </div>
                    )}
                    {!m._streaming && m.content && editingId !== m.id && (
                      <div className="msg-acts">
                        {m.role === 'assistant' && <>
                          <button className="speak" onClick={() => speak(m.content)}><Volume2 size={13} /> 朗读</button>
                          <button className="speak" onClick={() => copyMsg(m.content)}><Copy size={13} /> 复制</button>
                          {i === messages.length - 1 && <button className="speak" onClick={regenerate} disabled={streaming}><RotateCcw size={13} /> 重新生成</button>}
                        </>}
                        {m.role === 'user' && <button className="speak" onClick={() => startEdit(m)} disabled={streaming}><Pencil size={13} /> 编辑</button>}
                        {m.id && <button className="speak" onClick={() => delMsg(m)} disabled={streaming}><Trash2 size={13} /> 删除</button>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!atBottom && (
              <button className="scroll-bottom-btn" onClick={() => scrollToBottom()} title="回到底部" aria-label="回到底部">
                <ArrowDown size={18} />
              </button>
            )}
            <div className="chat-input-bar">
              <div className="box">
                <textarea rows={1} value={input} placeholder={`对 ${character?.name} 说点什么…（Enter 发送，Shift+Enter 换行）`}
                  onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={streaming} />
                {streaming
                  ? <button className="send-btn stop" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></button>
                  : <button className="send-btn" onClick={send} disabled={!input.trim()}><Send size={17} /></button>}
              </div>
            </div>

            {drawerOpen && (() => { const af = affinityInfo(affinity); return (
              <>
                <div className="chat-drawer-mask" onClick={() => setDrawerOpen(false)} />
                <aside className="chat-drawer">
                  <div className="cd-head">
                    <Avatar src={character?.avatar} name={character?.name} size={36} />
                    <b style={{ flex: 1 }}>{character?.name} · 档案</b>
                    <button className="speak" onClick={() => setDrawerOpen(false)}><X size={16} /></button>
                  </div>
                  <div className="cd-body">
                    <section>
                      <h4><Heart size={14} /> 好感度</h4>
                      <div className="af-big">{af.icon} Lv.{af.level} · {af.name}</div>
                      <div className="af-bar"><span style={{ width: af.pct + '%' }} /></div>
                      <p className="muted">好感值 {af.value}{af.nextAt ? ` · 距「${AFFINITY_LEVELS[af.level]?.name}」还需 ${af.nextAt - af.value}` : ' · 已是最高羁绊'}</p>
                    </section>
                    <section>
                      <h4><Brain size={14} /> 对话记忆 <span className="muted">角色会始终记住</span></h4>
                      {memories.length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有记忆。添加后会注入到每次对话，角色将牢记。</p>}
                      {memories.map(mm => (
                        <div className="mem-item" key={mm.id}><span>{mm.content}</span><button onClick={() => delMemory(mm.id)} title="删除"><X size={13} /></button></div>
                      ))}
                      <div className="mem-add">
                        <input className="input" value={newMem} placeholder="如：我叫小明，养了一只叫奶糖的猫"
                          onChange={e => setNewMem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMemory(); } }} />
                        <button className="btn sm primary" onClick={addMemory}><Plus size={14} /> 记住</button>
                      </div>
                    </section>
                    <section>
                      <h4><BookOpen size={14} /> 世界书 / 设定</h4>
                      {(!character?.world || character.world.length === 0)
                        ? <p className="muted" style={{ fontSize: 13 }}>该角色未设置世界书条目。</p>
                        : character.world.map((w, i) => (
                          <div className="wb-item" key={i}>
                            <div className="wb-keys">{(w.keys || '常驻').split(',').map(k => k.trim()).filter(Boolean).map((k, j) => <span key={j}>{k}</span>)}</div>
                            <p>{w.content}</p>
                          </div>
                        ))}
                    </section>
                  </div>
                </aside>
              </>
            ); })()}
          </>
        )}
      </div>
    </div>
  );
}
