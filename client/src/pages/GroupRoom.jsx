import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Send, ArrowLeft, Users } from 'lucide-react';

export default function GroupRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef();
  const lastId = useRef(0);

  const load = async () => {
    try {
      const d = await api('/groups/' + id);
      setGroup(d.group); setMembers(d.members); setMessages(d.messages);
      lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/groups/' + id + '/messages?after=' + lastId.current);
        if (d.messages.length) { setMessages(m => [...m, ...d.messages]); lastId.current = d.messages[d.messages.length - 1].id; }
      } catch { /* */ }
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try { const d = await api('/groups/' + id + '/messages', { method: 'POST', body: { content } });
      setMessages(m => [...m, d.message]); lastId.current = Math.max(lastId.current, d.message.id); }
    catch (e) { toast(e.message, 'err'); }
  };

  if (!group) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;

  return (
    <div className="chat-layout">
      <div className="chat-main">
        <div className="chat-head">
          <button className="btn ghost sm" onClick={() => nav('/groups')}><ArrowLeft size={16} /></button>
          <Avatar src={group.avatar} name={group.name} size={40} />
          <div className="nm"><b>{group.name}</b><br /><span><Users size={11} style={{ verticalAlign: -1 }} /> {members.length} 名成员</span></div>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((m, i) => {
            const mine = m.user_id === user.id;
            return (
              <div key={i} className={'msg ' + (mine ? 'user' : 'assistant')}>
                {!mine && <Avatar src={m.avatar} name={m.display_name} size={36} />}
                <div>
                  {!mine && <div className="who">{m.display_name}</div>}
                  <div className="bubble">{m.content}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-input-bar">
          <div className="box">
            <textarea rows={1} value={input} placeholder="说点什么…"
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="send-btn" onClick={send} disabled={!input.trim()}><Send size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
