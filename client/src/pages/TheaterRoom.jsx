import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import { Send, Sparkles, ArrowLeft, Feather, Users, LogOut, BookOpen, Zap, ZapOff, ChevronRight } from 'lucide-react';

// 互动小说阅读器：以你为主角的即兴叙事。你写下行动 / 台词，旁白会续写后果，
// 也可点登场角色让其接话。整体按「小说阅读」体验重构 —— 旁白为文学化散文，
// 角色对白带署名，玩家行动单独成段，每段淡入推进，像翻动书页。
//
// 后端沿用 /theater 既有接口（say / act narrator / act character / 轮询），
// 这里把多人即兴「舞台」重塑为单人沉浸式「互动小说」前端。

// 通用行动建议：点选即作为你的行动发送并自动续写，降低空白页焦虑。
const ACTION_HINTS = ['环顾四周', '继续向前', '开口询问', '保持沉默', '回忆起什么', '伸手触碰'];

export default function TheaterRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [acting, setActing] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [autoFlow, setAutoFlow] = useState(() => localStorage.getItem('inovel_autoflow') !== '0');
  const scrollRef = useRef();
  const barRef = useRef();
  const lastId = useRef(0);

  // 移动端软键盘适配：输入栏顶在键盘上方（与对话页同一套稳健实现）。
  useKeyboardInsetBar(barRef, [id]);

  const leave = async () => {
    if (!confirm('确定离开这部互动小说？')) return;
    try { await api('/theater/' + id + '/leave', { method: 'POST' }); toast('已离开'); nav('/theater'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const load = async () => {
    try {
      const d = await api('/theater/' + id);
      setData(d);
      setMessages(d.messages);
      lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
      if (!d.joined) api('/theater/' + id + '/join', { method: 'POST' }).catch(() => {});
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // poll for new passages contributed by other readers / AIs
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/theater/' + id + '/messages?after=' + lastId.current);
        if (d.messages.length) {
          setMessages(m => [...m, ...d.messages.filter(x => x.id > lastId.current)]);
          lastId.current = d.messages[d.messages.length - 1].id;
        }
      } catch { /* */ }
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, acting]);

  const push = (msg) => { setMessages(m => [...m, msg]); lastId.current = Math.max(lastId.current, msg.id); };

  const toggleAuto = () => setAutoFlow(v => { const n = !v; localStorage.setItem('inovel_autoflow', n ? '1' : '0'); return n; });

  // 让旁白 / 某个角色续写一段。
  const advance = async (body, label) => {
    if (acting) return;
    setActing(label || '旁白');
    try { const d = await api('/theater/' + id + '/act', { method: 'POST', body: body || { narrator: true } }); push(d.message); }
    catch (e) { toast(e.message, 'err'); } finally { setActing(false); }
  };

  // 你写下一段行动 / 台词；可选地自动让旁白续写后果，形成「行动 → 后果」的互动循环。
  const say = async (textArg) => {
    const content = (textArg ?? input).trim();
    if (!content || acting) return;
    if (textArg == null) setInput('');
    try {
      const d = await api('/theater/' + id + '/say', { method: 'POST', body: { content } });
      push(d.message);
      if (autoFlow) setTimeout(() => advance(undefined, '旁白'), 120);
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>翻开书页…</div>;
  const { theater, cast } = data;
  const passages = messages.length;

  return (
    <div className="chat-layout immersive inovel">
      <div className="chat-main">
        {theater.cover
          ? <div className="chat-bg inovel-bg"><img src={theater.cover} alt="" /></div>
          : <div className="inovel-bg inovel-bg-fallback" aria-hidden="true" />}

        <div className="chat-head inovel-head">
          <button className="btn ghost sm" onClick={() => nav('/theater')}><ArrowLeft size={16} /></button>
          <div className="nm" style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={15} /> {theater.name}</b>
            <span className="inovel-sub">{cast.length} 位角色登场 · 第 {passages} 段 · {data.members.length} 位读者</span>
          </div>
          <button className={'btn ghost sm' + (autoFlow ? ' on' : '')} onClick={toggleAuto} title={autoFlow ? '自动续写：开（你行动后旁白自动接续）' : '自动续写：关（手动推进剧情）'}>
            {autoFlow ? <Zap size={15} /> : <ZapOff size={15} />}
          </button>
          <button className="btn ghost sm" onClick={() => setShowMembers(v => !v)} title="读者列表"><Users size={15} /> {data.members.length}</button>
          <button className="btn ghost sm" onClick={leave} title="离开"><LogOut size={15} /></button>
        </div>
        {showMembers && (
          <div className="group-members">
            {data.members.map((mb, i) => (
              <div key={i} className="gm-row">
                <Avatar src={mb.avatar} name={mb.display_name} size={30} />
                <span>{mb.display_name || '读者'}</span>
                {mb.id === theater.owner_id && <span className="gm-owner">作者</span>}
              </div>
            ))}
          </div>
        )}

        <div className="chat-scroll inovel-scroll" ref={scrollRef}>
          <div className="inovel-book">
            <div className="inovel-cover-block">
              <div className="inovel-kicker"><Feather size={13} /> 互动小说</div>
              <h1 className="inovel-title">{theater.name}</h1>
              {theater.scene && <p className="inovel-logline">{theater.scene}</p>}
              <div className="inovel-cast-strip">
                {cast.map(c => (
                  <span key={c.id} className="inovel-cast-tag"><Avatar src={c.avatar} name={c.name} size={20} /> {c.name}</span>
                ))}
              </div>
              <div className="inovel-rule"><span>序章</span></div>
            </div>

            {messages.map((m, i) => {
              if (m.sender_type === 'narrator') {
                return <p key={m.id || i} className="inovel-passage inovel-narr">{m.content}</p>;
              }
              const mine = m.sender_type === 'user' && m.sender_id === user.id;
              if (mine) {
                return (
                  <div key={m.id || i} className="inovel-passage inovel-me">
                    <span className="inovel-me-tag">你</span>
                    <p>{m.content}</p>
                  </div>
                );
              }
              return (
                <div key={m.id || i} className="inovel-passage inovel-dlg">
                  <Avatar src={m.avatar} name={m.name} size={34} />
                  <div className="inovel-dlg-body">
                    <div className="inovel-who">{m.name}{m.sender_type === 'ai' && <span className="inovel-ai-tag">AI</span>}</div>
                    <div className="inovel-say">{m.content}</div>
                  </div>
                </div>
              );
            })}
            {acting && (
              <div className="inovel-passage inovel-writing">
                <Feather size={14} className="inovel-quill" /> <span>{acting === '旁白' ? '旁白正在续写…' : `${acting} 正在斟酌台词…`}</span>
                <span className="typing"><span></span><span></span><span></span></span>
              </div>
            )}
            <div className="inovel-foot-space" aria-hidden="true" />
          </div>
        </div>

        <div className="chat-input-bar inovel-bar" ref={barRef}>
          <div className="inovel-choices">
            <button className="inovel-chip primary" disabled={acting} onClick={() => advance(undefined, '旁白')}>
              <Sparkles size={13} /> 推进剧情
            </button>
            {cast.map(c => (
              <button key={c.id} className="inovel-chip" disabled={acting} onClick={() => advance({ character_id: c.id }, c.name)}>
                <Avatar src={c.avatar} name={c.name} size={18} /> {c.name}
              </button>
            ))}
          </div>
          <div className="inovel-hints">
            {ACTION_HINTS.map(h => (
              <button key={h} className="inovel-hint" disabled={acting} onClick={() => say(h)}><ChevronRight size={11} /> {h}</button>
            ))}
          </div>
          <div className="box">
            <textarea rows={1} value={input} placeholder="写下你的行动或台词，让故事继续…"
              enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(); } }} />
            <button className="send-btn" onClick={() => say()} disabled={!input.trim()}><Send size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
