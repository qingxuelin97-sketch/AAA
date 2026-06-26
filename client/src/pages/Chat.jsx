import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getToken, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { speakBrowser } from '../voice.js';
import IllustrateModal from '../components/IllustrateModal.jsx';
import { Send, Volume2, MessageCircle, Plus, X, ArrowLeft, Copy, RotateCcw, PanelLeftClose, PanelLeftOpen, Square, ArrowDown, Pencil, Trash2, Check, Heart, BookOpen, Brain, Smile, MoreVertical, Type, Download, Eraser, Search, Edit3, Wand2, Music, VolumeX } from 'lucide-react';

const LIST_KEY = 'huanyu_chatlist_mini';
const FONT_KEY = 'huanyu_chat_font';
const AUTOREAD_KEY = 'huanyu_chat_autoread';
const BGM_KEY = 'huanyu_chat_bgm';
const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const STARTERS = ['你好呀～', '很高兴认识你！', '*微笑着向你打招呼*', '今天过得怎么样？', '我们聊点什么好呢？'];
const QUICK_ACTIONS = ['*微笑*', '*点头*', '*脸红*', '*轻笑*', '*歪头*', '*叹气*', '*眨眨眼*', '*沉默不语*', '*牵起你的手*', '*轻轻拥抱*', '😊', '😳', '🥰', '😢'];

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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [listMini, setListMini] = useState(() => localStorage.getItem(LIST_KEY) === '1');
  const [atBottom, setAtBottom] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [affinity, setAffinity] = useState(0);
  const [memories, setMemories] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newMem, setNewMem] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_KEY) || 'md');
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem(AUTOREAD_KEY) === '1');
  const [reactFor, setReactFor] = useState(null);
  const [bgmOn, setBgmOn] = useState(() => localStorage.getItem(BGM_KEY) !== '0');
  const scrollRef = useRef();
  const abortRef = useRef(null);
  const bgmRef = useRef(null);
  const autoReadRef = useRef(autoRead);
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);
  const setFont = (v) => { setFontSize(v); localStorage.setItem(FONT_KEY, v); };
  const toggleAutoRead = () => setAutoRead(v => { const n = !v; localStorage.setItem(AUTOREAD_KEY, n ? '1' : '0'); return n; });
  const toggleBgm = () => setBgmOn(v => { const n = !v; localStorage.setItem(BGM_KEY, n ? '1' : '0'); return n; });

  // Character background music — loop softly while in the conversation. Browsers
  // may block autoplay until a gesture; the play() rejection is swallowed and
  // the user can tap the music button (a direct gesture) to start it.
  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    if (bgmOn && character?.bgm) { el.volume = 0.45; el.play().catch(() => {}); }
    else { el.pause(); }
  }, [character?.bgm, bgmOn]);
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

  const renameConv = async () => {
    const t = window.prompt('重命名对话', conv?.title || ''); if (t == null) return;
    const v = t.trim(); if (!v) return;
    try { await api(`/chat/conversations/${id}`, { method: 'PATCH', body: { title: v } }); setConv(c => ({ ...c, title: v })); loadConvs(); toast('已重命名'); }
    catch (e) { toast(e.message, 'err'); } finally { setMenuOpen(false); }
  };
  const clearConv = async () => {
    setMenuOpen(false);
    if (!confirm('清空本对话的全部消息？将保留角色开场白，好感度归零。')) return;
    try { const d = await api(`/chat/conversations/${id}`, { method: 'PATCH', body: { clear: true } }); setMessages(d.messages); setAffinity(0); toast('对话已清空'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const exportConv = (fmt = 'md') => {
    setMenuOpen(false);
    const msgs = messages.filter(m => m.content);
    let blob, name;
    if (fmt === 'json') {
      // JSON 结构化导出：便于迁移、二次创作或导入其他工具
      const payload = {
        platform: 'huanyu', character: character?.name || null, character_id: character?.id || null,
        conversation_id: id, exported_at: new Date().toISOString(), message_count: msgs.length,
        messages: msgs.map(m => ({ role: m.role, content: m.content, created_at: m.created_at || null, reaction: m.reaction || null }))
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      name = `${character?.name || '对话'}-${id}.json`;
    } else {
      const md = `# 与「${character?.name || '角色'}」的对话\n\n` +
        msgs.map(m => `**${m.role === 'user' ? '我' : (character?.name || '角色')}：**\n\n${m.content}`).join('\n\n---\n\n');
      blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      name = `${character?.name || '对话'}-${id}.md`;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${fmt === 'json' ? 'JSON' : 'Markdown'}`);
  };
  const react = async (msg, emoji) => {
    setReactFor(null);
    if (!msg.id) return;
    try { const d = await api(`/chat/conversations/${id}/messages/${msg.id}/react`, { method: 'POST', body: { reaction: emoji } });
      setMessages(ms => ms.map(x => x.id === msg.id ? { ...x, reaction: d.message.reaction } : x)); }
    catch (e) { toast(e.message, 'err'); }
  };

  const loadConvs = () => api('/chat/conversations').then(d => setConvs(d.conversations)).catch(() => {});
  useEffect(() => { loadConvs(); }, []);
  // know the user's voice protocol so we can use browser TTS without a server call
  const [voiceCfg, setVoiceCfg] = useState(null);
  useEffect(() => { api('/settings').then(d => setVoiceCfg({ voice_protocol: d.settings.voice_protocol, voice_name: d.settings.voice_name })).catch(() => {}); }, []);
  const [illusOpen, setIllusOpen] = useState(false);
  // Seed the illustration prompt from the latest scene so one tap describes "this moment".
  const illusSeed = () => {
    const lastAsst = [...messages].reverse().find(m => m.role === 'assistant');
    const scene = (lastAsst?.content || '').replace(/[*_>#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return [character?.name && `角色：${character.name}`, character?.tagline, scene].filter(Boolean).join('，');
  };
  // celebrate when the relationship tier rises (ties into 成就 / affinity milestones)
  const prevAffLevel = useRef(null);
  useEffect(() => {
    const info = affinityInfo(affinity); const lvl = info.level;
    if (prevAffLevel.current !== null && lvl > prevAffLevel.current) {
      toast(`${info.icon} 羁绊加深！与${character?.name || 'TA'}的关系进入「${info.name}」`);
    }
    prevAffLevel.current = lvl;
    /* eslint-disable-next-line */
  }, [affinity]);
  useEffect(() => { prevAffLevel.current = null; }, [id]);

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
      setMessages(m => {
        const c = [...m]; const last = c[c.length - 1];
        c[c.length - 1] = { ...last, _streaming: false };
        if (autoReadRef.current && last?.content) setTimeout(() => speak(last.content), 120);
        return c;
      });
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

  const send = async (override) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    if (override === undefined) setInput('');
    setActionsOpen(false);
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', _streaming: true }]);
    await streamInto(`/api/chat/conversations/${id}/complete`, { content: text });
  };
  const insertAction = (a) => { setInput(v => (v ? v.replace(/\s*$/, '') + ' ' : '') + a + ' '); setActionsOpen(false); };

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
    // Browser Web Speech needs no server round-trip (offline / no CORS).
    if (voiceCfg?.voice_protocol === 'browser') { speakBrowser(text, voiceCfg.voice_name, character?.voice_speed, character?.voice_pitch); return; }
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, voice: character?.voice_name || undefined, speed: character?.voice_speed || undefined, pitch: character?.voice_pitch || undefined, character_id: character?.id })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      // Platform voice is billed per sentence — the server reports the charge via headers.
      const charged = res.headers.get('X-Gold-Fee');
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
      if (charged) { toast(`平台语音 · 本次消耗 ${charged} 金币`); refreshUser?.(); }
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
            {!character?.background && <div className="chat-aura" aria-hidden="true"><span /><span /><span /></div>}
            {character?.bgm && <audio ref={bgmRef} src={character.bgm} loop preload="auto" />}
            <div className="chat-head">
              <button className="btn ghost sm mobile-only" onClick={() => nav('/chats')}><ArrowLeft size={16} /></button>
              <div className={'ch-av' + (streaming ? ' live' : '')}><Avatar src={character?.avatar} name={character?.name} size={44} /></div>
              <div className="nm"><b>{character?.name}</b><span className="ch-status"><i className="ch-dot" />{streaming ? '正在输入…' : (character?.tagline || '在线 · 沉浸扮演中')}</span></div>
              {(() => { const af = affinityInfo(affinity); return (
                <button className="affinity-badge" onClick={() => setDrawerOpen(true)} title="角色档案 · 好感度 / 记忆 / 世界书">
                  <span className="af-ic">{af.icon}</span>
                  <span className="af-tx"><b>{af.name}</b><i><em style={{ width: af.pct + '%' }} /></i></span>
                </button>
              ); })()}
              <div className="chat-tools">
                {character?.bgm && (
                  <button className={'speak chat-tool' + (bgmOn ? ' on' : '')} onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '播放背景音乐'}>
                    {bgmOn ? <Music size={17} /> : <VolumeX size={17} />}
                  </button>
                )}
                <button className="speak chat-tool" onClick={() => setIllusOpen(true)} title="为当前剧情生成插图"><Wand2 size={17} /></button>
                <button className={'speak chat-tool' + (searchOpen ? ' on' : '')} onClick={() => { setSearchOpen(o => !o); setSearchQ(''); }} title="对话内搜索"><Search size={17} /></button>
                <div className="chat-menu-wrap">
                  <button className={'speak chat-tool' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen(o => !o)} title="更多"><MoreVertical size={17} /></button>
                  {menuOpen && (
                    <>
                      <div className="chat-menu-mask" onClick={() => setMenuOpen(false)} />
                      <div className="chat-menu">
                        <button onClick={renameConv}><Edit3 size={15} /> 重命名对话</button>
                        <button onClick={() => exportConv('md')}><Download size={15} /> 导出为 Markdown</button>
                        <button onClick={() => exportConv('json')}><Download size={15} /> 导出为 JSON</button>
                        <button className="danger" onClick={clearConv}><Eraser size={15} /> 清空消息</button>
                        <div className="chat-menu-sep" />
                        <div className="chat-menu-row"><span><Type size={15} /> 字号</span>
                          <div className="seg seg-mini">
                            {[['sm', '小'], ['md', '中'], ['lg', '大']].map(([v, l]) => (
                              <button key={v} className={fontSize === v ? 'active' : ''} onClick={() => setFont(v)}>{l}</button>
                            ))}
                          </div>
                        </div>
                        <button onClick={toggleAutoRead}><Volume2 size={15} /> 自动朗读 <span className={'chat-menu-toggle' + (autoRead ? ' on' : '')}>{autoRead ? '已开启' : '已关闭'}</span></button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {searchOpen && (
              <div className="chat-search">
                <Search size={15} className="muted" />
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="在本对话中搜索…" onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQ(''))} />
                {searchQ && <span className="muted" style={{ fontSize: 12 }}>{messages.filter(mm => mm.content?.toLowerCase().includes(searchQ.toLowerCase())).length} 条</span>}
                <button className="speak" onClick={() => { setSearchOpen(false); setSearchQ(''); }}><X size={15} /></button>
              </div>
            )}

            <div className={'chat-scroll font-' + fontSize} ref={scrollRef} onScroll={onScroll}>
              <div className="chat-thread">
              {messages.map((m, i) => {
                const q = searchQ.trim().toLowerCase();
                if (q && !(m.content || '').toLowerCase().includes(q)) return null;
                const firstOfRun = i === 0 || messages[i - 1].role !== m.role;
                return (
                <div key={m.id || i} className={'msg ' + m.role + (m._streaming ? ' streaming' : '') + (firstOfRun ? ' run-start' : ' run-cont')}>
                  {m.role === 'assistant' && <Avatar src={character?.avatar} name={character?.name} size={38} />}
                  <div className="msg-col">
                    {m.role === 'assistant' && firstOfRun && <div className="msg-name">{character?.name}</div>}
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
                        {m.reaction && <span className="msg-reaction" title="我的反应">{m.reaction}</span>}
                      </div>
                    )}
                    {!m._streaming && m.content && editingId !== m.id && (
                      <div className="msg-acts">
                        {m.role === 'assistant' && <>
                          <button className="speak" onClick={() => speak(m.content)}><Volume2 size={13} /> 朗读</button>
                          <button className="speak" onClick={() => copyMsg(m.content)}><Copy size={13} /> 复制</button>
                          {i === messages.length - 1 && <button className="speak" onClick={regenerate} disabled={streaming}><RotateCcw size={13} /> 重新生成</button>}
                          {m.id && (
                            <div className="react-wrap">
                              <button className="speak" onClick={() => setReactFor(reactFor === m.id ? null : m.id)}><Smile size={13} /> 反应</button>
                              {reactFor === m.id && (
                                <>
                                  <div className="react-mask" onClick={() => setReactFor(null)} />
                                  <div className="react-pop">
                                    {REACTIONS.map(e => <button key={e} className={m.reaction === e ? 'on' : ''} onClick={() => react(m, e)}>{e}</button>)}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </>}
                        {m.role === 'user' && <button className="speak" onClick={() => startEdit(m)} disabled={streaming}><Pencil size={13} /> 编辑</button>}
                        {m.id && <button className="speak" onClick={() => delMsg(m)} disabled={streaming}><Trash2 size={13} /> 删除</button>}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              </div>
            </div>

            {!atBottom && (
              <button className="scroll-bottom-btn" onClick={() => scrollToBottom()} title="回到底部" aria-label="回到底部">
                <ArrowDown size={18} />
              </button>
            )}
            {messages.length <= 1 && !streaming && (
              <div className="starter-chips">
                <span className="muted">试试开口：</span>
                {STARTERS.map(s => <button key={s} className="starter-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {actionsOpen && (
              <div className="action-panel">
                {QUICK_ACTIONS.map(a => <button key={a} onClick={() => insertAction(a)}>{a}</button>)}
              </div>
            )}
            <div className="chat-input-bar">
              <div className="box">
                <button className={'act-btn' + (actionsOpen ? ' on' : '')} onClick={() => setActionsOpen(o => !o)} disabled={streaming} title="动作 / 表情"><Smile size={19} /></button>
                <textarea rows={1} value={input} placeholder={`对 ${character?.name} 说点什么…（Enter 发送，Shift+Enter 换行）`}
                  onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={streaming} />
                {streaming
                  ? <button className="send-btn stop" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></button>
                  : <button className="send-btn" onClick={() => send()} disabled={!input.trim()}><Send size={17} /></button>}
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
      {illusOpen && <IllustrateModal initialPrompt={illusSeed()} onClose={() => setIllusOpen(false)} />}
    </div>
  );
}
