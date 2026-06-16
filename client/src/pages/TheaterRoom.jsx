import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Send, Sparkles, ArrowLeft, Wand2 } from 'lucide-react';

export default function TheaterRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [acting, setActing] = useState(false);
  const scrollRef = useRef();
  const lastId = useRef(0);

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

  // poll for new lines from other players / AIs
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/theater/' + id + '/messages?after=' + lastId.current);
        if (d.messages.length) {
          setMessages(m => [...m, ...d.messages]);
          lastId.current = d.messages[d.messages.length - 1].id;
        }
      } catch { /* */ }
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, acting]);

  const push = (msg) => { setMessages(m => [...m, msg]); lastId.current = Math.max(lastId.current, msg.id); };

  const say = async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try { const d = await api('/theater/' + id + '/say', { method: 'POST', body: { content } }); push(d.message); }
    catch (e) { toast(e.message, 'err'); }
  };

  const act = async (body, label) => {
    if (acting) return;
    setActing(label);
    try { const d = await api('/theater/' + id + '/act', { method: 'POST', body }); push(d.message); }
    catch (e) { toast(e.message, 'err'); } finally { setActing(false); }
  };

  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const { theater, cast } = data;

  return (
    <div className="chat-layout">
      <div className="chat-main">
        {theater.cover && <div className="chat-bg"><img src={theater.cover} alt="" /></div>}
        <div className="chat-head">
          <button className="btn ghost sm" onClick={() => nav('/theater')}><ArrowLeft size={16} /></button>
          <Avatar src={theater.cover} name={theater.name} size={40} />
          <div className="nm"><b>{theater.name}</b><br /><span>{cast.length} 位 AI 角色同台 · {data.members.length} 名玩家</span></div>
        </div>

        <div className="theater-stage">
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center', marginRight: 4 }}>让其登场：</span>
          {cast.map(c => (
            <div key={c.id} className="cast-chip" onClick={() => act({ character_id: c.id }, c.name)} title={`让 ${c.name} 接话`}>
              <Avatar src={c.avatar} name={c.name} size={24} />{c.name}
            </div>
          ))}
          <div className="cast-chip narr" onClick={() => act({ narrator: true }, '旁白')}><Wand2 size={14} /> 旁白推进</div>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((m, i) => {
            if (m.sender_type === 'narrator') return <div key={i} className="msg narrator"><div className="bubble">{m.content}</div></div>;
            const mine = m.sender_type === 'user' && m.sender_id === user.id;
            return (
              <div key={i} className={'msg ' + (mine ? 'user' : 'assistant')}>
                {!mine && <Avatar src={m.avatar} name={m.name} size={36} />}
                <div>
                  {!mine && <div className="who">{m.name}{m.sender_type === 'ai' && ' · AI'}</div>}
                  <div className="bubble">{m.content}</div>
                </div>
              </div>
            );
          })}
          {acting && <div className="msg assistant"><Avatar name={acting} size={36} /><div><div className="who">{acting}</div><div className="bubble"><span className="typing"><span></span><span></span><span></span></span></div></div></div>}
        </div>

        <div className="chat-input-bar">
          <div className="box">
            <textarea rows={1} value={input} placeholder="以你自己的身份发言…（点击上方角色让 AI 接话）"
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(); } }} />
            <button className="send-btn" onClick={say} disabled={!input.trim()}><Send size={17} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn sm ghost" disabled={!!acting} onClick={() => act({ narrator: true }, '旁白')}><Sparkles size={13} /> 让旁白推进剧情</button>
            {cast.slice(0, 3).map(c => (
              <button key={c.id} className="btn sm ghost" disabled={!!acting} onClick={() => act({ character_id: c.id }, c.name)}>让 {c.name} 接话</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
