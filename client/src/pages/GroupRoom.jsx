import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import { useAutoGrow } from '../util.js';
import { Send, ArrowLeft, Users, LogOut, MessageCircle } from 'lucide-react';

export default function GroupRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const scrollRef = useRef();
  const lastId = useRef(0);
  const barRef = useRef(null);
  const inputRef = useRef(null);
  // 移动端沉浸式布局下输入栏是 fixed 的：键盘弹起时顶到键盘上方（与对话页一致）
  useKeyboardInsetBar(barRef, [group]);
  useAutoGrow(inputRef, input);

  const leave = async () => {
    if (!confirm('确定退出该群聊？')) return;
    try { await api('/groups/' + id + '/leave', { method: 'POST' }); toast('已退出群聊'); nav('/groups'); }
    catch (e) { toast(e.message, 'err'); }
  };

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
    <div className="chat-layout immersive">
      <div className="chat-main">
        <div className="chat-head">
          <button className="btn ghost sm" onClick={() => nav('/groups')}><ArrowLeft size={16} /></button>
          <Avatar src={group.avatar} name={group.name} size={40} />
          <div className="nm"><b>{group.name}</b><br /><span>{group.owner_name} 创建 · {group.description || '同好交流'}</span></div>
          <button className="btn ghost sm" onClick={() => setShowMembers(v => !v)} title="成员列表"><Users size={15} /> {members.length}</button>
          <button className="btn ghost sm" onClick={leave} title="退出群聊"><LogOut size={15} /></button>
        </div>
        {showMembers && (
          <div className="group-members">
            {members.map((mb, i) => (
              <div key={i} className="gm-row">
                <Avatar src={mb.avatar} name={mb.display_name} size={30} />
                <span>{mb.display_name || '匿名'}</span>
                {mb.role === 'owner' && <span className="gm-owner">群主</span>}
              </div>
            ))}
          </div>
        )}
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty" style={{ margin: 'auto' }}><div className="big"><MessageCircle size={42} /></div>还没有人发言，来打个招呼吧～</div>
          )}
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
        {/* 移动端 fixed 输入栏的占位，避免最后一条消息被遮挡 */}
        <div className="chat-input-spacer" aria-hidden="true" />
        <div className="chat-input-bar" ref={barRef}>
          <div className="box">
            <textarea ref={inputRef} rows={1} value={input} placeholder="说点什么…" enterKeyHint="send"
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="send-btn" onClick={send} disabled={!input.trim()}><Send size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
